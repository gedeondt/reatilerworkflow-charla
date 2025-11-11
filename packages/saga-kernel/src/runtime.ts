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

type ListenerContext = { listener: Listener; domainId: string };

export function createScenarioRuntime({
  scenario,
  bus,
  logger,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
}: ScenarioRuntimeOptions): ScenarioRuntime {
  const domainQueues = new Map<string, string>();
  const listenersByEvent = new Map<string, ListenerContext[]>();
  const eventsByName = new Map<string, { event: ScenarioEvent; domainId: string }>();

  for (const domain of scenario.domains) {
    domainQueues.set(domain.id, domain.queue);

    for (const event of domain.events ?? []) {
      eventsByName.set(event.name, { event, domainId: domain.id });
    }

    for (const listener of domain.listeners ?? []) {
      const contexts = listenersByEvent.get(listener.on.event) ?? [];
      contexts.push({ listener, domainId: domain.id });
      listenersByEvent.set(listener.on.event, contexts);
    }
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
    const destinationEntry = eventsByName.get(action.event);

    if (!destinationEntry) {
      logger.error(
        { action: 'emit', event: action.event },
        `Unable to emit event "${action.event}" because it is not defined in the scenario.`,
      );
      return;
    }

    const targetDomainId = action.toDomain ?? destinationEntry.domainId;
    const targetQueue = domainQueues.get(targetDomainId);

    if (!targetQueue) {
      logger.error(
        { action: 'emit', toDomain: targetDomainId },
        `Unable to emit event "${action.event}" because domain "${targetDomainId}" has no queue.`
      );
      return;
    }

    const traceId = envelope.traceId || randomUUID();

    const sourcePayload = isRecord(envelope.data) ? envelope.data : {};

    const mappedPayload = applyEmitMapping({
      sourcePayload,
      destinationSchema: destinationEntry.event.payloadSchema,
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
        toDomain: targetDomainId,
        event: action.event,
        correlationId: envelope.correlationId
      },
      `Emitted event "${action.event}" to queue "${targetQueue}".`
    );
  }

  async function executeAction(
    action: ListenerAction,
    envelope: EventEnvelope,
    listenerId: string,
    listenerDomainId: string
  ): Promise<void> {
    if (action.type === 'set-state') {
      updateState(envelope.correlationId, listenerDomainId, action.status);

      logger.debug({
        action: 'set-state',
        correlationId: envelope.correlationId,
        domain: listenerDomainId,
        status: action.status
      });

      return;
    }

    await executeEmit(action, envelope, listenerId);
  }

  async function executeListener(
    context: ListenerContext,
    envelope: EventEnvelope
  ): Promise<void> {
    const { listener, domainId } = context;

    if (typeof listener.delayMs === 'number' && listener.delayMs > 0) {
      await delay(listener.delayMs);
    }

    for (const action of listener.actions) {
      if (!running) {
        break;
      }

      try {
        await executeAction(action, envelope, listener.id, domainId);
      } catch (error) {
        logger.error(
          { listener: listener.id, action, error },
          `Failed to execute action for listener "${listener.id}".`
        );
      }
    }
  }

  async function processEnvelope(envelope: EventEnvelope): Promise<void> {
    const listenerContexts = listenersByEvent.get(envelope.eventName);

    if (!listenerContexts || listenerContexts.length === 0) {
      logger.debug(
        { event: envelope.eventName },
        `No listeners registered for event "${envelope.eventName}".`
      );
      return;
    }

    for (const context of listenerContexts) {
      if (!running) {
        break;
      }

      await executeListener(context, envelope);
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
