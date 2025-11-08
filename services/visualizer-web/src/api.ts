import type { TraceView, LogEntry } from "./types";

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
