import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scenarioSchema, type Scenario } from './schema.js';

function resolveScenarioPath(name: string): string {
  // Siempre busca en `<cwd>/business/<name>.json`
  return resolve(process.cwd(), 'business', `${name}.json`);
}

export function loadScenario(name: string): Scenario {
  const filePath = resolveScenarioPath(name);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `Failed to read scenario file "${name}" at ${filePath}: ${(error as Error).message}`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON in scenario file "${name}" at ${filePath}: ${(error as Error).message}`
    );
  }

  try {
    return scenarioSchema.parse(json);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Scenario "${name}" does not match schema: ${error.message}`);
    }
    throw error;
  }
}
