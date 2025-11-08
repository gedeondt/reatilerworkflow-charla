import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import chalk from 'chalk';

import { eventEnvelopeSchema, type EventEnvelope } from '@reatiler/shared';
import { loadScenario, type Domain, type Scenario } from '@reatiler/saga-kernel';

import { createRenderer, type Renderer } from './render';
import {
  FINISHED_RETENTION_MS,
  getExecutionRows,
  resetExecutions,
  type DomainStatusUpdate,
  upsertExecution
} from './state';

const DEFAULT_SCENARIO_RUNNER_URL = 'http://localhost:3100';
const DEFAULT_MESSAGE_QUEUE_URL = 'http://localhost:3005';
const POLL_INTERVAL_MS = 1000;
const VISUALIZER_QUEUE = 'visualizer';
const DEFAULT_MAX_TRACES = 5;
const REFRESH_INTERVAL_MS = Math.max(500, Math.floor(FINISHED_RETENTION_MS / 2));

const BUSINESS_DIR = 'business';

type EventClassification = 'success' | 'compensation' | 'failure' | 'other';
type EventFlow = { fromDomainId: string; toDomainId: string };
type CliOptions = { maxTraces: number };
type OnEvent = (envelope: EventEnvelope, context: { queue: string }) => void;
type MirroredMessage = { queue: string; message: unknown };
type ScenarioSummary = { name: string; domainsCount: number };
type ScenarioInfoResponse = { name: string; domains: Domain[] };
type ScenarioContext = {
  scenario: Scenario;
  domains: Domain[];
  queueToDomainId: Record<string, string>;
  eventStateUpdates: Record<string, DomainStatusUpdate[]>;
  eventFlowTargets: Record<string, string[]>;
  eventNames: Set<string>;
};
type RuntimeResources = {
  renderer: Renderer;
  stopPolling: () => void;
  refreshTimer: NodeJS.Timeout;
  context: ScenarioContext;
};

type ScenarioListPayload = { scenarios?: Array<{ name?: string; domainsCount?: number }> };
type ScenarioInfoPayload = { name?: string; domains?: Array<{ id?: string; queue?: string }> };

type LogLevel = 'info' | 'warning' | 'error';

const messageQueueUrl = process.env.MESSAGE_QUEUE_URL ?? DEFAULT_MESSAGE_QUEUE_URL;
const scenarioRunnerUrl = process.env.SCENARIO_RUNNER_URL ?? DEFAULT_SCENARIO_RUNNER_URL;
const configuredFilterCorrelationId = (() => {
  const raw = process.env.VIS_FILTER_ORDER_ID?.trim();
  return raw && raw.length > 0 ? raw : null;
})();

const cliOptions = parseCliOptions(process.argv.slice(2));
let globalMaxTraces = cliOptions.maxTraces;

let runtimeResources: RuntimeResources | null = null;
let shutdownRegistered = false;
let isSwitching = false;
let connectionErrorLogged = false;
let seenEvents = new Set<string>();
let unknownQueuesLogged = new Set<string>();
let unknownEventsLogged = new Set<string>();
let pushStatusMessage: ((message: string, level: LogLevel) => void) | undefined;

function parseCliOptions(argv: string[]): CliOptions {
  let maxTraces = DEFAULT_MAX_TRACES;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--max-traces') {
      const value = argv[index + 1];
      const parsed = Number.parseInt(value ?? '', 10);

      if (!Number.isNaN(parsed) && parsed > 0) {
        maxTraces = parsed;
      }

      index += 1;
      continue;
    }

    if (argument.startsWith('--max-traces=')) {
      const [, raw] = argument.split('=', 2);
      const parsed = Number.parseInt(raw ?? '', 10);

      if (!Number.isNaN(parsed) && parsed > 0) {
        maxTraces = parsed;
      }
    }
  }

  return { maxTraces };
}

function resetTracking(): void {
  seenEvents = new Set<string>();
  unknownQueuesLogged = new Set<string>();
  unknownEventsLogged = new Set<string>();
  connectionErrorLogged = false;
}

