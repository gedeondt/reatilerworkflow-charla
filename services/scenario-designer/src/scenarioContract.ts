import { normalizeScenario, type Scenario } from '@reatiler/saga-kernel';
import { z } from '@reatiler/shared/z';

export type ScenarioContract = Scenario;

export type InspectScenarioContractFailure =
  | { type: 'invalid_json'; errors: string[] }
  | { type: 'invalid_contract'; errors: string[] };

export type InspectScenarioContractResult =
  | { ok: true; scenario: ScenarioContract }
  | { ok: false; failure: InspectScenarioContractFailure };

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

  try {
    const scenario = normalizeScenario(value);

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
