import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

import Fastify from 'fastify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';

import {
  createScenarioRuntime,
  loadScenario,
  type Scenario,
  type ScenarioRuntime
} from '@reatiler/saga-kernel';
import { createHttpEventBus } from '@reatiler/shared';

import { env } from './env.js';

const BUSINESS_DIR = 'business';
const SCENARIO_POLL_INTERVAL_MS = 2000;

const app = Fastify({ logger: true });

app.addHook('onResponse', (request, reply, done) => {
  const [path] = request.url.split('?');
  const isRoutineRoute =
    path === '/traces' ||
    path === '/logs' ||
    path === '/scenario' ||
    path.startsWith('/kv/');

  if (isRoutineRoute) {
    done();
    return;
  }

  request.log.info({ url: request.url, statusCode: reply.statusCode }, 'handled');
  done();
});

let currentScenarioName: string | null = null;
let currentScenario: Scenario | null = null;
let currentRuntime: ScenarioRuntime | null = null;
let scenarioSyncStopped = false;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

type HttpJsonResult<T> = { status: number; body: T };

async function httpJson<T>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<HttpJsonResult<T>> {
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  let payload: string | undefined;

  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  const requestOptions: RequestOptions = {
    method: options.method ?? 'GET',
    hostname: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    path: `${parsed.pathname}${parsed.search}` || '/',
    headers,
  };

  return new Promise((resolve, reject) => {
    const req = requestFn(requestOptions, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });

      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString('utf-8');

        let parsedBody: unknown = null;

        if (text.length > 0) {
          try {
            parsedBody = JSON.parse(text) as T;
          } catch (error) {
            const parseError = new Error(
              `Failed to parse JSON response from ${url}`,
            );
            (parseError as { cause?: unknown }).cause = error;
            return reject(parseError);
          }
        }

        if (status < 200 || status >= 300) {
          const error = new Error(
            `Request to ${url} failed with status ${status}`,
          );
          (error as { status?: number }).status = status;
          (error as { body?: string }).body = text;
          return reject(error);
        }

        resolve({ status, body: parsedBody as T });
      });
    });

    req.on('error', reject);

    if (payload) {
      req.setHeader('Content-Length', Buffer.byteLength(payload));
      req.write(payload);
    }

    req.end();
  });
}

