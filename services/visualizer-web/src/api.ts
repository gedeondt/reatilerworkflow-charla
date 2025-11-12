import type { Scenario } from "@reatiler/saga-kernel";
import type {
  TraceView,
  LogEntry,
  ScenarioResponse,
  ScenariosResponse,
  ScenarioDefinitionResponse,
  ApplyScenarioResponse,
  DraftSummary,
  MarkReadyResponse,
  DraftCreationResponse,
  GenerateJsonResponse,
  ScenarioBootstrapResponse,
  ValidateScenarioResponse,
  ApplyScenarioPayloadResponse,
} from "./types";

const API_BASE =
  import.meta.env.VITE_VISUALIZER_API_BASE || "http://localhost:3300";
export const DESIGNER_BASE =
  import.meta.env.VITE_SCENARIO_DESIGNER_BASE || "http://localhost:3201";

async function parseErrorResponse(res: Response): Promise<string> {
  const text = await res.text();

  if (!text) {
    return `Request failed (${res.status})`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };

    if (parsed && typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }

    if (parsed && typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    // ignore parse error and fall back to raw text
    return text;
  }

  return text;
}

export async function fetchTraces(): Promise<TraceView[]> {
  const res = await fetch(`${API_BASE}/traces`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchLogs(): Promise<LogEntry[]> {
  const res = await fetch(`${API_BASE}/logs`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchScenario(): Promise<ScenarioResponse> {
  const res = await fetch(`${API_BASE}/scenario`);
  if (!res.ok) {
    throw new Error(`Failed to fetch scenario (${res.status})`);
  }

  return res.json();
}

export async function fetchScenarios(): Promise<ScenariosResponse> {
  const res = await fetch(`${API_BASE}/scenarios`);
  if (!res.ok) {
    throw new Error(`Failed to fetch scenarios (${res.status})`);
  }

  return res.json();
}

type ErrorWithStatus = Error & { status?: number };

export async function fetchScenarioDefinition(
  name: string,
): Promise<{ name: string; definition: Scenario }> {
  const res = await fetch(
    `${API_BASE}/scenarios/${encodeURIComponent(name)}/definition`,
  );

  if (res.status === 404) {
    throw new Error("not_found");
  }

  if (!res.ok) {
    const error = new Error(await parseErrorResponse(res)) as ErrorWithStatus;
    error.status = res.status;
    throw error;
  }

  const payload = (await res.json()) as ScenarioDefinitionResponse;

  return {
    name: payload.name,
    definition: payload.definition as Scenario,
  };
}

export async function fetchScenarioBootstrap(): Promise<ScenarioBootstrapResponse> {
  const res = await fetch(`${API_BASE}/scenario-bootstrap`);

  if (!res.ok) {
    throw new Error(`Failed to fetch scenario bootstrap (${res.status})`);
  }

  return res.json();
}

export async function validateScenario(
  scenario: unknown,
): Promise<ValidateScenarioResponse> {
  try {
    const res = await fetch(`${API_BASE}/validate-scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });

    if (res.status === 422) {
      return (await res.json()) as ValidateScenarioResponse;
    }

    if (!res.ok) {
      throw new Error(await parseErrorResponse(res));
    }

    return (await res.json()) as ValidateScenarioResponse;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al validar";
    throw new Error(`No se pudo validar el escenario: ${message}`);
  }
}

export async function applyScenario(
  scenario: unknown,
): Promise<ApplyScenarioPayloadResponse> {
  try {
    const res = await fetch(`${API_BASE}/scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario }),
    });

    if (res.status === 422) {
      return (await res.json()) as ApplyScenarioPayloadResponse;
    }

    if (!res.ok) {
      throw new Error(await parseErrorResponse(res));
    }

    return (await res.json()) as ApplyScenarioPayloadResponse;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error desconocido al aplicar";
    throw new Error(`No se pudo aplicar el escenario: ${message}`);
  }
}

export async function applyScenarioByName(name: string): Promise<ApplyScenarioResponse> {
  const res = await fetch(`${API_BASE}/scenario/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "existing", name })
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

export async function fetchDraftSummary(draftId: string): Promise<DraftSummary> {
  const res = await fetch(
    `${DESIGNER_BASE}/scenario-drafts/${encodeURIComponent(draftId)}/summary`
  );

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

export async function markDraftReady(draftId: string): Promise<MarkReadyResponse> {
  const res = await fetch(
    `${DESIGNER_BASE}/scenario-drafts/${encodeURIComponent(draftId)}/mark-ready`,
    {
      method: "POST",
    }
  );

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

export async function generateDraftJson(
  draftId: string,
): Promise<GenerateJsonResponse> {
  const res = await fetch(
    `${DESIGNER_BASE}/scenario-drafts/${encodeURIComponent(draftId)}/generate-json`,
    {
      method: "POST",
    },
  );

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

export async function refineScenarioDraft(
  draftId: string,
  feedback: string,
): Promise<DraftCreationResponse> {
  const res = await fetch(
    `${DESIGNER_BASE}/scenario-drafts/${encodeURIComponent(draftId)}/refine`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    },
  );

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

export async function applyScenarioDraft(
  draftId: string
): Promise<ApplyScenarioResponse> {
  const res = await fetch(`${API_BASE}/scenario/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "draft", draftId }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}

export async function createScenarioDraft(
  description: string,
): Promise<DraftCreationResponse> {
  const res = await fetch(`${DESIGNER_BASE}/scenario-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });

  if (!res.ok) {
    throw new Error(await parseErrorResponse(res));
  }

  return res.json();
}
