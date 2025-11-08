import React, { useEffect, useMemo, useState } from "react";
import {
  fetchLogs,
  fetchScenario,
  fetchScenarios,
  fetchTraces,
  updateScenario,
} from "./api";
import type { LogEntry, TraceView } from "./types";

const defaultScenario =
  import.meta.env.VITE_SCENARIO_NAME || "retailer-happy-path";

export default function App() {
  const [traces, setTraces] = useState<TraceView[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [now, setNow] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [availableScenarios, setAvailableScenarios] = useState<string[]>([]);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadScenarioInfo = async () => {
      try {
        const [scenarioRes, scenariosRes] = await Promise.all([
          fetchScenario(),
          fetchScenarios(),
        ]);

        if (cancelled) return;

        const sortedItems = [...scenariosRes.items].sort();
        setActiveScenario(scenarioRes.name);
        setAvailableScenarios(sortedItems);
        setScenarioError(null);
      } catch (err) {
        if (cancelled) return;

        console.warn("Failed to load scenario information", err);
        setScenarioError("failed to load scenarios");

        setActiveScenario((prev) => prev ?? defaultScenario);

        setAvailableScenarios((prev) => {
          if (prev.length > 0) {
            return prev;
          }

          return [defaultScenario];
        });
      }
    };

    void loadScenarioInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeScenario) {
      return;
    }

    let cancelled = false;

    const pollScenario = async () => {
      try {
        const { name } = await fetchScenario();

        if (cancelled) {
          return;
        }

        if (name && name !== activeScenario) {
          setScenarioError(null);
          setPendingScenario(name);
          setIsSwitching(true);
          setActiveScenario(name);
          setAvailableScenarios((prev) => {
            if (prev.includes(name)) {
              return prev;
            }

            return [...prev, name].sort();
          });
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("Failed to refresh scenario", err);
        }
      }
    };

    const interval = setInterval(pollScenario, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeScenario]);

  useEffect(() => {
    if (!activeScenario) {
      return;
    }

    setTraces([]);
    setLogs([]);
    setDomains([]);
    setIsLoading(true);
    setError(null);
    setLastUpdate(null);
  }, [activeScenario]);

  useEffect(() => {
    if (!activeScenario) {
      return;
    }

    let cancelled = false;
    let first = true;

    const fetchData = async () => {
      const scenarioDuringFetch = activeScenario;

      try {
        if (first) {
          setIsLoading(true);
          setError(null);
        }

        const [data, fetchedLogs] = await Promise.all([
          fetchTraces(),
          fetchLogs(),
        ]);

        if (cancelled) {
          return;
        }

        setTraces(data);
        setLogs(fetchedLogs);

        const allDomains = new Set<string>();
        data.forEach((trace) =>
          Object.keys(trace.domains).forEach((domain) => allDomains.add(domain)),
        );
        setDomains(Array.from(allDomains).sort());

        setIsLoading(false);
        setError(null);
        setLastUpdate(new Date().toLocaleTimeString());
        first = false;

        if (activeScenario === scenarioDuringFetch) {
          setIsSwitching(false);
          setPendingScenario(null);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.warn("Error fetching traces", err);
        setIsLoading(false);
        setError("error reading /traces");

        if (activeScenario === scenarioDuringFetch) {
          setIsSwitching(false);
        }
      }
    };

    void fetchData();
    const interval = setInterval(fetchData, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeScenario]);

  const handleScenarioChange = async (
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const name = event.target.value;

    if (!name || name === activeScenario) {
      return;
    }

    setScenarioError(null);
    setPendingScenario(name);
    setIsSwitching(true);

    try {
      await updateScenario(name);
      setActiveScenario(name);
      setAvailableScenarios((prev) => {
        if (prev.includes(name)) {
          return prev;
        }

        return [...prev, name].sort();
      });
    } catch (err) {
      console.warn("Failed to switch scenario", err);
      setScenarioError(
        err instanceof Error ? err.message : "failed to switch scenario",
      );
      setIsSwitching(false);
      setPendingScenario(null);
    }
  };

  const scenarioOptions = useMemo(() => {
    const items = new Set(availableScenarios);

    if (activeScenario) {
      items.add(activeScenario);
    }

    return Array.from(items).sort();
  }, [availableScenarios, activeScenario]);

  const scenarioLabel = activeScenario ?? "loading…";

  let statusText = "status: waiting for traces from /traces";
  let statusClass = "text-zinc-500";

  if (scenarioError) {
    statusText = `status: ${scenarioError}`;
    statusClass = "text-red-400";
  } else if (error) {
    statusText = "status: ERROR reading /traces";
    statusClass = "text-red-400";
  } else if (isSwitching) {
    const target = pendingScenario ?? scenarioLabel;
    statusText = `status: switching scenario${target ? ` to ${target}` : ""}…`;
  } else if (!isLoading) {
    statusText = "status: connected to /traces";
    statusClass = "text-green-500";
  }

  const header = (
    <div className="w-full px-3 py-1 bg-zinc-900 text-zinc-300 flex justify-between gap-4 items-center">
      <span>reatilerworkflow :: saga visualizer</span>
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span>[scenario:</span>
        <select
          aria-label="Select scenario"
          value={activeScenario ?? ""}
          onChange={handleScenarioChange}
          disabled={!activeScenario || scenarioOptions.length === 0 || isSwitching}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded"
        >
          {!activeScenario ? (
            <option value="">loading…</option>
          ) : null}
          {scenarioOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span>]</span>
      </div>
      <span>{now}</span>
    </div>
  );

  const statusLine = (
    <div className="w-full px-3 py-1 bg-zinc-950 text-xs border-b border-zinc-800 flex justify-between gap-4">
      <span className={statusClass}>{statusText}</span>
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
                1,
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
      new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime(),
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
            <div
              key={`${entry.occurredAt}-${entry.traceId}-${index}`}
              className="flex gap-2"
            >
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
