import { describe, expect, it } from 'vitest';

import { loadScenario } from '../src/loader.js';

describe('scenario loader', () => {
  it('loads and validates the retailer happy path scenario', () => {
    const scenario = loadScenario('retailer-happy-path');

    expect(scenario.name).toBe('Retailer Happy Path Saga');
    expect(scenario.listeners).not.toHaveLength(0);
  });
});
