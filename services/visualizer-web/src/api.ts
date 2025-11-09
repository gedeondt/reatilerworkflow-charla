import type {
  TraceView,
  LogEntry,
  ScenarioResponse,
  ScenariosResponse,
  ApplyScenarioResponse,
  DraftSummary,
  MarkReadyResponse,
} from "./types";

const API_BASE =
  import.meta.env.VITE_VISUALIZER_API_BASE || "http://localhost:3300";
const DESIGNER_BASE =
  import.meta.env.VITE_SCENARIO_DESIGNER_BASE || "http://localhost:3400";

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
