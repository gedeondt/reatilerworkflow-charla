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
    events: [{ name: 'OrderCreated' }, { name: 'PaymentRequested' }],
    listeners: [
      {
        id: 'on-order-created',
        on: { event: 'OrderCreated' },
        actions: [
          { type: 'set-state', domain: 'order', status: 'CREATED' },
          { type: 'emit', event: 'PaymentRequested', toDomain: 'payment' }
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
      events: [{ name: 'OrderCreated' }, { name: 'OrderCreated' }]
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
            { type: 'emit', event: 'NonExistingEvent', toDomain: 'missing-domain' }
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
});
