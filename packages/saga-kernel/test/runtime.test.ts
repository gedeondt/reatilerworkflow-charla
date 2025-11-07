import { randomUUID } from 'node:crypto';

import { FakeEventBus, type EventEnvelope } from '@reatiler/shared/event-bus';
import { describe, expect, it, vi } from 'vitest';

import { loadScenario } from '../src/loader.js';
import { createScenarioRuntime, type Logger } from '../src/runtime.js';

class RecordingEventBus extends FakeEventBus {
  public readonly pushes: Array<{ queue: string; envelope: EventEnvelope }> = [];

  async push(queue: string, event: EventEnvelope): Promise<void> {
    const recordedEnvelope = JSON.parse(JSON.stringify(event)) as EventEnvelope;
    this.pushes.push({ queue, envelope: recordedEnvelope });
    await super.push(queue, event);
  }
}

describe('scenario runtime', () => {
  it('processes the retailer happy path end-to-end', async () => {
    const scenario = loadScenario('retailer-happy-path');
    const bus = new RecordingEventBus();
    const logger: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn()
    };

    const runtime = createScenarioRuntime({
      scenario,
      bus,
      logger,
      pollIntervalMs: 1
    });

    const correlationId = 'order-123';
    const initialEvent: EventEnvelope = {
      eventName: 'OrderPlaced',
      version: 1,
      eventId: randomUUID(),
      traceId: randomUUID(),
      correlationId,
      occurredAt: new Date().toISOString(),
      data: { sku: 'abc', quantity: 1 }
    };

    const orderDomain = scenario.domains.find((domain) => domain.id === 'order');
    expect(orderDomain).toBeDefined();

    await bus.push(orderDomain!.queue, initialEvent);

    await runtime.start();

    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });

    await runtime.stop();

    const emittedEventNames = bus.pushes.slice(1).map((entry) => entry.envelope.eventName);

    expect(emittedEventNames).toEqual([
      'InventoryReserved',
      'PaymentAuthorized',
      'ShipmentPrepared',
      'PaymentCaptured',
      'OrderConfirmed'
    ]);

    const stateSnapshot = runtime.getStateSnapshot();
    expect(stateSnapshot[correlationId]).toBeDefined();

    expect(stateSnapshot[correlationId]).toMatchObject({
      order: 'CONFIRMED',
      inventory: 'RESERVED',
      payments: 'AUTHORIZED',
      shipping: 'PREPARED'
    });
  });
});
