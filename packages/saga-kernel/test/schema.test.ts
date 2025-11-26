import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { z } from '@reatiler/shared/z';

import { normalizeScenario, scenarioSchema, type Scenario } from '../src/schema.js';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT_DIR = resolve(TEST_DIR, '..', '..', '..');

function getFixtureScenario(): unknown {
  const scenarioPath = resolve(ROOT_DIR, 'business', 'retailer-happy-path.json');
  const content = readFileSync(scenarioPath, 'utf8');

  return JSON.parse(content) as unknown;
}

function createBaseScenario(): Scenario {
  return {
    name: 'Test scenario',
    version: 1,
    domains: [
      {
        id: 'order',
        queue: 'queue-order',
        publishes: [
          {
            name: 'OrderCreated',
            payloadSchema: {
              orderId: 'string',
              amount: 'number',
              paymentMethod: {
                type: 'string',
                lastFour: 'string'
              }
            },
            start: true
          }
        ],
        listeners: [
          {
            id: 'on-order-created',
            on: { event: 'OrderCreated' },
            actions: [
              {
                type: 'emit',
                event: 'PaymentRequested',
                toDomain: 'payment',
                mapping: {
                  orderId: 'orderId',
                  amount: 'amount',
                  paymentMethod: {
                    objectFrom: 'paymentMethod',
                    map: {
                      type: 'type',
                      lastFour: 'lastFour'
                    }
                  }
                }
              }
            ]
          }
        ]
      },
      {
        id: 'payment',
        queue: 'queue-payment',
        publishes: [
          {
            name: 'PaymentRequested',
            payloadSchema: {
              orderId: 'string',
              amount: 'number',
              paymentMethod: {
                type: 'string',
                lastFour: 'string'
              }
            }
          }
        ],
        listeners: []
      }
    ]
  };
}

