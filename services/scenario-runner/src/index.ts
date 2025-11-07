import Fastify from 'fastify';

import { createScenarioRuntime, loadScenario } from '@reatiler/saga-kernel';
import { createHttpEventBus } from '@reatiler/shared';

import { env } from './env.js';

const app = Fastify({ logger: true });

const scenario = loadScenario(env.SCENARIO_NAME);
const bus = createHttpEventBus(env.MESSAGE_QUEUE_URL);

const runtime = createScenarioRuntime({
  scenario,
  bus,
  logger: app.log,
  pollIntervalMs: 200
});

app.get('/health', async () => ({
  status: 'ok',
  scenario: scenario.name
}));

let shuttingDown = false;

async function start() {
  try {
    app.log.info({
      scenario: scenario.name,
      queueUrl: env.MESSAGE_QUEUE_URL
    }, 'starting scenario-runner');

    await runtime.start();
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info({ port: env.PORT }, 'scenario-runner listening');
  } catch (error) {
    app.log.error({ err: error }, 'failed to start scenario-runner');

    try {
      await runtime.stop();
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
    await runtime.stop();
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
