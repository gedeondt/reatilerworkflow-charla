import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scenarioSchema, type Scenario } from './schema.js';

export function loadScenario(name: string): Scenario {
  const filePath = resolveScenarioPath(name);

  let rawContent: string;

  try {
    rawContent = readFileSync(filePath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read scenario file at "${filePath}": ${message}`);
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(rawContent) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in scenario file "${filePath}": ${message}`);
  }

  try {
    return scenarioSchema.parse(parsedContent);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Scenario validation failed for "${filePath}": ${error.message}`);
    }

    throw error;
  }
}

function resolveScenarioPath(name: string): string {
  const targetFileName = `${name}.json`;
  const searchRoots = new Set<string>();

  searchRoots.add(process.cwd());

  const moduleDirectory = fileURLToPath(new URL('.', import.meta.url));
  searchRoots.add(moduleDirectory);

  const visited = new Set<string>();

  for (const initialRoot of searchRoots) {
    let current = initialRoot;

    while (!visited.has(current)) {
      visited.add(current);

      const candidate = resolve(current, 'business', targetFileName);

      if (existsSync(candidate)) {
        return candidate;
      }

      const parent = resolve(current, '..');

      if (parent === current) {
        break;
      }

      current = parent;
    }
  }

  throw new Error(
    `Scenario file "business/${targetFileName}" could not be located from roots: ${Array.from(searchRoots).join(', ')}`
  );
}
