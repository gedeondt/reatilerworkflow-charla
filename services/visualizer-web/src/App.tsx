import React, { useEffect, useMemo, useState } from "react";
import {
  applyScenarioByName,
  applyScenarioDraft,
  createScenarioDraft,
  fetchDraftSummary,
  fetchLogs,
  fetchScenario,
  fetchScenarios,
  fetchTraces,
  markDraftReady,
} from "./api";
import type {
  DraftCreationResponse,
  DraftSummary,
  LogEntry,
  ScenarioListItem,
  TraceView,
} from "./types";

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
  const [availableScenarios, setAvailableScenarios] = useState<ScenarioListItem[]>([]);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);
  const [activeScenarioSource, setActiveScenarioSource] = useState<
    'business' | 'draft' | null
  >(null);
  const [draftIdInput, setDraftIdInput] = useState<string>("");
  const [draftSummary, setDraftSummary] = useState<DraftSummary | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isDraftLoading, setIsDraftLoading] = useState<boolean>(false);
  const [isMarkingReady, setIsMarkingReady] = useState<boolean>(false);
  const [isApplyingDraft, setIsApplyingDraft] = useState<boolean>(false);
  const [draftDescription, setDraftDescription] = useState<string>("");
  const [createDraftError, setCreateDraftError] = useState<string | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState<boolean>(false);
  const [createdDraft, setCreatedDraft] = useState<DraftCreationResponse | null>(
    null,
  );

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
      const response = await applyScenarioByName(name);
      setActiveScenario(response.name);
      setActiveScenarioSource(response.source ?? "business");
      setAvailableScenarios((prev) =>
        upsertScenarioItem(prev, {
          name: response.name,
          source: response.source ?? "business",
        })
      );
    } catch (err) {
      console.warn("Failed to switch scenario", err);
      setScenarioError(
        err instanceof Error ? err.message : "failed to switch scenario",
      );
      setIsSwitching(false);
      setPendingScenario(null);
    }
  };

  const handleDraftIdChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setDraftIdInput(event.target.value);
  };

  const handleDraftDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setDraftDescription(event.target.value);
  };

  const handleCreateDraft = async () => {
    if (!draftDescription.trim()) {
      setCreateDraftError("introduce una descripción antes de continuar");
      return;
    }

    setCreateDraftError(null);
    setDraftError(null);
    setIsCreatingDraft(true);

    try {
      const draft = await createScenarioDraft(draftDescription);
      setCreatedDraft(draft);
      setDraftIdInput(draft.id);
      setDraftSummary(null);
    } catch (error) {
      console.warn("Failed to create scenario draft", error);
      setCreateDraftError(
        "No se pudo generar el draft. Asegúrate de que scenario-designer está levantado y tiene OPENAI_API_KEY configurada.",
      );
      return;
    } finally {
      setIsCreatingDraft(false);
    }
  };

  const handleLoadDraftSummary = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    const trimmed = draftIdInput.trim();

    if (!trimmed) {
      setDraftError("introduce un ID de draft");
      setDraftSummary(null);
      return;
    }

    setDraftError(null);
    setIsDraftLoading(true);

    try {
      const summary = await fetchDraftSummary(trimmed);
      setDraftSummary(summary);
    } catch (err) {
      console.warn("Failed to load draft summary", err);
      setDraftSummary(null);
      setDraftError(
        err instanceof Error
          ? err.message
          : "no se pudo cargar el resumen del draft",
      );
    } finally {
      setIsDraftLoading(false);
    }
  };

  const handleMarkDraftReady = async () => {
    if (!draftSummary) {
      return;
    }

    setDraftError(null);
    setIsMarkingReady(true);

    try {
      await markDraftReady(draftSummary.id);
      const refreshed = await fetchDraftSummary(draftSummary.id);
      setDraftSummary(refreshed);
    } catch (err) {
      console.warn("Failed to mark draft ready", err);
      setDraftError(
        err instanceof Error
          ? err.message
          : "no se pudo marcar el draft como listo",
      );
    } finally {
      setIsMarkingReady(false);
    }
  };

  const handleApplyDraft = async () => {
    if (!draftSummary) {
      return;
    }

    setDraftError(null);
    setIsApplyingDraft(true);
    const previewName = (
      draftSummary.generatedScenarioPreview as { name?: unknown } | undefined
    )?.name;
    const proposalName = (
      draftSummary.currentProposal as { name?: unknown }
    )?.name;
    const nextScenarioName =
      (typeof previewName === "string"
        ? previewName
        : typeof proposalName === "string"
          ? proposalName
          : undefined) ?? draftSummary.id;
    setPendingScenario(nextScenarioName);
    setIsSwitching(true);

    try {
      const response = await applyScenarioDraft(draftSummary.id);
      setActiveScenario(response.name);
      setActiveScenarioSource(response.source ?? "draft");
      setAvailableScenarios((prev) =>
        upsertScenarioItem(prev, {
          name: response.name,
          source: response.source ?? "draft",
        })
      );
      setScenarioError(null);
    } catch (err) {
      console.warn("Failed to apply draft scenario", err);
      setDraftError(
        err instanceof Error
          ? err.message
          : "no se pudo aplicar el escenario generado",
      );
      setIsSwitching(false);
      setPendingScenario(null);
    } finally {
      setIsApplyingDraft(false);
    }
  };

  const canMarkReady = Boolean(
    draftSummary?.hasGeneratedScenario && draftSummary.status !== "ready",
  );
  const canApplyDraft = Boolean(
    draftSummary?.status === "ready" && draftSummary.hasGeneratedScenario,
  );

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
          value={activeScenario ?? ""}
          onChange={handleScenarioChange}
          disabled={!activeScenario || scenarioOptions.length === 0 || isSwitching}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded"
        >
          {!activeScenario ? (
            <option value="">loading…</option>
          ) : null}
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

  const draftPanel = (
    <div className="w-full border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] text-zinc-300 space-y-3">
      <div className="space-y-2">
        <div className="uppercase tracking-wide text-zinc-500">nuevo escenario</div>
        <textarea
          value={draftDescription}
          onChange={handleDraftDescriptionChange}
          placeholder="Describe un nuevo flujo o proceso para crear un escenario…"
          className="w-full min-h-[96px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
        />
        <p className="text-zinc-500 text-[10px]">
          Usa frases en castellano. Te propondremos dominios y eventos.
        </p>
        <button
          type="button"
          onClick={handleCreateDraft}
          disabled={isCreatingDraft}
          className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCreatingDraft
            ? "generando propuesta inicial…"
            : createdDraft
              ? "propuesta generada"
              : "crear draft"}
        </button>
        {createDraftError ? (
          <div className="text-red-400">{createDraftError}</div>
        ) : null}
        {createdDraft ? (
          <div className="border border-zinc-800 rounded px-3 py-2 bg-zinc-900 space-y-1">
            <div>
              <span className="text-zinc-500">Draft creado:</span>{" "}
              <span className="text-green-400">{createdDraft.id}</span>
            </div>
            <div>
              <span className="text-zinc-500">Dominios sugeridos:</span>{" "}
              <span className="text-zinc-300">
                {createdDraft.currentProposal.domains.length > 0
                  ? createdDraft.currentProposal.domains.join(", ")
                  : "—"}
              </span>
            </div>
            <div className="space-y-1">
              <div className="text-zinc-500">Eventos clave:</div>
              {createdDraft.currentProposal.events.length > 0 ? (
                <ul className="list-disc pl-4 space-y-0.5 text-zinc-300">
                  {createdDraft.currentProposal.events.map((event, index) => (
                    <li key={`${createdDraft.id}-event-${index}`}>
                      <span className="text-green-400">{event.title}</span>
                      {event.description ? (
                        <span className="text-zinc-500"> — {event.description}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-zinc-500">—</div>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <form
        onSubmit={handleLoadDraftSummary}
        className="flex flex-wrap items-center gap-2"
      >
        <label className="uppercase tracking-wide text-zinc-500">
          draft id
        </label>
        <input
          value={draftIdInput}
          onChange={handleDraftIdChange}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded min-w-[220px]"
        />
        <button
          type="submit"
          disabled={isDraftLoading}
          className="px-2 py-1 rounded border border-zinc-600 text-xs hover:bg-zinc-800 disabled:opacity-50"
        >
          ver resumen
        </button>
        <button
          type="button"
          onClick={handleMarkDraftReady}
          disabled={!draftSummary || !canMarkReady || isMarkingReady}
          className="px-2 py-1 rounded border border-yellow-600 text-xs text-yellow-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          marcar listo
        </button>
        <button
          type="button"
          onClick={handleApplyDraft}
          disabled={!draftSummary || !canApplyDraft || isApplyingDraft}
          className="px-2 py-1 rounded border border-green-600 text-xs text-green-400 hover:bg-zinc-800 disabled:opacity-50"
        >
          aplicar escenario
        </button>
      </form>
      {draftError ? (
        <div className="text-red-400">{draftError}</div>
      ) : null}
      {isDraftLoading ? (
        <div className="text-zinc-500">cargando resumen…</div>
      ) : null}
      {draftSummary ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <div>
              <span className="text-zinc-500">estado:</span>{" "}
              <span className="text-green-400">{draftSummary.status}</span>
            </div>
            <div className="text-zinc-400">
              {draftSummary.guidance ??
                "Valida el contenido antes de aplicar el escenario."}
            </div>
          </div>
          <div className="space-y-1">
            <div className="uppercase text-zinc-500">propuesta actual</div>
            <pre className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] overflow-auto max-h-48 whitespace-pre-wrap">
              {formatJson(draftSummary.currentProposal)}
            </pre>
          </div>
          {draftSummary.hasGeneratedScenario ? (
            <div className="space-y-1 md:col-span-2">
              <div className="uppercase text-zinc-500">json generado</div>
              <pre className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] overflow-auto max-h-56 whitespace-pre-wrap">
                {formatJson(draftSummary.generatedScenarioPreview)}
              </pre>
            </div>
          ) : (
            <div className="text-zinc-500 md:col-span-2">
              Genera el JSON del escenario para poder aplicarlo.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-green-400 font-mono text-sm flex flex-col">
      {header}
      {statusLine}
      {draftPanel}
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

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
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
