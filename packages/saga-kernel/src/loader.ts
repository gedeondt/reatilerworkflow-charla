import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { scenarioSchema, type Scenario } from './schema.js';

export function loadScenario(name: string): Scenario {
  const relativePath = `business/${name}.json`;
  const filePath = resolve(process.cwd(), relativePath);

  let rawContent: string;

  try {
    rawContent = readFileSync(filePath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const err = error as NodeJS.ErrnoException | undefined;

    if (err?.code === 'ENOENT') {
      throw new Error(`Scenario file "${relativePath}" was not found.`);
    }

    throw new Error(`Unable to read scenario file "${relativePath}": ${message}`);
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(rawContent) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Scenario file "${relativePath}" contains invalid JSON: ${message}`);
  }

  try {
    return scenarioSchema.parse(parsedContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Scenario file "${relativePath}" is not valid: ${message}`);
  }
}
