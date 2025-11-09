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

export type ScenarioProposalEvent = {
  title: string;
  description: string;
};

export type ScenarioProposal = {
  name: string;
  domains: string[];
  events: ScenarioProposalEvent[];
  sagaSummary: string;
  openQuestions: string[];
};

export type DraftCreationResponse = {
  id: string;
  inputDescription: string;
  currentProposal: ScenarioProposal;
  status: 'draft' | 'ready';
  history: Array<{
    type: 'initial' | 'refinement';
    userNote: string;
    modelNote: string;
    timestamp: string;
  }>;
  generatedScenario?: {
    content: Record<string, unknown>;
    createdAt: string;
    bootstrapExample?: {
      queue: string;
      event: Record<string, unknown>;
    };
  };
};

export type GenerateJsonResponse = {
  id: string;
  status: 'generated';
  generatedScenario: Record<string, unknown>;
};

export type ScenarioBootstrapResponse =
  | { hasBootstrap: false }
  | { hasBootstrap: true; queue: string; event: Record<string, unknown> };
