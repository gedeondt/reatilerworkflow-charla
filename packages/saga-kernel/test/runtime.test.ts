import { randomUUID } from 'node:crypto';

import { FakeEventBus, type EventEnvelope } from '@reatiler/shared/event-bus';
import { describe, expect, it, vi } from 'vitest';

import { createScenarioRuntime, type Logger } from '../src/runtime.js';
import type { Scenario } from '../src/schema.js';

class RecordingEventBus extends FakeEventBus {
  public readonly pushes: Array<{ queue: string; envelope: EventEnvelope; timestamp: number }> = [];

  override async push(queue: string, event: EventEnvelope): Promise<void> {
    const recordedEnvelope = JSON.parse(JSON.stringify(event)) as EventEnvelope;
    this.pushes.push({ queue, envelope: recordedEnvelope, timestamp: Date.now() });
    await super.push(queue, event);
  }
}

describe('scenario runtime', () => {
  it('processes listeners, emits events, tracks state and respects delays', async () => {
    const scenario: Scenario = {
      name: 'Mini scenario',
      version: 1,
      domains: [
        { id: 'source', queue: 'queue-source' },
        { id: 'target', queue: 'queue-target' }
      ],
      events: [
        { name: 'Initial', payloadSchema: {} },
        { name: 'FollowUp', payloadSchema: {} }
      ],
      listeners: [
        {
          id: 'on-initial',
          on: { event: 'Initial' },
          delayMs: 50,
          actions: [
            { type: 'set-state', domain: 'source', status: 'PROCESSED' },
            { type: 'emit', event: 'FollowUp', toDomain: 'target' }
          ]
        }
      ]
    };

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

    const correlationId = 'corr-123';
    const initialEnvelope: EventEnvelope = {
      eventName: 'Initial',
      version: 1,
      eventId: randomUUID(),
      traceId: randomUUID(),
      correlationId,
      occurredAt: new Date().toISOString(),
      data: { example: 'payload' }
    };

    await runtime.start();
    await runtime.start();

    const startTime = Date.now();
    await bus.push('queue-source', initialEnvelope);

    await vi.waitFor(() => {
      expect(bus.pushes.length).toBeGreaterThan(1);
    }, { timeout: 1000 });

    const emitted = bus.pushes[1];

    expect(emitted.queue).toBe('queue-target');
    expect(emitted.envelope.eventName).toBe('FollowUp');
    expect(emitted.envelope.correlationId).toBe(correlationId);
    expect(emitted.envelope.causationId).toBe(initialEnvelope.eventId);
    expect(emitted.envelope.traceId).toBe(initialEnvelope.traceId);
    expect(emitted.envelope.data).toEqual(initialEnvelope.data);

    const elapsed = emitted.timestamp - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(50);

    await vi.waitFor(() => {
      const snapshot = runtime.getStateSnapshot();
      expect(snapshot[correlationId]?.source).toBe('PROCESSED');
    }, { timeout: 1000 });

    await runtime.stop();
    await runtime.stop();

    const snapshot = runtime.getStateSnapshot();
    expect(snapshot).toEqual({
      [correlationId]: {
        source: 'PROCESSED'
      }
    });
  });
});
