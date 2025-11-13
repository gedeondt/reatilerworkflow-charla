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
  rawEvent: Record<string, unknown>;
  queue?: string;
  originalPayload?: unknown;
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

export type ScenarioDefinitionResponse = {
  name: string;
  definition: Record<string, unknown>;
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

export type GeneratedScenario = {
  content: Record<string, unknown>;
  createdAt: string;
  bootstrapExample?: {
    queue: string;
    event: Record<string, unknown>;
  };
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
  generatedScenario?: GeneratedScenario;
};

export type GenerateJsonResponse = {
  id: string;
  status: 'generated' | 'draft' | 'ready';
  generatedScenario?: GeneratedScenario;
  // Legacy shape kept for compatibility with older designer versions
  scenario?: Record<string, unknown>;
  bootstrapExample?: {
    queue: string;
    event: Record<string, unknown>;
  };
};

export type JsonPromptResponse = {
  draftId: string;
  prompt: string;
  language?: string;
  generatedAt?: string;
};

export type ScenarioBootstrapResponse =
  | { hasBootstrap: false }
  | { hasBootstrap: true; queue: string; event: Record<string, unknown> };
