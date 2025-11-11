import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeEventBus, type EventEnvelope } from '../src/event-bus.js';
import { startWorker } from '../src/worker.js';

describe('startWorker', () => {
  const baseEvent: EventEnvelope = {
    eventName: 'OrderPlaced',
    version: 1,
    eventId: 'evt-1',
    traceId: 'trace-1',
    correlationId: 'order-1',
    occurredAt: new Date('2024-04-15T12:00:00.000Z').toISOString(),
    data: {
      orderId: 'order-1'
    }
  };

  let bus: FakeEventBus;
  let logger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    bus = new FakeEventBus();
    logger = {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
  });

  it('keeps polling without logging when the queue is empty', async () => {
    const worker = startWorker({
      queueName: 'orders',
      bus,
      dispatch: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      markProcessed: vi.fn(),
      pollIntervalMs: 10,
      logger
    });

    const popSpy = vi.spyOn(bus, 'pop');

    worker.start();

    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(worker.isRunning()).toBe(true);
      expect(popSpy.mock.calls.length).toBeGreaterThan(1);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    } finally {
      await worker.stop();
    }
  });

  it('dispatches events exactly once and updates status', async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const isProcessed = vi.fn().mockResolvedValue(false);
    const markProcessed = vi.fn().mockResolvedValue(undefined);

    const worker = startWorker({
      queueName: 'orders',
      bus,
      dispatch,
      isProcessed,
      markProcessed,
      pollIntervalMs: 10,
      logger
    });

    worker.start();

    try {
      await bus.push('orders', baseEvent);

      await new Promise((resolve) => setTimeout(resolve, 35));

      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(isProcessed).toHaveBeenCalledWith('evt-1');
      expect(markProcessed).toHaveBeenCalledWith('evt-1');

      const status = worker.getStatus();
      expect(status.processedCount).toBe(1);
      expect(status.lastEventAt).toBe(baseEvent.occurredAt);
    } finally {
      await worker.stop();
    }
  });

  it('logs failures and keeps processing future events', async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    const isProcessed = vi.fn().mockResolvedValue(false);
    const markProcessed = vi.fn().mockResolvedValue(undefined);

    const worker = startWorker({
      queueName: 'orders',
      bus,
      dispatch,
      isProcessed,
      markProcessed,
      pollIntervalMs: 10,
      logger
    });

    worker.start();

    try {
      const secondEvent: EventEnvelope = {
        ...baseEvent,
        eventId: 'evt-2',
        occurredAt: new Date('2024-04-15T12:00:01.000Z').toISOString()
      };

      await bus.push('orders', baseEvent);
      await bus.push('orders', secondEvent);

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1', queueName: 'orders' }),
        'failed to process event'
      );

      const status = worker.getStatus();
      expect(status.processedCount).toBe(1);
      expect(status.lastEventAt).toBe(secondEvent.occurredAt);
    } finally {
      await worker.stop();
    }
  });
});
