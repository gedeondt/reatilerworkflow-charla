import { normalizeScenario, type Scenario } from '@reatiler/saga-kernel';
import { z } from 'zod';

export type ScenarioContract = Scenario;

export type InspectScenarioContractFailure =
  | { type: 'invalid_json'; errors: string[] }
  | { type: 'invalid_contract'; errors: string[] };

export type InspectScenarioContractResult =
  | { ok: true; scenario: ScenarioContract }
  | { ok: false; failure: InspectScenarioContractFailure };

export const unwrapScenarioPayload = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'content' in (value as Record<string, unknown>)) {
    const content = (value as Record<string, unknown>).content;
    if (typeof content !== 'undefined') {
      return content;
    }
  }

  return value;
};

export function inspectScenarioContract(raw: string | unknown): InspectScenarioContractResult {
  let value: unknown = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch (err) {
      return {
        ok: false,
        failure: {
          type: 'invalid_json',
          errors: ['La respuesta del modelo no es JSON válido.'],
        },
      };
    }
  }

  const scenarioPayload = unwrapScenarioPayload(value);

  try {
    const scenario = normalizeScenario(scenarioPayload);

    return { ok: true, scenario };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });

      return {
        ok: false,
        failure: {
          type: 'invalid_contract',
          errors,
        },
      };
    }

    throw error;
  }
}
