import { type Domain as ScenarioDomain } from '@reatiler/saga-kernel';

export const executions: Record<string, Record<string, string>> = {};

const FINISHED_RETENTION_MS = 5000;

type ExecutionMeta = {
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  label: string;
};

type DomainStatusUpdate = { domainId: string; status: string };

type ExecutionRow = {
  key: string;
  traceId: string;
  states: Record<string, string>;
  finished: boolean;
  createdAt: number;
  updatedAt: number;
};

const metadata = new Map<string, ExecutionMeta>();
const correlationToExecutionKey = new Map<string, string>();

export function resetExecutions(): void {
  for (const key of Object.keys(executions)) {
    delete executions[key];
  }

  metadata.clear();
  correlationToExecutionKey.clear();
}

function initializeExecution(
  key: string,
  domains: ScenarioDomain[],
  label: string,
  timestamp: number
): ExecutionMeta {
  let state = executions[key];

  if (!state) {
    state = {};
    domains.forEach((domain) => {
      state[domain.id] = '-';
    });
    executions[key] = state;
    const meta: ExecutionMeta = {
      createdAt: timestamp,
      updatedAt: timestamp,
      label
    };
    metadata.set(key, meta);
    return meta;
  }

  const meta = metadata.get(key);

  if (!meta) {
    const fallback: ExecutionMeta = {
      createdAt: timestamp,
      updatedAt: timestamp,
      label
    };
    metadata.set(key, fallback);
    return fallback;
  }

  meta.label = label;
  return meta;
}

function renameExecution(oldKey: string, newKey: string) {
  if (oldKey === newKey) {
    return;
  }

  if (executions[newKey]) {
    return;
  }

  executions[newKey] = executions[oldKey];
  delete executions[oldKey];

  const meta = metadata.get(oldKey);

  if (meta) {
    metadata.set(newKey, meta);
    metadata.delete(oldKey);
  }

  for (const [correlationId, mappedKey] of correlationToExecutionKey.entries()) {
    if (mappedKey === oldKey) {
      correlationToExecutionKey.set(correlationId, newKey);
    }
  }
}

function getOrCreateExecutionKey(
  traceId: string | null,
  correlationId: string | null
): string | null {
  const trimmedTraceId = traceId?.trim();
  const trimmedCorrelationId = correlationId?.trim();

  if (trimmedTraceId && executions[trimmedTraceId]) {
    return trimmedTraceId;
  }

  if (trimmedCorrelationId) {
    const existing = correlationToExecutionKey.get(trimmedCorrelationId);
    if (existing) {
      return existing;
    }
  }

  if (trimmedTraceId) {
    return trimmedTraceId;
  }

  if (trimmedCorrelationId) {
    return trimmedCorrelationId;
  }

  return null;
}

function isTerminalStatus(status: string): boolean {
  const normalized = status.toUpperCase();

  if (normalized === '-' || normalized.length === 0) {
    return false;
  }

  return (
    normalized.includes('CONFIRM') ||
    normalized.includes('FAIL') ||
    normalized.includes('CANCEL') ||
    normalized.includes('ERROR') ||
    normalized.includes('COMPLETE') ||
    normalized.includes('REJECT')
  );
}

function isExecutionFinished(state: Record<string, string>): boolean {
  const domainIds = Object.keys(state);

  if (domainIds.length === 0) {
    return false;
  }

  return domainIds.every((domainId) => isTerminalStatus(state[domainId]));
}

export function upsertExecution(
  options: {
    traceId: string | null;
    correlationId: string | null;
    domains: ScenarioDomain[];
    updates: DomainStatusUpdate[];
  },
  timestamp: number
): { key: string; displayId: string; changedDomains: string[]; finished: boolean } | null {
  const { traceId, correlationId, domains, updates } = options;

  const executionKey = getOrCreateExecutionKey(traceId, correlationId);

  if (!executionKey) {
    return null;
  }

  let effectiveKey = executionKey;
  const displayId = traceId?.trim() ?? executionKey;

  const meta = initializeExecution(effectiveKey, domains, displayId, timestamp);

  if (traceId && executionKey !== traceId) {
    renameExecution(executionKey, traceId);
    effectiveKey = traceId;
  }

  const executionState = executions[effectiveKey];
  const changedDomains: string[] = [];

  updates.forEach(({ domainId, status }) => {
    if (executionState[domainId] !== status) {
      executionState[domainId] = status;
      changedDomains.push(domainId);
    }
  });

  meta.label = displayId;
  meta.updatedAt = timestamp;

  const finished = isExecutionFinished(executionState);

  if (finished) {
    if (!meta.finishedAt) {
      meta.finishedAt = timestamp;
    }
  } else {
    meta.finishedAt = undefined;
  }

  if (correlationId?.trim()) {
    correlationToExecutionKey.set(correlationId.trim(), effectiveKey);
  }

  return { key: effectiveKey, displayId: meta.label, changedDomains, finished };
}

export function getExecutionRows(
  domains: ScenarioDomain[],
  maxTraces: number,
  now: number
): ExecutionRow[] {
  for (const [key, meta] of metadata.entries()) {
    if (meta.finishedAt && now - meta.finishedAt > FINISHED_RETENTION_MS) {
      delete executions[key];
      metadata.delete(key);
      for (const [correlationId, mappedKey] of correlationToExecutionKey.entries()) {
        if (mappedKey === key) {
          correlationToExecutionKey.delete(correlationId);
        }
      }
    }
  }

  const rows: ExecutionRow[] = Object.entries(executions).map(([key, state]) => {
    const meta = metadata.get(key);
    const label = meta?.label ?? key;
    const finished = Boolean(meta?.finishedAt);

    const normalizedState: Record<string, string> = {};

    domains.forEach((domain) => {
      normalizedState[domain.id] = state[domain.id] ?? '-';
    });

    return {
      key,
      traceId: label,
      states: normalizedState,
      finished,
      createdAt: meta?.createdAt ?? now,
      updatedAt: meta?.updatedAt ?? now
    };
  });

  rows.sort((a, b) => {
    if (a.finished !== b.finished) {
      return a.finished ? 1 : -1;
    }

    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }

    return b.createdAt - a.createdAt;
  });

  return rows.slice(0, Math.max(1, maxTraces));
}

export { FINISHED_RETENTION_MS };
export type { ExecutionRow, DomainStatusUpdate };
