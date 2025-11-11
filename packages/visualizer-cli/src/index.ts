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
type VisualizerState = { scenarioName: string; domains: Domain[] };
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
type UiMode = 'visualizer' | 'scenario-menu';

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
let isRunning = true;
let isSwitching = false;
let connectionErrorLogged = false;
let seenEvents = new Set<string>();
let unknownQueuesLogged = new Set<string>();
let unknownEventsLogged = new Set<string>();
let pushStatusMessage: ((message: string, level: LogLevel) => void) | undefined;
let uiMode: UiMode = 'visualizer';

function renderLayout(state: VisualizerState): void {
  if (!runtimeResources) {
    return;
  }

  console.clear();
  runtimeResources.renderer.renderExecutions(
    getExecutionRows(state.domains, globalMaxTraces, Date.now())
  );
  runtimeResources.renderer.screen.render();
}

function renderSystemMessage(message: string, level: LogLevel = 'info'): void {
  pushStatusMessage?.(message, level);
}

function enableVisualizerInput(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();
  process.stdin.removeListener('data', onKey);
  process.stdin.on('data', onKey);
}

function disableVisualizerInput(): void {
  process.stdin.removeListener('data', onKey);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
}

function onKey(chunk: Buffer): void {
  if (uiMode !== 'visualizer') {
    return;
  }

  const inputKey = chunk.toString('utf8');

  if (inputKey === '\u0003' || inputKey === 'q' || inputKey === 'Q') {
    shutdown();
    return;
  }

  if (inputKey === 's' || inputKey === 'S') {
    void switchScenarioInteractive();
  }
}

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

  renderSystemMessage(`⚠️  Unable to reach message queue at ${messageQueueUrl}: ${message}`, 'warning');
}

function logConnectionRecovered() {
  if (!connectionErrorLogged) {
    return;
  }

  connectionErrorLogged = false;
  renderSystemMessage('✅ Connection to message queue restored.', 'info');
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
    renderSystemMessage(
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
    if (stopped || !isRunning || isSwitching || uiMode !== 'visualizer') {
      return;
    }

    try {
      await pollVisualizerQueue(onEvent);
    } catch (error) {
      renderSystemMessage(`❌ Unexpected error while polling: ${String(error)}`, 'error');
    }
  };

  void poll();

  const timer = setInterval(async () => {
    if (isPolling || stopped || !isRunning || uiMode !== 'visualizer') {
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
    renderSystemMessage(message, 'warning');
    return false;
  }

  if (!response.ok) {
    const message = `⚠️  Reinicio de colas respondido con ${response.status} ${response.statusText}. Continuando sin reiniciar.`;
    console.warn(message);
    renderSystemMessage(message, 'warning');
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

  const eventOwners = new Map<string, string>();

  for (const domain of scenario.domains) {
    for (const event of domain.events ?? []) {
      eventOwners.set(event.name, domain.id);
    }
  }

  for (const domain of scenario.domains) {
    for (const listener of domain.listeners ?? []) {
      for (const action of listener.actions) {
        if (action.type !== 'set-state') {
          continue;
        }

        const updates = eventStateUpdates[listener.on.event] ?? [];
        updates.push({ domainId: domain.id, status: action.status });
        eventStateUpdates[listener.on.event] = updates;
      }
    }
  }

  const eventFlowTargets: Record<string, string[]> = {};

  for (const domain of scenario.domains) {
    for (const listener of domain.listeners ?? []) {
      for (const action of listener.actions) {
        if (action.type !== 'emit') {
          continue;
        }

        const entries = eventFlowTargets[listener.on.event] ?? [];
        const targetDomain = action.toDomain ?? eventOwners.get(action.event);

        if (targetDomain) {
          entries.push(targetDomain);
        }

        eventFlowTargets[listener.on.event] = entries;
      }
    }
  }

  const eventNames = new Set<string>(eventOwners.keys());

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

async function activateScenario(name: string, infoOverride?: ScenarioInfoResponse): Promise<VisualizerState> {
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
    renderSystemMessage(
      `🎯 Filtro activo. Mostrando correlationId=${configuredFilterCorrelationId}.`,
      'info'
    );
  }

  renderSystemMessage(`✅ Escenario activo: ${scenario.name}.`, 'info');
  renderSystemMessage('Pulsa "s" para cambiar de escenario.', 'info');

  const refreshExecutions = () => {
    if (!isRunning || isSwitching || uiMode !== 'visualizer') {
      return;
    }

    renderer.renderExecutions(getExecutionRows(domains, globalMaxTraces, Date.now()));
  };

  const refreshTimer = setInterval(refreshExecutions, REFRESH_INTERVAL_MS);

  const stopPolling = startPolling((envelope, { queue }) => {
    if (isSwitching || uiMode !== 'visualizer') {
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
      renderSystemMessage(`⚠️  Unknown queue "${queue}" for current scenario.`, 'warning');
    }

    if (!context.eventNames.has(envelope.eventName) && !unknownEventsLogged.has(envelope.eventName)) {
      unknownEventsLogged.add(envelope.eventName);
      renderSystemMessage(
        `⚠️  Unknown event "${envelope.eventName}" for scenario "${context.scenario.name}".`,
        'warning'
      );
    }
  });

  runtimeResources = { renderer, refreshTimer, stopPolling, context };

  registerShutdownHandler();
  isRunning = true;

  return { scenarioName: scenario.name, domains };
}

function cloneScenarioInfo({ name, domains }: ScenarioInfoResponse): ScenarioInfoResponse {
  return { name, domains: domains.map((domain) => ({ id: domain.id, queue: domain.queue })) };
}

function resetStateWithScenario(payload: ScenarioInfoPayload): ScenarioInfoResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Respuesta inválida del scenario-runner.');
  }

  if (typeof payload.name !== 'string' || payload.name.length === 0) {
    throw new Error('La respuesta del escenario no incluye nombre.');
  }

  if (!Array.isArray(payload.domains) || payload.domains.length === 0) {
    throw new Error('La respuesta del escenario no incluye dominios.');
  }

  const domains: Domain[] = [];

  for (const candidate of payload.domains) {
    if (!candidate || typeof candidate.id !== 'string' || typeof candidate.queue !== 'string') {
      continue;
    }

    domains.push({ id: candidate.id, queue: candidate.queue });
  }

  if (domains.length === 0) {
    throw new Error('La respuesta del escenario no incluye dominios válidos.');
  }

  resetExecutions();
  resetTracking();

  return { name: payload.name, domains };
}

async function readLineOnce(): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    return await rl.question('');
  } finally {
    rl.close();
  }
}

