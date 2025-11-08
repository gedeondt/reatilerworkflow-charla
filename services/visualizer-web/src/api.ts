import type { TraceView, LogEntry, ScenarioResponse, ScenariosResponse } from "./types";

const API_BASE =
  import.meta.env.VITE_VISUALIZER_API_BASE || "http://localhost:3300";

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

export async function updateScenario(name: string): Promise<ScenarioResponse> {
  const res = await fetch(`${API_BASE}/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  if (!res.ok) {
    const text = await res.text();
    let message = text || `Failed to switch scenario (${res.status})`;

    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed && typeof parsed.error === "string" && parsed.error.length > 0) {
          message = parsed.error;
        }
      } catch {
        // ignore parse error and fall back to raw text
      }
    }

    throw new Error(message);
  }

  return res.json();
}
