import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scenarioSchema, type Scenario } from '../src/schema.js';

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
      { id: 'order', queue: 'queue-order' },
      { id: 'payment', queue: 'queue-payment' }
    ],
    events: [
      {
        name: 'OrderCreated',
        payloadSchema: {
          orderId: 'string',
          amount: 'number',
          paymentMethod: {
            type: 'string',
            lastFour: 'string'
          }
        }
      },
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
    listeners: [
      {
        id: 'on-order-created',
        on: { event: 'OrderCreated' },
        actions: [
          { type: 'set-state', domain: 'order', status: 'CREATED' },
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
  };
}

describe('scenarioSchema', () => {
  it('accepts the retailer happy path scenario', () => {
    const scenario = getFixtureScenario();
    const result = scenarioSchema.safeParse(scenario);

    expect(result.success).toBe(true);
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
    const duplicatedEvents = {
      ...createBaseScenario(),
      events: [
        { name: 'OrderCreated', payloadSchema: { orderId: 'string' } },
        { name: 'OrderCreated', payloadSchema: { orderId: 'string' } }
      ]
    };

    const result = scenarioSchema.safeParse(duplicatedEvents);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Event "OrderCreated" is declared more than once');
    }
  });

  it('rejects listeners referencing unknown domains or events', () => {
    const invalidListenerScenario = {
      ...createBaseScenario(),
      listeners: [
        {
          id: 'invalid-listener',
          on: { event: 'NonExistingEvent' },
          actions: [
            { type: 'set-state', domain: 'missing-domain', status: 'ANY' },
            { type: 'emit', event: 'NonExistingEvent', toDomain: 'missing-domain', mapping: {} }
          ]
        }
      ]
    };

    const result = scenarioSchema.safeParse(invalidListenerScenario);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toEqual(
        expect.arrayContaining([
          'Listener "invalid-listener" references unknown event "NonExistingEvent"',
          'Action set-state references unknown domain "missing-domain"',
          'Action emit references unknown event "NonExistingEvent"',
          'Action emit references unknown domain "missing-domain"'
        ])
      );
    }
  });

  it('rejects events without payload schema definitions', () => {
    const missingPayload = JSON.parse(JSON.stringify(createBaseScenario())) as {
      events: Array<Record<string, unknown>>;
    };
    delete missingPayload.events[0].payloadSchema;

    const result = scenarioSchema.safeParse(missingPayload);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Required');
    }
  });

  it('rejects payload schemas with nested objects beyond one level', () => {
    const invalidPayload = JSON.parse(JSON.stringify(createBaseScenario())) as {
      events: Array<Record<string, unknown>>;
    };
    invalidPayload.events[0].payloadSchema = {
      orderId: 'string',
      nested: {
        inner: {
          detail: 'string'
        }
      }
    };

    const result = scenarioSchema.safeParse(invalidPayload);

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Invalid input');
    }
  });

  it('rejects payload schemas with arrays of arrays', () => {
    const invalidPayload = JSON.parse(JSON.stringify(createBaseScenario())) as {
      events: Array<Record<string, unknown>>;
    };
    invalidPayload.events[0].payloadSchema = {
      orderId: 'string',
      invalid: [['string']]
    };

    const result = scenarioSchema.safeParse(invalidPayload);

    expect(result.success).toBe(false);
  });

  it('accepts payload schemas with arrays of flat objects', () => {
    const validScenario = JSON.parse(JSON.stringify(createBaseScenario())) as {
      events: Array<Record<string, unknown>>;
    };
    validScenario.events[0].payloadSchema = {
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

    const result = scenarioSchema.safeParse(validScenario);

    expect(result.success).toBe(true);
  });

  it('rejects emit mappings missing destination fields', () => {
    const invalidScenario = JSON.parse(JSON.stringify(createBaseScenario())) as Scenario;
    const emitAction = invalidScenario.listeners[0].actions.find(
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
    const emitAction = invalidScenario.listeners[0].actions.find(
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
