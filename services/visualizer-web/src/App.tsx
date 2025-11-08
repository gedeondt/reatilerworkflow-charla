import React, { useState, useEffect } from "react";
import { fetchTraces } from "./api";
import type { TraceView } from "./types";

const scenarioName =
  import.meta.env.VITE_SCENARIO_NAME || "retailer-happy-path";

export default function App() {
  const [traces, setTraces] = useState<TraceView[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [now, setNow] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

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
        const data = await fetchTraces();
        setTraces(data);

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

  if (!isLoading && !error && domains.length === 0) {
    return (
      <div className="min-h-screen bg-black text-green-400 font-mono text-sm flex flex-col">
        {header}
        {statusLine}
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
          <div className="text-center space-y-1">
            <div>No traces received yet.</div>
            <div>Trigger your first event by posting an OrderPlaced:</div>
            <div className="mt-1 text-[10px] text-green-500">
              curl -X POST http://localhost:3005/queues/orders/messages ...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono text-sm flex flex-col">
      {header}
      {statusLine}
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
