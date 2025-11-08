import React, { useState, useEffect } from "react";
import { fetchTraces, fetchLogs } from "./api";
import type { TraceView, LogEntry } from "./types";

const scenarioName =
  import.meta.env.VITE_SCENARIO_NAME || "retailer-happy-path";

export default function App() {
  const [traces, setTraces] = useState<TraceView[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [now, setNow] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let first = true;
    const interval = setInterval(async () => {
      try {
        if (first) {
          setIsLoading(true);
          setError(null);
        }
        const [data, fetchedLogs] = await Promise.all([
          fetchTraces(),
          fetchLogs(),
        ]);
        setTraces(data);
        setLogs(fetchedLogs);

        const allDomains = new Set<string>();
        data.forEach((t) =>
          Object.keys(t.domains).forEach((d) => allDomains.add(d))
        );
        setDomains(Array.from(allDomains).sort());

        setIsLoading(false);
        setError(null);
        setLastUpdate(new Date().toLocaleTimeString());
        first = false;
      } catch (err) {
        console.warn("Error fetching traces", err);
        setIsLoading(false);
        setError("error reading /traces");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const header = (
    <div className="w-full px-3 py-1 bg-zinc-900 text-zinc-300 flex justify-between gap-4">
      <span>reatilerworkflow :: saga visualizer</span>
      <span className="text-xs text-zinc-500">[scenario: {scenarioName}]</span>
      <span>{now}</span>
    </div>
  );

  const statusLine = (
    <div className="w-full px-3 py-1 bg-zinc-950 text-xs border-b border-zinc-800 flex justify-between gap-4">
      <span
        className={
          error
            ? "text-red-400"
            : isLoading
            ? "text-zinc-500"
            : "text-green-500"
        }
      >
        {error
          ? "status: ERROR reading /traces"
          : isLoading
          ? "status: waiting for traces from /traces"
          : "status: connected to /traces"}
      </span>
      <span className="text-zinc-500">
        traces: {traces.length} | domains: {domains.length}
        {lastUpdate ? ` | last update: ${lastUpdate}` : ""}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono text-sm flex flex-col">
      {header}
      {statusLine}
      <div className="flex-1 flex flex-col">
        {domains.length === 0 && !isLoading && !error ? (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
            <div className="text-center space-y-1">
              <div>No traces received yet.</div>
              <div>Trigger your first event by posting an OrderPlaced:</div>
              <div className="mt-1 text-[10px] text-green-500">
                curl -X POST http://localhost:3005/queues/orders/messages ...
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex-1 grid gap-1 p-1"
            style={{
              gridTemplateColumns: `repeat(${Math.max(
                domains.length,
                1
              )}, minmax(0, 1fr))`,
            }}
          >
            {domains.map((domain) => (
              <div
                key={domain}
                className="border border-zinc-700 rounded-sm flex flex-col overflow-hidden"
              >
                <div className="bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
                  [{domain}]
                </div>
                <div className="flex-1 overflow-auto px-2 py-1 space-y-1">
                  {renderDomainRows(domain, traces)}
                </div>
              </div>
            ))}
          </div>
        )}
        <LogsPanel logs={logs} />
      </div>
    </div>
  );
}

function renderDomainRows(domain: string, traces: TraceView[]) {
  const sorted = [...traces].sort(
    (a, b) =>
      new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime()
  );

  return sorted.flatMap((trace) => {
    const events = trace.domains[domain]?.events;
    if (!events || events.length === 0) return [];
    const last = events[events.length - 1];

    return (
      <div key={`${domain}-${trace.traceId}`} className="truncate">
        <span className="text-zinc-500 mr-1">{trace.traceId}</span>
        <span className="text-zinc-500">│</span>
        <span className="ml-1 text-green-400">{last.eventName}</span>
      </div>
    );
  });
}

type LogsPanelProps = {
  logs: LogEntry[];
};

function LogsPanel({ logs }: LogsPanelProps) {
  const hasLogs = logs.length > 0;
  return (
    <div className="border-t border-zinc-800 bg-zinc-950 px-2 py-2 text-[11px] text-green-400 min-h-[96px] max-h-48 overflow-auto">
      {hasLogs ? (
        <div className="space-y-1">
          {logs.map((entry, index) => (
            <div key={`${entry.occurredAt}-${entry.traceId}-${index}`} className="flex gap-2">
              <span className="text-zinc-500">
                {formatLogTime(entry.occurredAt)}
              </span>
              <span className="text-zinc-600">{entry.traceId}</span>
              <span className="text-zinc-600">│</span>
              <span className="text-zinc-500">[{entry.domain}]</span>
              <span className="text-green-400">{entry.eventName}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-zinc-600">waiting for events…</div>
      )}
    </div>
  );
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString();
}