function classifyEvent(eventName: string, context: ScenarioContext): EventClassification {
  const updates = context.eventStateUpdates[eventName];

  if (!updates || updates.length === 0) {
    return 'other';
  }

  const statuses = updates.map((update: DomainStatusUpdate) => update.status.toLowerCase());

  if (statuses.some((status: string) => status.includes('fail') || status.includes('error'))) {
    return 'failure';
  }

  if (
    statuses.some((status: string) =>
      status.includes('cancel') || status.includes('refund') || status.includes('release')
    )
  ) {
    return 'compensation';
  }

  return 'success';
}

function classificationToChalk(classification: EventClassification) {
  switch (classification) {
    case 'success':
      return chalk.green;
    case 'compensation':
      return chalk.yellow;
    case 'failure':
      return chalk.red;
    case 'other':
    default:
      return chalk.gray;
  }
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function extractEntityId(data: Record<string, unknown>): string {
  const candidateKeys = ['id', 'entityId', 'orderId', 'requestId'];

  for (const key of candidateKeys) {
    const value = data[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') {
      const nestedId = extractEntityId(value as Record<string, unknown>);

      if (nestedId !== 'n/a') {
        return nestedId;
      }
    }
  }

  return 'n/a';
}

function logConnectionError(error: unknown) {
  if (connectionErrorLogged) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  connectionErrorLogged = true;

  pushStatusMessage?.(`⚠️  Unable to reach message queue at ${messageQueueUrl}: ${message}`, 'warning');
}

function logConnectionRecovered() {
  if (!connectionErrorLogged) {
    return;
  }

  connectionErrorLogged = false;
  pushStatusMessage?.('✅ Connection to message queue restored.', 'info');
}

async function pollVisualizerQueue(onEvent: OnEvent): Promise<void> {
  const url = new URL(`/queues/${VISUALIZER_QUEUE}/pop`, messageQueueUrl);

  let response: Response;

  try {
    response = await fetch(url, { method: 'POST' });
  } catch (error) {
    logConnectionError(error);
    return;
  }

  if (!response.ok) {
    const error = new Error(`Unexpected response ${response.status} ${response.statusText}`);
    logConnectionError(error);
    return;
  }

  logConnectionRecovered();

  if (response.status === 204) {
    return;
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (error) {
    return;
  }

  if (typeof payload !== 'object' || payload === null) {
    return;
  }

  if ('status' in payload && (payload as { status?: string }).status === 'empty') {
    return;
  }

  const message = (payload as { message?: unknown }).message;

  if (!message || typeof message !== 'object') {
    return;
  }

  const { queue, message: envelopeCandidate } = message as MirroredMessage;

  if (typeof queue !== 'string') {
    return;
  }

  const parsedEnvelope = eventEnvelopeSchema.safeParse(envelopeCandidate);

  if (!parsedEnvelope.success) {
    pushStatusMessage?.(
      `⚠️  Received malformed event from queue "${queue}": ${parsedEnvelope.error.message}`,
      'warning'
    );
    return;
  }

  const envelope = parsedEnvelope.data;

  if (seenEvents.has(envelope.eventId)) {
    return;
  }

  seenEvents.add(envelope.eventId);
  onEvent(envelope, { queue });
}

function startPolling(onEvent: OnEvent): () => void {
  let isPolling = false;
  let stopped = false;

  const poll = async () => {
    if (stopped || isSwitching) {
      return;
    }

    try {
      await pollVisualizerQueue(onEvent);
    } catch (error) {
      pushStatusMessage?.(`❌ Unexpected error while polling: ${String(error)}`, 'error');
    }
  };

  void poll();

  const timer = setInterval(async () => {
    if (isPolling || stopped) {
      return;
    }

    isPolling = true;

    try {
      await poll();
    } finally {
      isPolling = false;
    }
  }, POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function findBusinessDirectory(startDir: string): string | null {
  let current: string | null = startDir;

  while (current) {
    const candidate = join(current, BUSINESS_DIR);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

async function readLocalScenarioSummaries(): Promise<ScenarioSummary[]> {
  const businessDir = findBusinessDirectory(process.cwd());

  if (!businessDir) {
    return [];
  }

  const entries = await readdir(businessDir, { withFileTypes: true });
  const summaries: ScenarioSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const name = entry.name.replace(/\.json$/u, '');

    try {
      const scenario = loadScenario(name);
      summaries.push({ name, domainsCount: scenario.domains.length });
    } catch (error) {
      console.warn(`⚠️  Escenario local "${name}" inválido: ${String(error)}`);
    }
  }

  return summaries;
}

async function fetchScenarioSummariesFromRunner(): Promise<ScenarioSummary[]> {
  const url = new URL('/scenarios', scenarioRunnerUrl);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unexpected response ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as ScenarioListPayload;

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.scenarios)) {
    return [];
  }

  const summaries: ScenarioSummary[] = [];

  for (const candidate of payload.scenarios) {
    if (!candidate || typeof candidate.name !== 'string' || typeof candidate.domainsCount !== 'number') {
      continue;
    }

    summaries.push({ name: candidate.name, domainsCount: candidate.domainsCount });
  }

  return summaries;
}

async function getAvailableScenarios(): Promise<ScenarioSummary[]> {
  try {
    const remote = await fetchScenarioSummariesFromRunner();

    if (remote.length > 0) {
      return remote;
    }
  } catch (error) {
    console.warn(
      `⚠️  Unable to fetch scenarios from scenario-runner (${scenarioRunnerUrl}): ${String(error)}`
    );
  }

  return readLocalScenarioSummaries();
}

async function promptScenarioSelection(
  scenarios: ScenarioSummary[],
  currentName: string | null,
  options: {
    allowCancel?: boolean;
    screen?: Renderer['screen'];
    onCancel?: () => void;
    onInvalid?: () => void;
  } = {}
): Promise<string | null> {
  const { allowCancel = false, screen, onCancel, onInvalid } = options;

  let resumeProgram: (() => void) | undefined;

  if (screen) {
    resumeProgram = screen.program.pause() as () => void;
  }

  const rl = createInterface({ input, output });

  try {
    console.log('Escenarios disponibles:');

    scenarios.forEach((scenario, index) => {
      const marker = currentName && scenario.name === currentName ? ' (actual)' : '';
      console.log(`[${index + 1}] ${scenario.name}${marker}`);
    });

    const promptLabel = allowCancel
      ? 'Selecciona escenario (Enter para cancelar): '
      : 'Selecciona escenario: ';

    while (true) {
      const answer = await rl.question(promptLabel);
      const trimmed = answer.trim();

      if (trimmed.length === 0) {
        if (allowCancel) {
          onCancel?.();
          return null;
        }

        console.log('Ingresa el número o el nombre del escenario.');
        continue;
      }

      const parsedIndex = Number.parseInt(trimmed, 10);

      if (!Number.isNaN(parsedIndex)) {
        if (parsedIndex >= 1 && parsedIndex <= scenarios.length) {
          return scenarios[parsedIndex - 1].name;
        }

        if (allowCancel) {
          console.log('Selección inválida. Se mantiene el escenario actual.');
          onInvalid?.();
          return null;
        }
      }

      if (!allowCancel) {
        const match = scenarios.find((scenario) => scenario.name === trimmed);

        if (match) {
          return match.name;
        }

        console.log('Selección inválida. Intenta nuevamente.');
        continue;
      }

      console.log('Selección inválida. Se mantiene el escenario actual.');
      onInvalid?.();
      return null;
    }
  } finally {
    rl.close();

    if (resumeProgram) {
      resumeProgram();
      screen?.render();
    }
  }
}

async function resetMessageQueues(): Promise<boolean> {
  let response: Response;

  try {
    response = await fetch(new URL('/admin/reset', messageQueueUrl), { method: 'POST' });
  } catch (error) {
    const message = `⚠️  No se pudo conectar a la cola de mensajes (${messageQueueUrl}) para reiniciar: ${String(
      error
    )}`;
    console.warn(message);
    pushStatusMessage?.(message, 'warning');
    return false;
  }

  if (!response.ok) {
    const message = `⚠️  Reinicio de colas respondido con ${response.status} ${response.statusText}. Continuando sin reiniciar.`;
    console.warn(message);
    pushStatusMessage?.(message, 'warning');
    return false;
  }

  return true;
}

async function postScenarioRequest(name: string): Promise<void> {
  const response = await fetch(new URL('/scenario', scenarioRunnerUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });

  if (response.ok) {
    return;
  }

  let message = `Unable to switch scenario: ${response.status} ${response.statusText}`;

  try {
    const payload = (await response.json()) as { error?: string };
    if (payload && typeof payload.error === 'string' && payload.error.length > 0) {
      message = payload.error;
    }
  } catch (error) {
    message = `${message} (${String(error)})`;
  }

  throw new Error(message);
}

async function fetchScenarioInfo(): Promise<ScenarioInfoResponse> {
  const response = await fetch(new URL('/scenario', scenarioRunnerUrl));

  if (!response.ok) {
    throw new Error(`Unable to fetch active scenario: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as ScenarioInfoPayload;

  if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string') {
    throw new Error('Invalid response from scenario-runner.');
  }

  if (!Array.isArray(payload.domains) || payload.domains.length === 0) {
    throw new Error('Scenario response did not include domains.');
  }

  const domains: Domain[] = [];

  for (const candidate of payload.domains) {
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.queue !== 'string') {
      continue;
    }

    domains.push({ id: candidate.id, queue: candidate.queue });
  }

  if (domains.length === 0) {
    throw new Error('Scenario response did not include valid domains.');
  }

  return { name: payload.name, domains };
}

async function switchScenario(name: string): Promise<ScenarioInfoResponse> {
  await resetMessageQueues();
  await postScenarioRequest(name);
  return fetchScenarioInfo();
}

function mergeDomainDefinitions(scenario: Scenario, info: ScenarioInfoResponse): Domain[] {
  const domainById = new Map(scenario.domains.map((domain) => [domain.id, domain] as const));

  return info.domains.map((domain) => {
    const definition = domainById.get(domain.id);
    return definition ? { ...definition, queue: domain.queue } : { id: domain.id, queue: domain.queue };
  });
}

function createScenarioContext(scenario: Scenario, domains: Domain[]): ScenarioContext {
  const queueToDomainId: Record<string, string> = {};

  for (const domain of domains) {
    queueToDomainId[domain.queue] = domain.id;
  }

  const eventStateUpdates: Record<string, DomainStatusUpdate[]> = {};

  for (const listener of scenario.listeners) {
    for (const action of listener.actions) {
      if (action.type !== 'set-state') {
        continue;
      }

      const updates = eventStateUpdates[listener.on.event] ?? [];
      updates.push({ domainId: action.domain, status: action.status });
      eventStateUpdates[listener.on.event] = updates;
    }
  }

  const eventFlowTargets: Record<string, string[]> = {};

  for (const listener of scenario.listeners) {
    for (const action of listener.actions) {
      if (action.type !== 'emit') {
        continue;
      }

      const entries = eventFlowTargets[listener.on.event] ?? [];
      entries.push(action.toDomain);
      eventFlowTargets[listener.on.event] = entries;
    }
  }

  const eventNames = new Set<string>(scenario.events.map((event) => event.name));

  return { scenario, domains, queueToDomainId, eventStateUpdates, eventFlowTargets, eventNames };
}

function cleanupResources({ destroyRenderer = true }: { destroyRenderer?: boolean } = {}): void {
  if (!runtimeResources) {
    pushStatusMessage = undefined;
    return;
  }

  runtimeResources.stopPolling();
  clearInterval(runtimeResources.refreshTimer);

  if (destroyRenderer) {
    runtimeResources.renderer.destroy();
  }

  runtimeResources = null;
  pushStatusMessage = undefined;
}

function shutdown(): void {
  cleanupResources();
  process.exit(0);
}

function registerShutdownHandler(): void {
  if (shutdownRegistered) {
    return;
  }

  shutdownRegistered = true;

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.once(signal, () => {
      shutdown();
    });
  });
}

async function activateScenario(name: string, infoOverride?: ScenarioInfoResponse): Promise<void> {
  let scenario: Scenario;

  try {
    scenario = loadScenario(name);
  } catch (error) {
    throw new Error(`Unable to load scenario "${name}": ${String(error)}`);
  }

  const info = infoOverride ?? (await switchScenario(name));
  const domains = mergeDomainDefinitions(scenario, info);
  const context = createScenarioContext(scenario, domains);

  resetExecutions();
  resetTracking();

  const renderer = createRenderer(scenario.name, domains);
  pushStatusMessage = renderer.pushStatusMessage;

  if (configuredFilterCorrelationId) {
    pushStatusMessage?.(
      `🎯 Filtro activo. Mostrando correlationId=${configuredFilterCorrelationId}.`,
      'info'
    );
  }

  pushStatusMessage?.(`✅ Escenario activo: ${scenario.name}.`, 'info');
  pushStatusMessage?.('Pulsa "s" para cambiar de escenario.', 'info');

  const refreshExecutions = () => {
    if (isSwitching) {
      return;
    }

    renderer.renderExecutions(getExecutionRows(domains, globalMaxTraces, Date.now()));
  };

  refreshExecutions();
  const refreshTimer = setInterval(refreshExecutions, REFRESH_INTERVAL_MS);

  const stopPolling = startPolling((envelope, { queue }) => {
    if (isSwitching) {
      return;
    }

    const correlationId = envelope.correlationId?.trim() ?? null;

    if (configuredFilterCorrelationId && correlationId !== configuredFilterCorrelationId) {
      return;
    }

    const timestamp = new Date();
    const formattedTimestamp = chalk.gray(`[${formatTimestamp(timestamp)}]`);
    const queueLabel = chalk.cyan(`[${queue}]`);
    const classification = classifyEvent(envelope.eventName, context);
    const colorizeEvent = classificationToChalk(classification);
    const queueDomainId = context.queueToDomainId[queue];
    const flowTargets = context.eventFlowTargets[envelope.eventName] ?? [];
    const flows: EventFlow[] = queueDomainId
      ? flowTargets.map((toDomainId) => ({ fromDomainId: queueDomainId, toDomainId }))
      : [];
    const entityId = extractEntityId(envelope.data);
    const traceId = envelope.traceId?.trim() ?? null;
    const stateUpdates = context.eventStateUpdates[envelope.eventName] ?? [];

    const result = upsertExecution(
      { traceId, correlationId, domains, updates: stateUpdates },
      timestamp.getTime()
    );

    if (!result) {
      return;
    }

    const details: string[] = [
      `Entity=${entityId}`,
      `Trace=${result.displayId}`,
      `Correlation=${correlationId ?? 'n/a'}`
    ];

    flows.forEach(({ fromDomainId, toDomainId }) => {
      details.push(`from=${fromDomainId} → to=${toDomainId}`);
    });

    renderer.appendLogLine(
      `${formattedTimestamp} ${queueLabel} ${colorizeEvent(envelope.eventName)} (${details.join(', ')})`
    );

    refreshExecutions();

    if (!queueDomainId && !unknownQueuesLogged.has(queue)) {
      unknownQueuesLogged.add(queue);
      pushStatusMessage?.(`⚠️  Unknown queue "${queue}" for current scenario.`, 'warning');
    }

    if (!context.eventNames.has(envelope.eventName) && !unknownEventsLogged.has(envelope.eventName)) {
      unknownEventsLogged.add(envelope.eventName);
      pushStatusMessage?.(
        `⚠️  Unknown event "${envelope.eventName}" for scenario "${context.scenario.name}".`,
        'warning'
      );
    }
  });

  runtimeResources = { renderer, refreshTimer, stopPolling, context };

  registerShutdownHandler();

  renderer.screen.key(['C-c', 'q'], shutdown);
  renderer.screen.key(['s', 'S'], () => {
    void handleScenarioSwitch();
  });
}

async function handleScenarioSwitch(): Promise<void> {
  if (isSwitching) {
    return;
  }

  if (!runtimeResources) {
    return;
  }

  isSwitching = true;
  const previousScenarioName = runtimeResources.context.scenario.name;

  try {
    let scenarios: ScenarioSummary[];

    try {
      scenarios = await fetchScenarioSummariesFromRunner();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `No se pudo cambiar de escenario: ${detail}. Se mantiene el escenario actual.`;
      console.error(`❌ ${message}`);
      pushStatusMessage?.(`❌ ${message}`, 'error');
      return;
    }

    if (scenarios.length === 0) {
      const message =
        'No se pudo cambiar de escenario: el scenario-runner no expuso escenarios. Se mantiene el escenario actual.';
      console.error(`❌ ${message}`);
      pushStatusMessage?.(`❌ ${message}`, 'error');
      return;
    }

    let wasInvalid = false;

    const selectedScenario = await promptScenarioSelection(scenarios, previousScenarioName, {
      allowCancel: true,
      screen: runtimeResources.renderer.screen,
      onInvalid: () => {
        wasInvalid = true;
      }
    });

    if (!selectedScenario) {
      if (wasInvalid) {
        pushStatusMessage?.('Selección inválida. Se mantiene el escenario actual.', 'warning');
      } else {
        pushStatusMessage?.('Cambio de escenario cancelado.', 'info');
      }
      return;
    }

    if (selectedScenario === previousScenarioName) {
      pushStatusMessage?.(`El escenario "${selectedScenario}" ya está activo.`, 'info');
      return;
    }

    try {
      loadScenario(selectedScenario);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `No se pudo cambiar de escenario: ${detail}. Se mantiene el escenario actual.`;
      console.error(`❌ ${message}`);
      pushStatusMessage?.(`❌ ${message}`, 'error');
      return;
    }

    pushStatusMessage?.('Cambiando de escenario...', 'info');

    let info: ScenarioInfoResponse;

    try {
      info = await switchScenario(selectedScenario);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `No se pudo cambiar de escenario: ${detail}. Se mantiene el escenario actual.`;
      console.error(`❌ ${message}`);
      pushStatusMessage?.(`❌ ${message}`, 'error');
      return;
    }

    cleanupResources();

    await activateScenario(selectedScenario, info);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `No se pudo cambiar de escenario: ${detail}. Se mantiene el escenario actual.`;
    console.error(`❌ ${message}`);

    if (!runtimeResources) {
      try {
        await activateScenario(previousScenarioName);
      } catch (recoveryError) {
        const recoveryDetail = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        console.error(
          `❌ Falló la restauración del escenario anterior "${previousScenarioName}": ${recoveryDetail}`
        );
      }
    }

    pushStatusMessage?.(`❌ ${message}`, 'error');
  } finally {
    isSwitching = false;
    runtimeResources?.renderer.screen.render();
  }
}

async function main() {
  try {
    const scenarios = await getAvailableScenarios();

    if (scenarios.length === 0) {
      console.error('❌ No se encontraron escenarios en business/*.json.');
      process.exit(1);
    }

    const envScenarioName = process.env.SCENARIO_NAME?.trim();
    let selectedScenario: string | null = null;

    if (envScenarioName && scenarios.some((scenario) => scenario.name === envScenarioName)) {
      selectedScenario = envScenarioName;
      console.log(`Usando escenario definido en SCENARIO_NAME=${envScenarioName}.`);
    } else if (scenarios.length === 1) {
      selectedScenario = scenarios[0].name;
      console.log(`Escenario único disponible: ${selectedScenario}`);
    } else {
      selectedScenario = await promptScenarioSelection(scenarios, envScenarioName ?? null);
    }

    if (!selectedScenario) {
      throw new Error('No scenario selected.');
    }

    await activateScenario(selectedScenario);
  } catch (error) {
    console.error(`❌ No se pudo iniciar el visualizador: ${String(error)}`);
    process.exit(1);
  }
}

void main();