const extractErrorMessage = (error: unknown): string => {
  if (error && typeof error === 'object' && 'body' in error) {
    const body = (error as { body?: string }).body;

    if (typeof body === 'string' && body.length > 0) {
      try {
        const parsed = JSON.parse(body) as { error?: unknown };

        if (parsed && typeof parsed.error === 'string') {
          return parsed.error;
        }
      } catch {
        return body;
      }
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

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

async function listScenarioNames(): Promise<string[]> {
  const businessDir = findBusinessDirectory(process.cwd());

  if (!businessDir) {
    return [];
  }

  const entries = await readdir(businessDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && extname(entry.name) === '.json')
    .map((entry) => entry.name.replace(/\.json$/u, ''));
}

async function fetchVisualizerScenarioName(): Promise<string | null> {
  try {
    const { body } = await httpJson<{ name?: string }>(
      `${env.VISUALIZER_API_URL}/scenario`,
    );

    if (body && typeof body.name === 'string' && body.name.length > 0) {
      return body.name;
    }

    app.log.warn(
      { response: body },
      'visualizer-api returned an invalid scenario payload',
    );
  } catch (error) {
    app.log.warn({ err: error }, 'failed to fetch active scenario from visualizer-api');
  }

  return null;
}

async function requestScenarioChange(name: string): Promise<void> {
  await httpJson(`${env.VISUALIZER_API_URL}/scenario`, {
    method: 'POST',
    body: { name },
  });
}

async function stopRuntime(): Promise<void> {
  if (!currentRuntime) {
    currentScenarioName = null;
    currentScenario = null;
    return;
  }

  const runtime = currentRuntime;
  currentRuntime = null;
  currentScenario = null;
  currentScenarioName = null;

  try {
    await runtime.stop();
    app.log.info('scenario runtime stopped');
  } catch (error) {
    app.log.error({ err: error }, 'failed to stop scenario runtime');
    throw error;
  }
}

async function startRuntime(name: string): Promise<void> {
  if (currentScenarioName === name && currentRuntime) {
    app.log.info({ scenario: name }, 'scenario already running');
    return;
  }

  if (currentRuntime) {
    await stopRuntime();
  }

  app.log.info({ scenario: name }, 'starting scenario runtime');

  const scenario = loadScenario(name);
  const bus = createHttpEventBus(env.MESSAGE_QUEUE_URL);
  const runtime = createScenarioRuntime({
    scenario,
    bus,
    logger: app.log,
    pollIntervalMs: 200
  });

  try {
    await runtime.start();
  } catch (error) {
    app.log.error({ err: error, scenario: name }, 'failed to start scenario runtime');
    throw error;
  }

  currentScenarioName = name;
  currentScenario = scenario;
  currentRuntime = runtime;

  app.log.info({ scenario: name }, 'scenario runtime started');
}

async function syncScenarioWithVisualizer(): Promise<void> {
  while (!scenarioSyncStopped) {
    const remoteScenario = await fetchVisualizerScenarioName();

    if (remoteScenario && remoteScenario !== currentScenarioName) {
      try {
        await startRuntime(remoteScenario);
      } catch (error) {
        app.log.error(
          { err: error, scenario: remoteScenario },
          'failed to synchronize scenario runtime with visualizer-api',
        );
      }
    }

    await delay(SCENARIO_POLL_INTERVAL_MS);
  }
}

function ensureScenarioResponse(reply: FastifyReply) {
  if (!currentScenario || !currentScenarioName) {
    void reply.status(503).send({ error: 'No scenario is currently running.' });
    return null;
  }

  return {
    name: currentScenarioName,
    domains: currentScenario.domains.map((domain) => ({ id: domain.id, queue: domain.queue }))
  };
}

app.get('/health', async () => ({
  status: 'ok',
  scenario: currentScenarioName
}));

app.get('/scenario', async (_req, reply) => {
  const response = ensureScenarioResponse(reply);

  if (!response) {
    return;
  }

  await reply.send(response);
});

app.get('/scenarios', async (_req, reply) => {
  const names = await listScenarioNames();
  const scenarios: Array<{ name: string; domainsCount: number }> = [];

  for (const name of names) {
    try {
      const scenario = loadScenario(name);
      scenarios.push({ name, domainsCount: scenario.domains.length });
    } catch (error) {
      app.log.warn({ err: error, scenario: name }, 'skipping invalid scenario definition');
    }
  }

  await reply.send({ scenarios });
});

const scenarioBodySchema = z.object({ name: z.string().min(1) });

app.post('/scenario', async (req, reply) => {
  const { name } = scenarioBodySchema.parse(req.body);

  try {
    loadScenario(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.status(400).send({ error: message });
  }

  try {
    await requestScenarioChange(name);
  } catch (error) {
    const status = (error as { status?: number }).status;
    const statusCode =
      typeof status === 'number' && status >= 400 && status < 500 ? status : 502;
    const message = extractErrorMessage(error);
    app.log.error({ err: error }, 'failed to update scenario in visualizer-api');
    return reply.status(statusCode).send({ error: message });
  }

  try {
    await startRuntime(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    app.log.error(
      { err: error, scenario: name },
      'failed to start scenario runtime after switching via visualizer-api',
    );
    return reply.status(500).send({ error: message });
  }

  app.log.info(`Switched scenario to "${name}".`);

  const response = ensureScenarioResponse(reply);

  if (!response) {
    return;
  }

  await reply.send(response);
});

let shuttingDown = false;

async function start() {
  try {
    scenarioSyncStopped = false;
    const remoteScenario = await fetchVisualizerScenarioName();
    const initialScenario = remoteScenario ?? env.SCENARIO_NAME;

    if (remoteScenario) {
      app.log.info(
        { scenario: remoteScenario },
        'using scenario from visualizer-api as initial runtime',
      );
    }

    await startRuntime(initialScenario);

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info({ port: env.PORT }, 'scenario-runner listening');

    void syncScenarioWithVisualizer().catch((error) => {
      app.log.error({ err: error }, 'scenario synchronization loop crashed');
    });
  } catch (error) {
    app.log.error({ err: error }, 'failed to start scenario-runner');

    try {
      await stopRuntime();
    } catch (stopError) {
      app.log.error({ err: stopError }, 'failed to stop runtime during startup');
    }

    process.exit(1);
  }
}

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  app.log.info({ signal }, 'shutting down scenario-runner');
  scenarioSyncStopped = true;

  try {
    await stopRuntime();
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'error during scenario-runner shutdown');
    process.exit(1);
  }
}

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    void shutdown(signal as NodeJS.Signals);
  });
});

void start();
