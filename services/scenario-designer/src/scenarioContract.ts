import { scenarioSchema } from '@reatiler/saga-kernel';
import { z } from 'zod';

export type ScenarioContract = z.infer<typeof scenarioSchema>;

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

  const parsed = scenarioSchema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
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

  return { ok: true, scenario: parsed.data };
}
