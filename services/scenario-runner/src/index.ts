import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';

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

const app = Fastify({ logger: true });

let currentScenarioName: string | null = null;
let currentScenario: Scenario | null = null;
let currentRuntime: ScenarioRuntime | null = null;

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
    await stopRuntime();
  } catch (error) {
    app.log.error({ err: error }, 'failed to stop previous scenario runtime');
    return reply.status(500).send({ error: 'Unable to stop current scenario runtime.' });
  }

  try {
    await startRuntime(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    app.log.error({ err: error }, 'failed to start new scenario runtime');
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
    await startRuntime(env.SCENARIO_NAME);

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info({ port: env.PORT }, 'scenario-runner listening');
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
