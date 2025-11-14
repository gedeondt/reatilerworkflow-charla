import { normalizeScenario, type Scenario } from '@reatiler/saga-kernel';
import { z } from 'zod';

export type ScenarioContract = Scenario;

export type ScenarioValidationResult =
  | { ok: true; scenario: ScenarioContract }
  | { ok: false; errors: string[]; rawScenario: unknown };

const unwrapScenarioPayload = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;

  if ('content' in record && typeof record.content !== 'undefined') {
    return record.content;
  }

  if ('scenario' in record && typeof record.scenario !== 'undefined') {
    return record.scenario;
  }

  if ('generatedScenario' in record && typeof record.generatedScenario !== 'undefined') {
    const generated = record.generatedScenario;

    if (generated && typeof generated === 'object') {
      const generatedRecord = generated as Record<string, unknown>;
      if ('content' in generatedRecord && typeof generatedRecord.content !== 'undefined') {
        return generatedRecord.content;
      }

      return generated;
    }
  }

  return value;
};

const mapIssuesToMessages = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

export const validateScenario = (raw: unknown): ScenarioValidationResult => {
  let candidate: unknown = raw;

  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        errors: ['La respuesta del modelo no es JSON válido.'],
        rawScenario: raw,
      };
    }
  }

  const payload = unwrapScenarioPayload(candidate);

  try {
    const scenario = normalizeScenario(payload);
    return { ok: true, scenario };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        errors: mapIssuesToMessages(error.issues),
        rawScenario: payload,
      };
    }

    throw error;
  }
};

export { unwrapScenarioPayload };
