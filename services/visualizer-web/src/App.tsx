import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyScenarioDraft,
  createScenarioDraft,
  fetchDraftSummary,
  fetchLogs,
  fetchScenario,
  fetchScenarioDefinition,
  fetchScenarioBootstrap,
  fetchScenarios,
  fetchTraces,
  generateDraftJson,
  markDraftReady,
  refineScenarioDraft,
} from "./api";
import type {
  DraftCreationResponse,
  DraftSummary,
  LogEntry,
  ScenarioListItem,
  ScenarioProposal,
  TraceView,
} from "./types";
import NewScenarioDiagram from "./NewScenarioDiagram";

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
  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [availableScenarios, setAvailableScenarios] = useState<ScenarioListItem[]>([]);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);
  const [activeScenarioSource, setActiveScenarioSource] = useState<
    'business' | 'draft' | null
  >(null);
  const [existingDraftIdInput, setExistingDraftIdInput] = useState<string>("");
  const [draftSummary, setDraftSummary] = useState<DraftSummary | null>(null);
  const [isDraftLoading, setIsDraftLoading] = useState<boolean>(false);
  const [isMarkingReady, setIsMarkingReady] = useState<boolean>(false);
  const [isApplyingDraft, setIsApplyingDraft] = useState<boolean>(false);
  const [isGeneratingJson, setIsGeneratingJson] = useState<boolean>(false);
  const [isRefiningDraft, setIsRefiningDraft] = useState<boolean>(false);
  const [draftDescription, setDraftDescription] = useState<string>("");
  const [isCreatingDraft, setIsCreatingDraft] = useState<boolean>(false);
  const [createdDraft, setCreatedDraft] = useState<DraftCreationResponse | null>(
    null,
  );
  const [isDesignerOpen, setIsDesignerOpen] = useState<boolean>(false);
  const [designerJson, setDesignerJson] = useState<string>("");
  const [designerSource, setDesignerSource] = useState<
    { kind: "business" | "manual"; name?: string } | null
  >(null);
  const [designerError, setDesignerError] = useState<string | null>(null);
  const [refinementFeedback, setRefinementFeedback] = useState<string>("");
  const [activeWizardStep, setActiveWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [step1Completed, setStep1Completed] = useState<boolean>(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);
  const [step2Error, setStep2Error] = useState<string | null>(null);
  const [step2Message, setStep2Message] = useState<string | null>(null);
  const [step3Error, setStep3Error] = useState<string | null>(null);
  const [step4Error, setStep4Error] = useState<string | null>(null);
  const [step4Message, setStep4Message] = useState<string | null>(null);
  const [jsonStatus, setJsonStatus] = useState<"idle" | "pending" | "success">(
    "idle",
  );
  const [generatedScenario, setGeneratedScenario] = useState<
    Record<string, unknown> | null
  >(null);
  const [currentProposal, setCurrentProposal] = useState<ScenarioProposal | null>(
    null,
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
    setSelectedScenario(name);

    if (!name) {
      setDesignerError(null);
      return;
    }

    try {
      setDesignerError(null);

      const definition = await fetchScenarioDefinition(name);
      const serialized = JSON.stringify(definition.definition, null, 2);
      setDesignerJson(serialized);
      setDesignerSource({ kind: "business", name: definition.name });
      setIsDesignerOpen(true);
      setStep1Completed(true);
      setStep1Error(null);
      setActiveWizardStep(2);
    } catch (err) {
      console.warn("Failed to load scenario definition", err);
      const message = err instanceof Error ? err.message : String(err);
      if (message === "not_found") {
        setDesignerError(`El escenario '${name}' no existe.`);
      } else {
        setDesignerError(`No se pudo cargar el escenario '${name}'.`);
      }
    }
  };

  const handleDesignerJsonChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setDesignerJson(event.target.value);

    if (designerSource) {
      setDesignerSource(null);
    }

    if (designerError) {
      setDesignerError(null);
    }
  };

  const handleExistingDraftIdChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    setExistingDraftIdInput(event.target.value);
  };

  const handleDraftDescriptionChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setDraftDescription(event.target.value);
  };

  const toggleDesignerPanel = () => {
    setIsDesignerOpen((prev) => !prev);
  };

  const resetWizard = useCallback(() => {
    setDraftSummary(null);
    setDraftDescription("");
    setIsCreatingDraft(false);
    setCreatedDraft(null);
    setRefinementFeedback("");
    setActiveWizardStep(1);
    setStep1Completed(false);
    setStep1Error(null);
    setStep2Error(null);
    setStep2Message(null);
    setStep3Error(null);
    setStep4Error(null);
    setStep4Message(null);
    setJsonStatus("idle");
    setGeneratedScenario(null);
    setCurrentProposal(null);
    setExistingDraftIdInput("");
  }, []);

  const handleCreateDraft = async () => {
    if (!draftDescription.trim()) {
      setStep1Error("Introduce una descripción antes de continuar");
      return;
    }

    setStep1Error(null);
    setStep2Error(null);
    setStep2Message(null);
    setStep3Error(null);
    setJsonStatus("idle");
    setGeneratedScenario(null);
    setIsCreatingDraft(true);
    setCreatedDraft(null);
    setCurrentProposal(null);

    try {
      const draft = await createScenarioDraft(draftDescription);
      setCreatedDraft(draft);
      setCurrentProposal(draft.currentProposal);
      setExistingDraftIdInput(draft.id);
      setStep1Completed(true);

      try {
        const summary = await fetchDraftSummary(draft.id);
        setDraftSummary(summary);
        const parsedProposal = parseScenarioProposal(summary.currentProposal);
        if (parsedProposal) {
          setCurrentProposal(parsedProposal);
        }
        if (summary.hasGeneratedScenario) {
          setJsonStatus("success");
          setGeneratedScenario(
            (summary.generatedScenarioPreview as Record<string, unknown>) ??
              null,
          );
        } else {
          setJsonStatus("idle");
          setGeneratedScenario(null);
        }
      } catch (summaryError) {
        console.warn("Failed to refresh draft summary", summaryError);
        setDraftSummary(null);
      }

      setActiveWizardStep(2);
    } catch (error) {
      console.warn("Failed to create scenario draft", error);
      setStep1Error(
        "No se pudo generar el borrador. Asegúrate de que @reatiler/scenario-designer está levantado con 'pnpm stack:dev:web' y tiene OPENAI_API_KEY configurada.",
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
    const trimmed = existingDraftIdInput.trim();

    if (!trimmed) {
      setStep1Error("Introduce un ID de borrador válido");
      setDraftSummary(null);
      return;
    }

    setStep1Error(null);
    setStep2Error(null);
    setStep2Message(null);
    setStep3Error(null);
    setJsonStatus("idle");
    setGeneratedScenario(null);
    setCreatedDraft(null);
    setCurrentProposal(null);
    setIsDraftLoading(true);

    try {
      const summary = await fetchDraftSummary(trimmed);
      setExistingDraftIdInput(summary.id ?? trimmed);
      setDraftSummary(summary);
      const parsedProposal = parseScenarioProposal(summary.currentProposal);
      if (parsedProposal) {
        setCurrentProposal(parsedProposal);
      }
      if (summary.hasGeneratedScenario) {
        setJsonStatus("success");
        setGeneratedScenario(
          (summary.generatedScenarioPreview as Record<string, unknown>) ?? null,
        );
      }
      setActiveWizardStep(2);
    } catch (err) {
      console.warn("Failed to load draft summary", err);
      setDraftSummary(null);
      setStep1Error(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el borrador indicado.",
      );
    } finally {
      setIsDraftLoading(false);
    }
  };

  const handleMarkDraftReady = async () => {
    if (!draftSummary) {
      return;
    }

    setStep4Error(null);
    setStep4Message(null);
    setIsMarkingReady(true);

    try {
      await markDraftReady(draftSummary.id);
      const refreshed = await fetchDraftSummary(draftSummary.id);
      setDraftSummary(refreshed);
      setStep4Message("Borrador marcado como listo.");
    } catch (err) {
      console.warn("Failed to mark draft ready", err);
      setStep4Error(
        err instanceof Error
          ? err.message
          : "No se pudo marcar el borrador como listo.",
      );
    } finally {
      setIsMarkingReady(false);
    }
  };

  const handleApplyDraft = async () => {
    if (!draftSummary) {
      return;
    }

    setStep4Error(null);
    setStep4Message(null);
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
      resetWizard();
      setIsNewScenarioOpen(false);

      try {
        const refreshed = await fetchScenario();
        setActiveScenario(refreshed.name);
        setActiveScenarioSource(refreshed.source ?? "business");
        setAvailableScenarios((prev) =>
          upsertScenarioItem(prev, {
            name: refreshed.name,
            source: refreshed.source ?? "business",
          })
        );
      } catch (refreshError) {
        console.warn("Failed to refresh scenario after applying draft", refreshError);
      }

      setBootstrapHint(null);
      const bootstrap = await readScenarioBootstrap();
      setBootstrapHint(bootstrap);
    } catch (err) {
      console.warn("Failed to apply draft scenario", err);
      setStep4Error(
        err instanceof Error
          ? err.message
          : "No se pudo aplicar el escenario generado.",
      );
      setIsSwitching(false);
      setPendingScenario(null);
    } finally {
      setIsApplyingDraft(false);
    }
  };

  const handleGenerateDraftJson = async () => {
    if (!draftSummary) {
      return;
    }

    setStep2Message(null);
    setStep3Error(null);
    setJsonStatus("pending");
    setIsGeneratingJson(true);

    try {
      await generateDraftJson(draftSummary.id);
      const refreshed = await fetchDraftSummary(draftSummary.id);
      setDraftSummary(refreshed);
      const parsedProposal = parseScenarioProposal(refreshed.currentProposal);
      if (parsedProposal) {
        setCurrentProposal(parsedProposal);
      }
      if (refreshed.hasGeneratedScenario) {
        setJsonStatus("success");
        setGeneratedScenario(
          (refreshed.generatedScenarioPreview as Record<string, unknown>) ?? null,
        );
        setActiveWizardStep(4);
      } else {
        setJsonStatus("idle");
        setGeneratedScenario(null);
      }
    } catch (err) {
      console.warn("Failed to generate scenario JSON", err);
      setJsonStatus("idle");
      setGeneratedScenario(null);
      const message =
        err instanceof Error ? err.message.toLowerCase() : String(err);
      if (message.includes("invalid") || message.includes("formato")) {
        setStep3Error(
          "La definición generada no es válida, revisa la descripción o refina la propuesta.",
        );
      } else if (message.includes("openai")) {
        setStep3Error(
          "No se pudo generar el JSON debido a un error de OpenAI. Inténtalo de nuevo en unos segundos.",
        );
      } else {
        setStep3Error(
          "Error generando JSON. Comprueba que scenario-designer está levantado y vuelve a intentarlo.",
        );
      }
    } finally {
      setIsGeneratingJson(false);
    }
  };

  const handleRefinementFeedbackChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setRefinementFeedback(event.target.value);
    if (step2Error) {
      setStep2Error(null);
    }
  };

  const handleRefineDraft = async () => {
    if (!draftSummary) {
      return;
    }

    const trimmed = refinementFeedback.trim();

    if (!trimmed) {
      return;
    }

    setStep2Error(null);
    setStep2Message("Refinando propuesta...");
    setIsRefiningDraft(true);

    try {
      const refined = await refineScenarioDraft(draftSummary.id, trimmed);
      const refreshed = await fetchDraftSummary(draftSummary.id);
      setDraftSummary(refreshed);
      setCurrentProposal(refined.currentProposal);
      setStep2Message("Propuesta refinada correctamente");
      setRefinementFeedback("");
    } catch (err) {
      console.warn("Failed to refine draft proposal", err);
      setStep2Message(null);
      setStep2Error("Error refinando propuesta.");
    } finally {
      setIsRefiningDraft(false);
    }
  };

  const canMarkReady = Boolean(
    draftSummary?.hasGeneratedScenario && draftSummary.status !== "ready",
  );
  const canApplyDraft = Boolean(
    draftSummary?.status === "ready" && draftSummary.hasGeneratedScenario,
  );

  const isDraftActionPending =
    isGeneratingJson || isRefiningDraft || isMarkingReady || isApplyingDraft;
  const canSubmitRefinement = refinementFeedback.trim().length > 0;

  const activeDraftId = draftSummary?.id ?? createdDraft?.id ?? null;
  const summaryPreviewValue = draftSummary?.generatedScenarioPreview;
  const summaryPreviewRecord =
    summaryPreviewValue && typeof summaryPreviewValue === "object"
      ? (summaryPreviewValue as Record<string, unknown>)
      : null;
  const scenarioPreviewData = generatedScenario ?? summaryPreviewRecord ?? null;
  const hasGeneratedScenarioAvailable = Boolean(
    scenarioPreviewData ?? draftSummary?.hasGeneratedScenario,
  );
  const isStep2Enabled = Boolean(
    activeDraftId || step1Completed || designerJson.trim().length > 0,
  );
  const isStep3Enabled = Boolean(activeDraftId);
  const isStep4Enabled = Boolean(activeDraftId && hasGeneratedScenarioAvailable);

  useEffect(() => {
    if (!isStep2Enabled && activeWizardStep > 1) {
      setActiveWizardStep(1);
      return;
    }

    if (!isStep3Enabled && activeWizardStep > 2) {
      setActiveWizardStep(2);
      return;
    }

    if (!isStep4Enabled && activeWizardStep > 3) {
      setActiveWizardStep(3);
    }
  }, [
    activeWizardStep,
    isStep2Enabled,
    isStep3Enabled,
    isStep4Enabled,
  ]);

  useEffect(() => {
    const hasDesignerJson = designerJson.trim().length > 0;

    if (hasDesignerJson && !step1Completed) {
      setStep1Completed(true);
      setStep1Error(null);
      if (activeWizardStep === 1) {
        setActiveWizardStep(2);
      }
      if (!isDesignerOpen) {
        setIsDesignerOpen(true);
      }
    }
    if (!hasDesignerJson && step1Completed && !activeDraftId) {
      setStep1Completed(false);
    }
  }, [
    designerJson,
    step1Completed,
    activeWizardStep,
    isDesignerOpen,
    activeDraftId,
  ]);

  const wizardSteps = [
    { id: 1, label: "Descripción", enabled: true },
    { id: 2, label: "Refinar", enabled: isStep2Enabled },
    { id: 3, label: "Generar JSON", enabled: isStep3Enabled },
    { id: 4, label: "Vista previa y aplicar", enabled: isStep4Enabled },
  ] as const;

  const stepContent = (() => {
    const goToGeneration = () => {
      if (isStep3Enabled) {
        setActiveWizardStep(3);
      }
    };

    const skipRefinement = () => {
      setRefinementFeedback("");
      setStep2Error(null);
      setStep2Message("Se mantiene la propuesta original.");
      goToGeneration();
    };

    switch (activeWizardStep) {
      case 1: {
        const proposalPreview = createdDraft?.currentProposal ?? currentProposal;

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="uppercase text-[10px] text-zinc-500">
                Descripción del escenario
              </label>
              <textarea
                value={draftDescription}
                onChange={handleDraftDescriptionChange}
                placeholder="Describe un nuevo flujo o proceso para crear un escenario…"
                className="w-full min-h-[96px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
              />
              <p className="text-zinc-500 text-[10px]">
                Usa frases en castellano. Te propondremos dominios y eventos.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleCreateDraft}
                disabled={isCreatingDraft}
                className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Crear borrador
              </button>
              {isCreatingDraft ? (
                <span className="text-green-400 text-[10px]">
                  Generando propuesta inicial…
                </span>
              ) : null}
            </div>
            {step1Error ? (
              <div className="text-red-400 text-[10px]">{step1Error}</div>
            ) : null}
            {proposalPreview ? (
              <div className="border border-zinc-800 rounded px-3 py-3 bg-zinc-900 space-y-2">
                <div className="uppercase text-[10px] text-zinc-500">
                  Resumen preliminar
                </div>
                <div className="space-y-1 text-[11px]">
                  <div>
                    <span className="text-zinc-500">ID del borrador:</span>{" "}
                    <span className="text-green-400">
                      {createdDraft?.id ?? draftSummary?.id ?? "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Nombre sugerido:</span>{" "}
                    <span className="text-green-400">
                      {proposalPreview.name || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Dominios:</span>{" "}
                    <span className="text-zinc-300">
                      {proposalPreview.domains.length > 0
                        ? proposalPreview.domains.join(", ")
                        : "—"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-zinc-500">Eventos clave:</div>
                    {proposalPreview.events.length > 0 ? (
                      <ul className="list-disc pl-4 space-y-0.5 text-zinc-300">
                        {proposalPreview.events.map((event, index) => (
                          <li key={`step1-event-${index}`}>
                            <span className="text-green-400">{event.title}</span>
                            {event.description ? (
                              <span className="text-zinc-500">
                                {" "}— {event.description}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-zinc-500">—</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="border-t border-zinc-800 pt-3 space-y-2">
              <span className="uppercase text-[10px] text-zinc-500">
                Cargar borrador existente
              </span>
              <form
                onSubmit={handleLoadDraftSummary}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  value={existingDraftIdInput}
                  onChange={handleExistingDraftIdChange}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded min-w-[220px]"
                />
                <button
                  type="submit"
                  disabled={isDraftLoading || isDraftActionPending}
                  className="px-2 py-1 rounded border border-zinc-600 text-xs hover:bg-zinc-800 disabled:opacity-50"
                >
                  Ver resumen
                </button>
              </form>
              {isDraftLoading ? (
                <div className="text-zinc-500 text-[10px]">
                  Cargando borrador…
                </div>
              ) : null}
            </div>
          </div>
        );
      }
      case 2: {
        if (!isStep2Enabled) {
          return (
            <div className="text-zinc-500 text-[10px]">
              Crea o carga un borrador para revisar la propuesta.
            </div>
          );
        }

        const proposal = currentProposal;

        return (
          <div className="space-y-4">
            <div className="border border-zinc-800 rounded px-3 py-3 bg-zinc-900 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="uppercase text-[10px] text-zinc-500">
                  Propuesta actual
                </span>
                <span className="text-[10px] text-zinc-500">
                  Estado: {" "}
                  <span className="text-green-400">
                    {draftSummary?.status ?? createdDraft?.status ?? "desconocido"}
                  </span>
                </span>
              </div>
              {draftSummary?.guidance ? (
                <div className="text-zinc-400 text-[10px]">
                  {draftSummary.guidance}
                </div>
              ) : null}
              <div className="space-y-1 text-[11px]">
                <div>
                  <span className="text-zinc-500">Nombre sugerido:</span>{" "}
                  <span className="text-green-400">
                    {proposal?.name ?? "—"}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Dominios:</span>{" "}
                  <span className="text-zinc-300">
                    {proposal && proposal.domains.length > 0
                      ? proposal.domains.join(", ")
                      : "—"}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-zinc-500">Eventos clave:</div>
                  {proposal && proposal.events.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-0.5 text-zinc-300">
                      {proposal.events.map((event, index) => (
                        <li key={`step2-event-${index}`}>
                          <span className="text-green-400">{event.title}</span>
                          {event.description ? (
                            <span className="text-zinc-500">
                              {" "}— {event.description}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-zinc-500">—</div>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-zinc-500">Preguntas abiertas:</div>
                  {proposal && proposal.openQuestions.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-0.5 text-zinc-300">
                      {proposal.openQuestions.map((question, index) => (
                        <li key={`step2-question-${index}`}>{question}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-zinc-500">—</div>
                  )}
                </div>
              </div>
            </div>
            {isDraftLoading ? (
              <div className="text-zinc-500 text-[10px]">
                Actualizando resumen del borrador…
              </div>
            ) : null}
            {step2Error ? (
              <div className="text-red-400 text-[10px]">{step2Error}</div>
            ) : null}
            {step2Message ? (
              <div className="text-green-400 text-[10px]">{step2Message}</div>
            ) : null}
            <div className="space-y-2">
              <label className="uppercase text-[10px] text-zinc-500">
                JSON del escenario
              </label>
              <textarea
                value={designerJson}
                onChange={handleDesignerJsonChange}
                placeholder="Pega o edita un escenario en formato JSON…"
                className="w-full min-h-[160px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
              />
              {designerSource && designerSource.kind === "business" ? (
                <p className="text-[10px] text-zinc-500">
                  precargado desde {designerSource.kind}: {designerSource.name}
                </p>
              ) : null}
              {designerError ? (
                <div className="text-[10px] text-red-400">{designerError}</div>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="uppercase text-[10px] text-zinc-500">
                Feedback de refinado
              </label>
              <textarea
                value={refinementFeedback}
                onChange={handleRefinementFeedbackChange}
                placeholder="Introduce mejoras o feedback..."
                disabled={isRefiningDraft}
                className="w-full min-h-[72px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600 disabled:opacity-50"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefineDraft}
                  disabled={!draftSummary || !canSubmitRefinement || isRefiningDraft}
                  className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Refinar propuesta
                </button>
                <button
                  type="button"
                  onClick={skipRefinement}
                  disabled={isRefiningDraft}
                  className="px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 text-xs hover:bg-zinc-900/60"
                >
                  Saltar refinado
                </button>
                <button
                  type="button"
                  onClick={goToGeneration}
                  disabled={!isStep3Enabled}
                  className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50"
                >
                  Continuar a generación
                </button>
              </div>
              {isRefiningDraft ? (
                <div className="text-zinc-400 text-[10px]">Enviando feedback…</div>
              ) : null}
            </div>
          </div>
        );
      }
      case 3: {
        if (!isStep3Enabled) {
          return (
            <div className="text-zinc-500 text-[10px]">
              Finaliza el paso anterior antes de generar el JSON.
            </div>
          );
        }

        const statusLabel = isGeneratingJson || jsonStatus === "pending"
          ? "En proceso"
          : jsonStatus === "success"
            ? "Generado"
            : "Pendiente";
        const preview = scenarioPreviewData;

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleGenerateDraftJson}
                disabled={isGeneratingJson || !draftSummary}
                className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generar JSON del escenario
              </button>
              <div className="text-[10px] text-zinc-500">
                Estado de generación: {" "}
                <span className="text-green-400">{statusLabel}</span>
              </div>
              {isGeneratingJson ? (
                <div className="text-green-400 text-[10px]">Generando JSON…</div>
              ) : null}
              {step3Error ? (
                <div className="text-red-400 text-[10px]">{step3Error}</div>
              ) : null}
              {jsonStatus === "success" && !step3Error ? (
                <div className="text-green-400 text-[10px]">
                  JSON generado correctamente.
                </div>
              ) : null}
            </div>
            {preview ? (
              <div className="space-y-2">
                <div className="uppercase text-[10px] text-zinc-500">
                  Vista rápida del JSON generado
                </div>
                <pre className="bg-zinc-900 border border-zinc-800 rounded px-2 py-2 text-[10px] overflow-auto max-h-56 whitespace-pre-wrap">
                  {formatJson(preview)}
                </pre>
                <button
                  type="button"
                  onClick={() => setActiveWizardStep(4)}
                  className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60"
                >
                  Ir a vista previa
                </button>
              </div>
            ) : null}
          </div>
        );
      }
      case 4: {
        if (!isStep4Enabled) {
          return (
            <div className="text-zinc-500 text-[10px]">
              Genera primero el JSON del escenario para ver la vista previa.
            </div>
          );
        }

        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="uppercase text-[10px] text-zinc-500">
                Vista previa del flujo
              </div>
              {scenarioPreviewData ? (
                <NewScenarioDiagram scenarioJson={scenarioPreviewData} />
              ) : (
                <div className="text-zinc-500 text-[10px]">
                  Genera primero el JSON del escenario para ver la vista previa.
                </div>
              )}
            </div>
            {step4Error ? (
              <div className="text-red-400 text-[10px]">{step4Error}</div>
            ) : null}
            {step4Message ? (
              <div className="text-green-400 text-[10px]">{step4Message}</div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleMarkDraftReady}
                disabled={!canMarkReady || isMarkingReady}
                className="px-3 py-1.5 rounded border border-yellow-600 text-yellow-300 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Marcar listo
              </button>
              <button
                type="button"
                onClick={handleApplyDraft}
                disabled={!canApplyDraft || isApplyingDraft}
                className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Aplicar escenario
              </button>
            </div>
            {isMarkingReady ? (
              <div className="text-zinc-400 text-[10px]">Marcando borrador como listo…</div>
            ) : null}
            {isApplyingDraft ? (
              <div className="text-green-400 text-[10px]">Aplicando escenario…</div>
            ) : null}
          </div>
        );
      }
      default:
        return null;
    }
  })();

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
          value={selectedScenario}
          onChange={handleScenarioChange}
          disabled={scenarioOptions.length === 0}
          className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-2 py-1 rounded"
        >
          <option value="">
            {scenarioOptions.length === 0 ? 'loading…' : 'Elegir…'}
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

  const draftPanel = (
    <section className="w-full border-b border-zinc-800 bg-zinc-950 text-[11px] text-zinc-300">
      <button
        type="button"
        onClick={toggleDesignerPanel}
        aria-expanded={isDesignerOpen}
        aria-controls="new-scenario-panel"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900 text-zinc-300 hover:bg-zinc-900/70"
      >
        <span>Nuevo escenario</span>
        <span>{isDesignerOpen ? "[-]" : "[+]"}</span>
      </button>
      {isDesignerOpen ? (
        <div
          id="new-scenario-panel"
          className="px-3 py-3 space-y-4 border-t border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {wizardSteps.map((step) => {
              const isActive = activeWizardStep === step.id;
              const baseClasses =
                "px-3 py-1.5 rounded border uppercase tracking-wide transition-colors";
              const stateClasses = step.enabled
                ? isActive
                  ? "border-green-600 text-green-400 bg-zinc-900"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-900/60"
                : "border-zinc-800 text-zinc-600 cursor-not-allowed opacity-50";

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    if (step.enabled) {
                      setActiveWizardStep(step.id);
                    }
                  }}
                  disabled={!step.enabled}
                  className={`${baseClasses} ${stateClasses}`}
                >
                  [{step.id} {step.label}]
                </button>
              );
            })}
          </div>
          <div className="border border-zinc-800 rounded px-3 py-3 bg-zinc-950/60">
            {stepContent}
          </div>
        </div>
      ) : null}
    </section>
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

function parseScenarioProposal(value: unknown): ScenarioProposal | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const domains = Array.isArray(record.domains)
    ? record.domains.filter((domain): domain is string => typeof domain === "string")
    : [];
  const events = Array.isArray(record.events)
    ? record.events
        .filter(
          (event): event is Record<string, unknown> =>
            Boolean(event) && typeof event === "object",
        )
        .map((event, index) => {
          const eventRecord = event as Record<string, unknown>;
          const title =
            typeof eventRecord.title === "string"
              ? eventRecord.title
              : `Evento ${index + 1}`;
          const description =
            typeof eventRecord.description === "string"
              ? eventRecord.description
              : "";
          return { title, description };
        })
    : [];
  const sagaSummary =
    typeof record.sagaSummary === "string" ? record.sagaSummary : "";
  const openQuestions = Array.isArray(record.openQuestions)
    ? record.openQuestions.filter(
        (question): question is string => typeof question === "string",
      )
    : [];

  return { name, domains, events, sagaSummary, openQuestions };
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
