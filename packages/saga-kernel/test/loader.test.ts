import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadScenario } from '../src/loader.js';

function escapeForRegExp(value: string): string {
  return value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scenario loader', () => {
  it('searches upwards for the scenario file', () => {
    const nestedDir = resolve(process.cwd(), 'packages', 'saga-kernel');
    vi.spyOn(process, 'cwd').mockReturnValue(nestedDir);

    const scenario = loadScenario('retailer-happy-path');

    expect(scenario.name).toBe('Retailer Happy Path Saga');
    expect(
      scenario.domains.some((domain) => Array.isArray(domain.listeners) && domain.listeners.length > 0)
    ).toBe(true);
  });

  it('throws a clear error when the scenario does not exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'saga-kernel-loader-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    expect(() => loadScenario('missing-scenario')).toThrow(
      new RegExp(
        `^Scenario file "business/missing-scenario.json" not found from ${escapeForRegExp(tempDir)}\\.`
      )
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('validates the schema of the loaded scenario', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'saga-kernel-loader-invalid-'));
    const businessDir = join(tempDir, 'business');
    const scenarioPath = join(businessDir, 'invalid.json');

    mkdirSync(businessDir, { recursive: true });
    writeFileSync(scenarioPath, JSON.stringify({ name: 'x' }));

    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    expect(() => loadScenario('invalid')).toThrow(
      new RegExp(`^Scenario validation failed for "${escapeForRegExp(scenarioPath)}":`)
    );

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects scenarios that declare top-level events or listeners', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'saga-kernel-loader-legacy-'));
    const businessDir = join(tempDir, 'business');
    const scenarioPath = join(businessDir, 'invalid-top-level.json');

    mkdirSync(businessDir, { recursive: true });

    const invalidScenario = {
      name: 'Legacy scenario',
      version: 1,
      events: [],
      listeners: [],
      domains: [
        {
          id: 'order',
          queue: 'order-queue',
          events: [
            {
              name: 'OrderPlaced',
              payloadSchema: {
                orderId: 'string',
              },
            },
          ],
        },
      ],
    } satisfies Record<string, unknown>;

    writeFileSync(scenarioPath, JSON.stringify(invalidScenario));

    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    expect(() => loadScenario('invalid-top-level')).toThrow(
      new RegExp(`^Scenario validation failed for "${escapeForRegExp(scenarioPath)}":`)
    );

    rmSync(tempDir, { recursive: true, force: true });
  });
});
