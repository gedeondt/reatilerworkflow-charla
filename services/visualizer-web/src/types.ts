export type TraceView = {
  traceId: string;
  lastUpdatedAt: string;
  domains: {
    [domainName: string]: {
      events: {
        eventName: string;
        occurredAt: string;
      }[];
    };
  };
};

export type LogEntry = {
  traceId: string;
  domain: string;
  eventName: string;
  occurredAt: string;
};

export type ScenarioResponse = {
  name: string;
  source?: 'business' | 'draft';
};

export type ScenarioListItem = {
  name: string;
  source: 'business' | 'draft';
};

export type ScenariosResponse = {
  items: ScenarioListItem[];
};

export type ApplyScenarioResponse = {
  name: string;
  status: 'active';
  source?: 'business' | 'draft';
};

export type DraftSummary = {
  id: string;
  status: 'draft' | 'ready';
  currentProposal: Record<string, unknown>;
  hasGeneratedScenario: boolean;
  generatedScenarioPreview?: unknown;
  guidance?: string;
};

export type MarkReadyResponse = {
  id: string;
  status: 'ready';
};
