import { scenarioSchema } from '@reatiler/saga-kernel';
import { z } from 'zod';

export type ScenarioContract = z.infer<typeof scenarioSchema>;

export type InspectScenarioContractFailure = {
  type: 'invalid_json' | 'invalid_contract';
  errors: string[];
};

export type InspectScenarioContractResult =
  | { ok: true; scenario: ScenarioContract }
  | ({ ok: false } & InspectScenarioContractFailure);

const formatIssuePath = (path: (string | number)[]): string =>
  path
    .map((segment) =>
      typeof segment === 'number'
        ? `[${segment}]`
        : segment.includes('.')
          ? `['${segment}']`
          : `.${segment}`,
    )
    .join('')
    .replace(/^[.]/u, '');

const formatSchemaIssues = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return path ? `${issue.message} (ruta: ${path})` : issue.message;
  });

export const inspectScenarioContract = (
  raw: string | unknown,
): InspectScenarioContractResult => {
  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Error desconocido al parsear JSON';
      return { ok: false, type: 'invalid_json', errors: [`El contenido no es JSON válido: ${reason}`] };
    }
  }

  const validation = scenarioSchema.safeParse(parsed);

  if (!validation.success) {
    return {
      ok: false,
      type: 'invalid_contract',
      errors: formatSchemaIssues(validation.error.issues),
    };
  }

  return { ok: true, scenario: validation.data };
};
