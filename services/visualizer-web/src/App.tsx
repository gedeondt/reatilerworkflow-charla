import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLogs,
  fetchScenario,
  fetchScenarioDefinition,
  fetchScenarioBootstrap,
  fetchScenarios,
  fetchTraces,
} from "./api";
import type { LogEntry, ScenarioListItem, TraceView } from "./types";
import {
  ScenarioWizard,
  type ScenarioWizardState,
  defaultScenarioWizardState,
} from "./components/scenario-wizard/ScenarioWizard";

type BootstrapHint = {
  queue: string;
  event: Record<string, unknown>;
};

const defaultScenario =
  import.meta.env.VITE_SCENARIO_NAME || "retailer-happy-path";
const queueBase = import.meta.env.VITE_QUEUE_BASE || "http://localhost:3005";

export default function App() {
  const [traces, setTraces] = useState<TraceView[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [now, setNow] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [availableScenarios, setAvailableScenarios] = useState<ScenarioListItem[]>([]);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);
  const [activeScenarioSource, setActiveScenarioSource] = useState<
    'business' | 'draft' | null
  >(null);
  const [wizardState, setWizardState] = useState<ScenarioWizardState>(
    defaultScenarioWizardState,
  );
  const [bootstrapHint, setBootstrapHint] = useState<BootstrapHint | null>(null);

  const readScenarioBootstrap = useCallback(async (): Promise<BootstrapHint | null> => {
    try {
      const response = await fetchScenarioBootstrap();

      if (response.hasBootstrap) {
        return { queue: response.queue, event: response.event };
      }
    } catch (err) {
      console.warn("Failed to load scenario bootstrap", err);
    }

    return null;
  }, []);

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

        const sortedItems = [...scenariosRes.items].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        setActiveScenario(scenarioRes.name);
        setActiveScenarioSource(scenarioRes.source ?? "business");
        setAvailableScenarios(sortedItems);
        setScenarioError(null);
      } catch (err) {
        if (cancelled) return;

        console.warn("Failed to load scenario information", err);
        setScenarioError("failed to load scenarios");

        setActiveScenario((prev) => prev ?? defaultScenario);
        setActiveScenarioSource((prev) => prev ?? "business");

        setAvailableScenarios((prev) => {
          if (prev.length > 0) {
            return prev;
          }

          return [{ name: defaultScenario, source: "business" }];
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
        const scenarioRes = await fetchScenario();
        const name = scenarioRes.name;
        const incomingSource = scenarioRes.source ?? "business";

        if (cancelled) {
          return;
        }

        if (!name) {
          return;
        }

        if (name !== activeScenario) {
          setScenarioError(null);
          setPendingScenario(name);
          setIsSwitching(true);
          setActiveScenario(name);
          setActiveScenarioSource(incomingSource);
          setAvailableScenarios((prev) =>
            upsertScenarioItem(prev, { name, source: incomingSource })
          );
        } else if (incomingSource !== activeScenarioSource) {
          setActiveScenarioSource(incomingSource);
          setAvailableScenarios((prev) =>
            upsertScenarioItem(prev, { name, source: incomingSource })
          );
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
  }, [activeScenario, activeScenarioSource]);

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
      setBootstrapHint(null);
      return;
    }

    let cancelled = false;
    setBootstrapHint(null);

    const loadBootstrapHint = async () => {
      const hint = await readScenarioBootstrap();

      if (!cancelled) {
        setBootstrapHint(hint);
      }
    };

    void loadBootstrapHint();

    return () => {
      cancelled = true;
    };
  }, [activeScenario, activeScenarioSource, readScenarioBootstrap]);

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

    if (!name) {
      setWizardState((prev) => ({ ...prev, selectedScenario: "" }));
      return;
    }

    setWizardState((prev) => ({
      ...prev,
      selectedScenario: name,
      designerSource: { kind: "business", name },
      isCollapsed: false,
      wizardStep: 2,
      validation: { status: "idle", errors: [] },
      mermaidCode: "",
      curlSnippet: "",
      descriptionText: "",
      draftId: null,
      draftSummary: null,
    }));

    try {
      const { definition } = await fetchScenarioDefinition(name);
      const json = JSON.stringify(definition, null, 2);
      setWizardState((prev) => ({
        ...prev,
        designerJson: json,
      }));
    } catch (err) {
      console.warn("Failed to load scenario definition", err);
      const message = err instanceof Error ? err.message : String(err);
      const errorMessage =
        message === "not_found"
          ? `El escenario '${name}' no existe.`
          : `No se pudo cargar el escenario '${name}'.`;
      setWizardState((prev) => ({
        ...prev,
        designerJson: "",
        validation: { status: "invalid", errors: [errorMessage] },
        mermaidCode: "",
        draftId: null,
        draftSummary: null,
      }));
    }
  };

  const scenarioOptions = useMemo(() => {
    const map = new Map<string, ScenarioListItem>();

    for (const item of availableScenarios) {
      map.set(item.name, item);
    }

    if (activeScenario) {
      map.set(activeScenario, {
        name: activeScenario,
        source: activeScenarioSource ?? "business",
      });
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [availableScenarios, activeScenario, activeScenarioSource]);

  const formatScenarioOption = (item: ScenarioListItem) =>
    item.source === "draft" ? `${item.name} (draft)` : item.name;

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
          value={wizardState.selectedScenario}
          onChange={handleScenarioChange}
          disabled={scenarioOptions.length === 0}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded"
        >
          <option value="">
            {scenarioOptions.length === 0 ? "Cargando…" : "Elegir escenario…"}
          </option>
          {scenarioOptions.map((option) => (
            <option key={option.name} value={option.name}>
              {formatScenarioOption(option)}
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

  const wizardPanel = (
    <ScenarioWizard
      state={wizardState}
      setState={setWizardState}
      queueBase={queueBase}
    />
  );


  return (
    <div className="min-h-screen bg-black text-green-400 font-mono text-sm flex flex-col">
      {header}
      {statusLine}
      {wizardPanel}
      <div className="flex-1 flex flex-col">
        {domains.length === 0 && !isLoading && !error ? (
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs">
            <div className="text-center space-y-1">
              <div>No traces received yet.</div>
              {bootstrapHint ? (
                <>
                  <div>Trigger your first event with this bootstrap:</div>
                  <pre className="mt-1 text-[10px] text-green-500 text-left whitespace-pre-wrap">
                    {buildBootstrapCurl(queueBase, bootstrapHint.queue, bootstrapHint.event)}
                  </pre>
                </>
              ) : (
                <>
                  <div>Trigger your first event by posting an OrderPlaced:</div>
                  <div className="mt-1 text-[10px] text-green-500">
                    {`curl -X POST ${queueBase}/queues/orders/messages ...`}
                  </div>
                </>
              )}
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

function buildBootstrapCurl(
  baseUrl: string,
  queue: string,
  event: Record<string, unknown>,
): string {
  const serializedEvent = JSON.stringify(event, null, 2).replace(/'/g, "\'");
  const queuePath = encodeURIComponent(queue);

  return [
    `curl -X POST ${baseUrl}/queues/${queuePath}/messages \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${serializedEvent}'`,
  ].join("\n");
}

function upsertScenarioItem(
  list: ScenarioListItem[],
  item: ScenarioListItem,
): ScenarioListItem[] {
  const map = new Map<string, ScenarioListItem>();

  for (const existing of list) {
    map.set(existing.name, existing);
  }

  map.set(item.name, item);

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
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
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);

  const handleCloseModal = useCallback(() => {
    setSelectedEntry(null);
  }, []);

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 px-2 py-2 text-[11px] text-green-400 min-h-[96px] max-h-48 overflow-auto">
      {hasLogs ? (
        <div className="space-y-1">
          {logs.map((entry, index) => (
            <button
              key={`${entry.occurredAt}-${entry.traceId}-${index}`}
              type="button"
              className="flex w-full items-start gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-zinc-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60"
              onClick={() => setSelectedEntry(entry)}
            >
              <span className="text-zinc-500">
                {formatLogTime(entry.occurredAt)}
              </span>
              <span className="text-zinc-600">{entry.traceId}</span>
              <span className="text-zinc-600">│</span>
              <span className="text-zinc-500">[{entry.domain}]</span>
              <span className="text-green-400">{entry.eventName}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-zinc-600">waiting for events…</div>
      )}
      {selectedEntry ? (
        <LogEntryDetailModal entry={selectedEntry} onClose={handleCloseModal} />
      ) : null}
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

type LogEntryDetailModalProps = {
  entry: LogEntry;
  onClose: () => void;
};

function LogEntryDetailModal({ entry, onClose }: LogEntryDetailModalProps) {
  const eventDetails = useMemo(() => {
    const details: Record<string, unknown> = {
      traceId: entry.traceId,
      domain: entry.domain,
      eventName: entry.eventName,
      occurredAt: entry.occurredAt,
      rawEvent: entry.rawEvent,
    };

    if (entry.queue) {
      details.queue = entry.queue;
    }

    if (entry.originalPayload !== undefined) {
      details.originalPayload = entry.originalPayload;
    }

    return details;
  }, [entry]);

  const formattedJson = useMemo(() => safeStringify(eventDetails), [eventDetails]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="log-entry-detail-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-lg border border-zinc-800 bg-zinc-950 text-green-300 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 id="log-entry-detail-title" className="text-sm font-semibold text-green-200">
              Detalle de evento
            </h2>
            <p className="text-xs text-zinc-400">
              {entry.eventName} • {entry.domain} • {formatLogTime(entry.occurredAt)}
            </p>
          </div>
          <button
            type="button"
            className="text-xs font-medium text-zinc-400 transition-colors hover:text-green-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60"
            autoFocus
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto px-4 py-3">
          <pre className="whitespace-pre text-xs leading-5 font-mono text-green-200">
            {formattedJson}
          </pre>
        </div>
      </div>
    </div>
  );
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === "object" && val !== null) {
          const objectValue = val as object;
          if (seen.has(objectValue)) {
            return "[Circular]";
          }
          seen.add(objectValue);
        }
        return val;
      },
      2,
    );

    return typeof serialized === "string" ? serialized : String(serialized);
  } catch (error) {
    return error instanceof Error ? error.message : String(value);
  }
}
