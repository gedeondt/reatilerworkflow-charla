import { randomUUID } from 'node:crypto';

import type { EventBus, EventEnvelope } from '@reatiler/shared';

import type { Listener, ListenerAction, Scenario } from './schema.js';

export type Logger = {
  info: (...args: any[]) => void;
  error: (...args: any[]) => void;
  debug: (...args: any[]) => void;
};

export type ScenarioRuntimeOptions = {
  scenario: Scenario;
  bus: EventBus;
  logger: Logger;
  pollIntervalMs?: number;
};

export type ScenarioRuntime = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStateSnapshot(): Record<string, Record<string, string>>;
};

const DEFAULT_POLL_INTERVAL_MS = 10;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createScenarioRuntime({
  scenario,
  bus,
  logger,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}: ScenarioRuntimeOptions): ScenarioRuntime {
  const domainQueues = new Map<string, string>();
  scenario.domains.forEach((domain) => {
    domainQueues.set(domain.id, domain.queue);
  });

  const listenersByEvent = new Map<string, Listener[]>();

  for (const listener of scenario.listeners) {
    const existing = listenersByEvent.get(listener.on.event) ?? [];
    existing.push(listener);
    listenersByEvent.set(listener.on.event, existing);
  }

  const state = new Map<string, Map<string, string>>();

  let running = false;
  let workerControllers: Array<{ stop(): void; promise: Promise<void> }> = [];

  function updateState(correlationId: string, domainId: string, status: string): void {
    const domainState = state.get(correlationId) ?? new Map<string, string>();
    domainState.set(domainId, status);
    state.set(correlationId, domainState);
  }

  async function executeAction(action: ListenerAction, envelope: EventEnvelope): Promise<void> {
    if (action.type === 'set-state') {
      updateState(envelope.correlationId, action.domain, action.status);
      logger.debug({
        action: 'set-state',
        correlationId: envelope.correlationId,
        domain: action.domain,
        status: action.status
      });
      return;
    }

    const targetQueue = domainQueues.get(action.toDomain);

    if (!targetQueue) {
      logger.error(
        {
          action: 'emit',
          toDomain: action.toDomain
        },
        `Unable to emit event "${action.event}" because domain "${action.toDomain}" has no queue`
      );
      return;
    }

    const traceId = envelope.traceId && envelope.traceId.length > 0 ? envelope.traceId : randomUUID();

    const newEnvelope: EventEnvelope = {
      eventName: action.event,
      version: 1,
      eventId: randomUUID(),
      traceId,
      correlationId: envelope.correlationId,
      occurredAt: new Date().toISOString(),
      causationId: envelope.eventId,
      data: envelope.data
    };

    await bus.push(targetQueue, newEnvelope);
    logger.info(
      {
        action: 'emit',
        toDomain: action.toDomain,
        event: action.event,
        correlationId: envelope.correlationId
      },
      `Emitted event "${action.event}" to queue "${targetQueue}"`
    );
  }

  async function executeListener(listener: Listener, envelope: EventEnvelope): Promise<void> {
    if (typeof listener.delayMs === 'number' && listener.delayMs > 0) {
      await delay(listener.delayMs);
    }

    for (const action of listener.actions) {
      if (!running) {
        break;
      }

      try {
        await executeAction(action, envelope);
      } catch (error) {
        logger.error(
          {
            listener: listener.id,
            action,
            error
          },
          `Failed to execute action for listener "${listener.id}"`
        );
      }
    }
  }

  async function processEnvelope(envelope: EventEnvelope): Promise<void> {
    const listeners = listenersByEvent.get(envelope.eventName);

    if (!listeners || listeners.length === 0) {
      logger.debug(
        { event: envelope.eventName },
        `No listeners registered for event "${envelope.eventName}"`
      );
      return;
    }

    for (const listener of listeners) {
      if (!running) {
        break;
      }

      await executeListener(listener, envelope);
    }
  }

  function createQueueWorker(queueName: string): { stop(): void; promise: Promise<void> } {
    let stopped = false;

    const promise = (async () => {
      while (!stopped) {
        if (!running) {
          await delay(pollIntervalMs);
          continue;
        }

        let envelope: EventEnvelope | null = null;

        try {
          envelope = await bus.pop(queueName);
        } catch (error) {
          logger.error({ queue: queueName, error }, `Failed to pop event from queue "${queueName}"`);
          await delay(pollIntervalMs);
          continue;
        }

        if (!running) {
          continue;
        }

        if (!envelope) {
          await delay(pollIntervalMs);
          continue;
        }

        try {
          await processEnvelope(envelope);
        } catch (error) {
          logger.error({ queue: queueName, error }, `Error while processing event from "${queueName}"`);
        }
      }
    })();

    return {
      stop(): void {
        stopped = true;
      },
      promise
    };
  }

  return {
    async start(): Promise<void> {
      if (running) {
        return;
      }

      running = true;
      workerControllers = scenario.domains.map((domain) => createQueueWorker(domain.queue));
    },
    async stop(): Promise<void> {
      if (!running) {
        return;
      }

      running = false;
      const controllers = workerControllers;
      workerControllers = [];

      controllers.forEach((controller) => controller.stop());
      await Promise.allSettled(controllers.map((controller) => controller.promise));
    },
    getStateSnapshot(): Record<string, Record<string, string>> {
      const snapshot: Record<string, Record<string, string>> = {};

      for (const [correlationId, domainState] of state.entries()) {
        snapshot[correlationId] = Object.fromEntries(domainState.entries());
      }

      return snapshot;
    }
  };
}