async function readNumberOrEmpty(): Promise<number | null> {
  const line = (await readLineOnce()).trim();

  if (line === '') {
    return null;
  }

  const parsed = Number.parseInt(line, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }

  return parsed - 1;
}

async function waitForEnter(): Promise<void> {
  await readLineOnce();
}

async function switchScenarioInteractive(): Promise<void> {
  if (uiMode !== 'visualizer' || isSwitching || !runtimeResources) {
    return;
  }

  uiMode = 'scenario-menu';
  isSwitching = true;

  disableVisualizerInput();

  const previousScenarioInfo = cloneScenarioInfo({
    name: runtimeResources.context.scenario.name,
    domains: runtimeResources.context.domains
  });

  cleanupResources();
  isRunning = false;

  let scenarioInfoForActivation: ScenarioInfoResponse = previousScenarioInfo;
  let scenarioInfoOverride: ScenarioInfoResponse | undefined = previousScenarioInfo;
  let activateInFinally = true;
  const pendingMessages: Array<{ text: string; level: LogLevel }> = [];

  try {
    console.clear();
    console.log('=== Cambiar de escenario ===');
    console.log('');

    let response: Response;

    try {
      response = await fetch(new URL('/scenarios', scenarioRunnerUrl));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.log(`No se pudo obtener /scenarios (${detail}). Pulsa Enter para volver.`);
      await waitForEnter();
      pendingMessages.push({ text: 'No se pudo obtener la lista de escenarios.', level: 'error' });
      return;
    }

    if (!response.ok) {
      console.log(`No se pudo obtener /scenarios (${response.status}). Pulsa Enter para volver.`);
      await waitForEnter();
      pendingMessages.push({ text: 'No se pudo obtener la lista de escenarios.', level: 'error' });
      return;
    }

    let payload: ScenarioListPayload | null = null;

    try {
      payload = (await response.json()) as ScenarioListPayload;
    } catch (error) {
      console.log('No se pudo parsear /scenarios. Pulsa Enter para volver.');
      await waitForEnter();
      pendingMessages.push({ text: 'No se pudo parsear la lista de escenarios.', level: 'error' });
      return;
    }

    const scenarioEntries = Array.isArray(payload?.scenarios)
      ? payload.scenarios.filter(
          (entry): entry is { name: string; domainsCount?: number } =>
            Boolean(entry && typeof entry.name === 'string')
        )
      : [];

    if (scenarioEntries.length === 0) {
      console.log('No se encontraron escenarios disponibles. Pulsa Enter para volver.');
      await waitForEnter();
      pendingMessages.push({ text: 'No hay escenarios disponibles.', level: 'error' });
      return;
    }

    scenarioEntries.forEach((entry, index) => {
      const marker = entry.name === previousScenarioInfo.name ? ' (actual)' : '';
      console.log(`[${index + 1}] ${entry.name}${marker}`);
    });

    console.log('');
    process.stdout.write('Selecciona escenario (Enter para cancelar): ');
    const selectedIndex = await readNumberOrEmpty();

    if (selectedIndex === null) {
      return;
    }

    if (selectedIndex < 0 || selectedIndex >= scenarioEntries.length) {
      console.log('Selección inválida. Pulsa Enter para volver.');
      await waitForEnter();
      pendingMessages.push({ text: 'Selección inválida. Se mantiene el escenario actual.', level: 'warning' });
      return;
    }

    const selectedScenario = scenarioEntries[selectedIndex];

    if (selectedScenario.name === previousScenarioInfo.name) {
      pendingMessages.push({ text: `El escenario "${selectedScenario.name}" ya está activo.`, level: 'info' });
      return;
    }

    try {
      await fetch(new URL('/admin/reset', messageQueueUrl), { method: 'POST' });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  No se pudo resetear colas: ${detail}`);
      pendingMessages.push({ text: `⚠️  No se pudo resetear colas: ${detail}`, level: 'warning' });
    }

    const switchResponse = await fetch(new URL('/scenario', scenarioRunnerUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: selectedScenario.name })
    });

    if (!switchResponse.ok) {
      console.log(`No se pudo cambiar de escenario (${switchResponse.status}). Pulsa Enter para volver.`);
      await waitForEnter();
      pendingMessages.push({ text: `No se pudo cambiar al escenario "${selectedScenario.name}".`, level: 'error' });
      return;
    }

    const currentResponse = await fetch(new URL('/scenario', scenarioRunnerUrl));

    if (!currentResponse.ok) {
      console.log(`No se pudo obtener escenario activo (${currentResponse.status}). Pulsa Enter para volver.`);
      await waitForEnter();
      pendingMessages.push({ text: 'No se pudo obtener el escenario activo.', level: 'error' });
      return;
    }

    const currentPayload = (await currentResponse.json()) as ScenarioInfoPayload;
    const parsedInfo = resetStateWithScenario(currentPayload);

    scenarioInfoForActivation = parsedInfo;
    scenarioInfoOverride = parsedInfo;

    console.clear();
    uiMode = 'visualizer';
    const visualizerState = await activateScenario(parsedInfo.name, parsedInfo);
    renderLayout(visualizerState);
    activateInFinally = false;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`No se pudo cambiar de escenario: ${detail}. Pulsa Enter para volver.`);
    await waitForEnter();
    pendingMessages.push({ text: `No se pudo cambiar de escenario: ${detail}.`, level: 'error' });
  } finally {
    if (activateInFinally) {
      console.clear();
      uiMode = 'visualizer';

      try {
        const state = await activateScenario(
          scenarioInfoForActivation.name,
          scenarioInfoOverride ? cloneScenarioInfo(scenarioInfoOverride) : undefined
        );
        renderLayout(state);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(`❌ Falló la activación del escenario "${scenarioInfoForActivation.name}": ${detail}`);
      }
    }

    enableVisualizerInput();

    isRunning = true;
    isSwitching = false;

    if (pendingMessages.length > 0) {
      for (const message of pendingMessages) {
        renderSystemMessage(message.text, message.level);
      }
    }
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

    const state = await activateScenario(selectedScenario);
    console.clear();
    uiMode = 'visualizer';
    renderLayout(state);
    enableVisualizerInput();
  } catch (error) {
    console.error(`❌ No se pudo iniciar el visualizador: ${String(error)}`);
    process.exit(1);
  }
}

void main();
