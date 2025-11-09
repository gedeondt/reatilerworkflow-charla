import { randomUUID } from 'node:crypto';

import type { EventBus, EventEnvelope } from '@reatiler/shared/event-bus';

import { applyEmitMapping } from './mapping.js';
import type { Listener, ListenerAction, Scenario, ScenarioEvent } from './schema.js';

export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
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

type WorkerController = {
  stop(): void;
  promise: Promise<void>;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createScenarioRuntime({
  scenario,
  bus,
  logger,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}: ScenarioRuntimeOptions): ScenarioRuntime {
  const domainQueues = new Map<string, string>();

  for (const domain of scenario.domains) {
    domainQueues.set(domain.id, domain.queue);
  }

  const listenersByEvent = new Map<string, Listener[]>();
  const eventsByName = new Map<string, ScenarioEvent>();

  for (const listener of scenario.listeners) {
    const listeners = listenersByEvent.get(listener.on.event) ?? [];
    listeners.push(listener);
    listenersByEvent.set(listener.on.event, listeners);
  }

  for (const event of scenario.events) {
    eventsByName.set(event.name, event);
  }

  const state = new Map<string, Map<string, string>>();

  let running = false;
  const workers = new Map<string, WorkerController>();

  function updateState(correlationId: string, domainId: string, status: string): void {
    const domainState = state.get(correlationId) ?? new Map<string, string>();
    domainState.set(domainId, status);
    state.set(correlationId, domainState);
  }

  async function executeEmit(
    action: ListenerAction & { type: 'emit' },
    envelope: EventEnvelope,
    listenerId: string
  ): Promise<void> {
    const targetQueue = domainQueues.get(action.toDomain);

    if (!targetQueue) {
      logger.error(
        { action: 'emit', toDomain: action.toDomain },
        `Unable to emit event "${action.event}" because domain "${action.toDomain}" has no queue.`
      );
      return;
    }

    const destinationEvent = eventsByName.get(action.event);

    if (!destinationEvent) {
      logger.error(
        { action: 'emit', event: action.event },
        `Unable to emit event "${action.event}" because it is not defined in the scenario.`,
      );
      return;
    }

    const traceId = envelope.traceId || randomUUID();

    const sourcePayload = isRecord(envelope.data) ? envelope.data : {};

    const mappedPayload = applyEmitMapping({
      sourcePayload,
      destinationSchema: destinationEvent.payloadSchema,
      mapping: action.mapping,
      warn: ({ message, path }) => {
        logger.warn(
          {
            action: 'emit',
            event: action.event,
            listenerId,
            correlationId: envelope.correlationId,
            path
          },
          message
        );
      }
    });

    const emittedEnvelope: EventEnvelope = {
      eventName: action.event,
      version: 1,
      eventId: randomUUID(),
      traceId,
      correlationId: envelope.correlationId,
      occurredAt: new Date().toISOString(),
      causationId: envelope.eventId,
      data: mappedPayload
    };

    await bus.push(targetQueue, emittedEnvelope);

    logger.info(
      {
        action: 'emit',
        toDomain: action.toDomain,
        event: action.event,
        correlationId: envelope.correlationId
      },
      `Emitted event "${action.event}" to queue "${targetQueue}".`
    );
  }

  async function executeAction(
    action: ListenerAction,
    envelope: EventEnvelope,
    listenerId: string
  ): Promise<void> {
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

    await executeEmit(action, envelope, listenerId);
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
        await executeAction(action, envelope, listener.id);
      } catch (error) {
        logger.error(
          { listener: listener.id, action, error },
          `Failed to execute action for listener "${listener.id}".`
        );
      }
    }
  }

  async function processEnvelope(envelope: EventEnvelope): Promise<void> {
    const listeners = listenersByEvent.get(envelope.eventName);

    if (!listeners || listeners.length === 0) {
      logger.debug(
        { event: envelope.eventName },
        `No listeners registered for event "${envelope.eventName}".`
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

  function createQueueWorker(domainId: string, queueName: string): WorkerController {
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
          logger.error(
            { queue: queueName, domainId, error },
            `Failed to pop event from queue "${queueName}".`
          );
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
          logger.error(
            { queue: queueName, domainId, error },
            `Error while processing event from queue "${queueName}".`
          );
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

  function startWorkers(): void {
    for (const domain of scenario.domains) {
      const existingWorker = workers.get(domain.id);

      if (existingWorker) {
        continue;
      }

      const controller = createQueueWorker(domain.id, domain.queue);
      workers.set(domain.id, controller);
    }
  }

  async function stopWorkers(): Promise<void> {
    const controllers = Array.from(workers.values());
    workers.clear();

    controllers.forEach((controller) => controller.stop());
    await Promise.allSettled(controllers.map((controller) => controller.promise));
  }

  return {
    async start(): Promise<void> {
      if (running) {
        return;
      }

      running = true;
      startWorkers();
    },
    async stop(): Promise<void> {
      if (!running && workers.size === 0) {
        return;
      }

      running = false;
      await stopWorkers();
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
