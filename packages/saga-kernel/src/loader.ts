import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { z } from '@reatiler/shared/z';

import { normalizeScenario, type Scenario } from './schema.js';

const SCENARIO_DIR = 'business';

function findScenarioPath(name: string, startDir: string): string | null {
  const targetRelativePath = join(SCENARIO_DIR, `${name}.json`);

  let currentDir: string | null = startDir;

  while (currentDir) {
    const candidate = join(currentDir, targetRelativePath);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return null;
}

function readScenarioFile(filePath: string): unknown {
  const rawContent = readFileSync(filePath, 'utf8');

  return JSON.parse(rawContent) as unknown;
}

export function loadScenario(name: string): Scenario {
  const startDir = process.cwd();
  const filePath = findScenarioPath(name, startDir);

  if (!filePath) {
    throw new Error(`Scenario file "business/${name}.json" not found from ${startDir}.`);
  }

  let jsonContent: unknown;

  try {
    jsonContent = readScenarioFile(filePath);
  } catch (error) {
    throw new Error(
      `Failed to read scenario file "${filePath}": ${(error as Error).message}`
    );
  }

  try {
    return normalizeScenario(jsonContent);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => issue.message).join('; ');
      throw new Error(`Scenario validation failed for "${filePath}": ${detail}.`);
    }

    throw error;
  }
}