describe('scenarioSchema', () => {
  it('accepts the retailer happy path scenario', () => {
    const scenario = getFixtureScenario();
    const result = scenarioSchema.safeParse(scenario);

    expect(result.success).toBe(true);
  });

  it('rejects scenarios without a start event', () => {
    const scenario = createBaseScenario();
    scenario.domains[0].publishes?.forEach((event) => {
      if ('start' in event) {
        delete (event as { start?: boolean }).start;
      }
    });

    const result = scenarioSchema.safeParse(scenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        'No start event defined. Mark exactly one event with "start": true to bootstrap the saga.'
      );
    }
  });

  it('rejects scenarios with multiple start events', () => {
    const scenario = createBaseScenario();
    scenario.domains[1].publishes?.push({
      name: 'AnotherStart',
      payloadSchema: {},
      start: true
    });

    const result = scenarioSchema.safeParse(scenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((msg) => msg.includes('Only one event can be marked with "start": true'))).toBe(true);
    }
  });

  it('rejects duplicate domain definitions', () => {
    const duplicatedDomains = {
      ...createBaseScenario(),
      domains: [
        { id: 'order', queue: 'queue-order' },
        { id: 'order', queue: 'queue-order-2' }
      ]
    };

    const result = scenarioSchema.safeParse(duplicatedDomains);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Domain id "order" is declared more than once');
    }
  });

  it('rejects duplicate event definitions', () => {
    const duplicatedEvents = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;

    duplicatedEvents.domains[1].publishes?.push({
      name: 'OrderCreated',
      payloadSchema: { orderId: 'string' }
    });

    const result = scenarioSchema.safeParse(duplicatedEvents);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Event "OrderCreated" is declared more than once');
    }
  });

  it('rejects scenarios with top-level events or listeners', () => {
    const invalidScenario = {
      ...createBaseScenario(),
      events: [],
      listeners: []
    } as unknown;

    const result = scenarioSchema.safeParse(invalidScenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((message) => message.includes('Unrecognized key(s) in object'))).toBe(true);
    }
  });

  it('rejects listeners referencing unknown domains or events', () => {
    const invalidListenerScenario = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    const listener = invalidListenerScenario.domains[0].listeners?.[0];

    expect(listener).toBeDefined();

    if (listener) {
      listener.on.event = 'NonExistingEvent';
      listener.actions = [
        { type: 'emit', event: 'UnknownEvent', toDomain: 'order', mapping: {} },
        {
          type: 'emit',
          event: 'PaymentRequested',
          toDomain: 'order',
          mapping: {
            orderId: 'orderId',
            amount: 'amount',
            paymentMethod: {
              objectFrom: 'paymentMethod',
              map: {
                type: 'type',
                lastFour: 'lastFour'
              }
            }
          }
        }
      ];
    }

    const result = scenarioSchema.safeParse(invalidListenerScenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toEqual(
        expect.arrayContaining([
          'Listener "on-order-created" references unknown event "NonExistingEvent"',
          'Action emit references unknown event "UnknownEvent"',
          'Action emit references domain "order" but event "PaymentRequested" belongs to domain "payment"'
        ])
      );
    }
  });

  it('rejects multiple listeners consuming the same event', () => {
    const scenario = createBaseScenario();
    scenario.domains[0].listeners?.push({
      id: 'duplicate-listener',
      on: { event: 'OrderCreated' },
      actions: []
    });

    const result = scenarioSchema.safeParse(scenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.some((msg) => msg.includes('consumed by more than one listener'))).toBe(true);
    }
  });

  it('rejects events without payload schema definitions', () => {
    const missingPayload = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    delete missingPayload.domains[0].publishes?.[0]?.payloadSchema;

    const result = scenarioSchema.safeParse(missingPayload);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Required');
    }
  });

  it('rejects payload schemas with nested objects beyond one level', () => {
    const invalidPayload = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    if (invalidPayload.domains[0].publishes?.[0]) {
      invalidPayload.domains[0].publishes[0].payloadSchema = {
        orderId: 'string',
        nested: {
          inner: {
            detail: 'string'
          }
        }
      };
    }

    const result = scenarioSchema.safeParse(invalidPayload);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages.length).toBeGreaterThan(0);
    }
  });

  it('rejects payload schemas using scalar array syntax', () => {
    const invalidPayload = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    if (invalidPayload.domains[0].publishes?.[0]) {
      invalidPayload.domains[0].publishes[0].payloadSchema = {
        orderId: 'string',
        categorias: 'string[]'
      };
    }

    const result = scenarioSchema.safeParse(invalidPayload);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        'Scalar array types like "string[]" are not supported; use array of objects instead.'
      );
    }
  });

  it('rejects payload schemas with arrays of arrays', () => {
    const invalidPayload = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    if (invalidPayload.domains[0].publishes?.[0]) {
      invalidPayload.domains[0].publishes[0].payloadSchema = {
        orderId: 'string',
        invalid: [['string']]
      };
    }

    const result = scenarioSchema.safeParse(invalidPayload);

    expect(result.success).toBe(false);
  });

  it('accepts payload schemas with arrays of flat objects', () => {
    const validScenario = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;

    if (validScenario.domains[0].publishes?.[0]) {
      validScenario.domains[0].publishes[0].payloadSchema = {
        orderId: 'string',
        amount: 'number',
        paymentMethod: {
          type: 'string',
          lastFour: 'string'
        },
        lines: [
          {
            sku: 'string',
            quantity: 'number'
          }
        ]
      };
    }

    const result = scenarioSchema.safeParse(validScenario);

    expect(result.success).toBe(true);
  });

  it('rejects emit mappings missing destination fields', () => {
    const invalidScenario = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    const emitAction = invalidScenario.domains[0].listeners?.[0].actions.find(
      (action): action is Extract<typeof action, { type: 'emit' }> => action.type === 'emit'
    );

    if (emitAction) {
      delete emitAction.mapping.amount;
    }

    const result = scenarioSchema.safeParse(invalidScenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        'Emit mapping for event "PaymentRequested" is missing definition for field "amount"'
      );
    }
  });

  it('rejects emit mappings referencing unknown source fields', () => {
    const invalidScenario = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    const emitAction = invalidScenario.domains[0].listeners?.[0].actions.find(
      (action): action is Extract<typeof action, { type: 'emit' }> => action.type === 'emit'
    );

    if (emitAction) {
      emitAction.mapping.orderId = { from: 'unknownOrderId' };
    }

    const result = scenarioSchema.safeParse(invalidScenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain(
        'Emit mapping for event "PaymentRequested" references unknown field "unknownOrderId" in event "OrderCreated" payload'
      );
    }
  });
});

describe('normalizeScenario', () => {
  it('returns the scenario when the structure is valid', () => {
    const scenario = createBaseScenario();

    const normalized = normalizeScenario(scenario);

    expect(normalized).toEqual(scenario);
  });

  it('throws when the scenario is invalid', () => {
    expect(() => normalizeScenario({})).toThrow(z.ZodError);
  });

  it('throws when the scenario declares top-level events or listeners', () => {
    const invalidScenario = JSON.parse(JSON.stringify(createBaseScenario())) as Record<string, unknown>;

    invalidScenario.events = [];
    invalidScenario.listeners = [];

    expect(() => normalizeScenario(invalidScenario)).toThrow(z.ZodError);
  });
});
