import React, { useState, useEffect } from "react";
import { fetchTraces } from "./api";
import type { TraceView } from "./types";

export default function App() {
  const [traces, setTraces] = useState<TraceView[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [now, setNow] = useState<string>("");

  useEffect(() => {
    const updateClock = () => setNow(new Date().toLocaleTimeString());
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await fetchTraces();
        setTraces(data);
        const allDomains = new Set<string>();
        data.forEach((t) => Object.keys(t.domains).forEach((d) => allDomains.add(d)));
        setDomains(Array.from(allDomains).sort());
      } catch (err) {
        console.warn("Error fetching traces", err);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono text-sm flex flex-col">
      <div className="w-full px-3 py-1 bg-zinc-900 text-zinc-300 flex justify-between">
        <span>reatilerworkflow :: saga visualizer</span>
        <span>{now}</span>
      </div>
      <div
        className="flex-1 grid gap-1 p-1"
        style={{
          gridTemplateColumns: `repeat(${Math.max(domains.length, 1)}, minmax(0, 1fr))`,
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
    if (!events?.length) return [];
    const last = events[events.length - 1];
    return (
      <div key={trace.traceId} className="truncate">
        <span className="text-zinc-500 mr-1">{trace.traceId}</span>
        <span className="text-zinc-500">│</span>
        <span className="ml-1 text-green-400">{last.eventName}</span>
      </div>
    );
  });
}
