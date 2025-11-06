import { describe, expect, it, vi } from 'vitest';

import { FakeEventBus } from '@reatiler/shared/event-bus';

import { createDispatcher } from '../src/events/dispatcher.js';
import { createWorker } from '../src/events/worker.js';
import type { EventEnvelope } from '../src/events/types.js';

const waitUntil = async (predicate: () => boolean, timeout = 500) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('timeout waiting for condition');
};

describe('shipping worker', () => {
  const baseEvent: EventEnvelope = {
    eventName: 'ShipmentPrepared',
    version: 1,
    eventId: 'evt-1',
    traceId: 'trace-1',
    correlationId: 'corr-1',
    occurredAt: new Date().toISOString(),
    data: {}
  };

  it('procesa eventos nuevos una sola vez', async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
    const dispatcher = createDispatcher(logger);
    const dispatchSpy = vi.spyOn(dispatcher, 'dispatch');

    const bus = new FakeEventBus();
    const worker = createWorker({
      logger,
      dispatcher,
      bus,
      pollIntervalMs: 10
    });

    worker.start();

    try {
      await bus.push('shipping', baseEvent);
      await waitUntil(() => dispatchSpy.mock.calls.length === 1);

      await bus.push('shipping', baseEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(dispatchSpy).toHaveBeenCalledTimes(1);
    } finally {
      await worker.stop();
    }
  });

  it('sigue en ejecución cuando la cola está vacía sin loguear errores', async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
    const dispatcher = createDispatcher(logger);
    const dispatchSpy = vi.spyOn(dispatcher, 'dispatch');

    const bus = new FakeEventBus();
    const popSpy = vi.spyOn(bus, 'pop');
    const worker = createWorker({
      logger,
      dispatcher,
      bus,
      pollIntervalMs: 10
    });

    worker.start();

    try {
      await waitUntil(() => popSpy.mock.calls.length >= 2);
      expect(worker.isRunning()).toBe(true);
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      await worker.stop();
    }
  });
});
