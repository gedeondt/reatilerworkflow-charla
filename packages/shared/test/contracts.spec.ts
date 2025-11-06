import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createEvent } from '../src/event-bus.js';
import { eventDataSchemas } from '../src/events-schemas.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function collectEventNames(directory: string): Promise<Set<string>> {
  const eventNames = new Set<string>();
  const stack: string[] = [directory];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === 'node_modules') {
        continue;
      }

      const entryPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (!entry.name.endsWith('.ts')) {
        continue;
      }

      const relative = path.relative(repoRoot, entryPath);

      if (!relative.includes(`${path.sep}src${path.sep}`)) {
        continue;
      }

      const content = await fs.readFile(entryPath, 'utf8');

      const createMatches = content.matchAll(/createEvent\(\s*['"]([A-Za-z0-9]+)['"]/g);
      for (const match of createMatches) {
        eventNames.add(match[1]);
      }

      const parseMatches = content.matchAll(/parseEvent\(\s*['"]([A-Za-z0-9]+)['"]/g);
      for (const match of parseMatches) {
        eventNames.add(match[1]);
      }
    }
  }

  return eventNames;
}

describe('event contracts', () => {
  it('ensures all referenced events are backed by a schema', async () => {
    const [serviceEvents, packageEvents] = await Promise.all([
      collectEventNames(path.join(repoRoot, 'services')),
      collectEventNames(path.join(repoRoot, 'packages'))
    ]);

    const referencedEvents = new Set([...serviceEvents, ...packageEvents]);
    const schemaEvents = new Set(Object.keys(eventDataSchemas));

    for (const eventName of referencedEvents) {
      expect(schemaEvents.has(eventName)).toBe(true);
    }
  });

  it('rejects events that do not satisfy their schema', () => {
    expect(() =>
      createEvent(
        'PaymentAuthorized',
        {
          paymentId: 'pay-1',
          orderId: 'order-1',
          reservationId: 'res-1'
        } as never,
        { traceId: 'trace-1', correlationId: 'order-1' }
      )
    ).toThrow(/amount/);
  });
});
