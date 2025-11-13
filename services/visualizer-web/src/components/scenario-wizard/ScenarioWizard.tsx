import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Scenario } from "@reatiler/saga-kernel";

import type { DraftSummary } from "../../types";
import {
  applyScenario,
  createScenarioDraft,
  fetchDraftSummary,
  fetchScenarioDraftJsonPrompt,
  generateDraftJson,
  refineScenarioDraft,
  validateScenario,
} from "../../api";
import { buildCurl, buildMermaid } from "../../lib/scenarioFormatting";
import { StepCurl } from "./StepCurl";
import { StepDescribe } from "./StepDescribe";
import { StepJson } from "./StepJson";
import { StepMermaid } from "./StepMermaid";

type ValidationState = {
  status: "idle" | "validating" | "valid" | "invalid";
  errors: string[];
  scenario?: Scenario;
  summary?: { domainsCount: number; eventsCount: number; listenersCount: number };
};

type DesignerSource =
  | null
  | { kind: "business"; name: string }
  | { kind: "manual" };

type WizardStep = 1 | 2 | 3 | 4;

export type ScenarioWizardState = {
  wizardStep: WizardStep;
  isCollapsed: boolean;
  selectedScenario: string;
  designerSource: DesignerSource;
  descriptionText: string;
  designerJson: string;
  validation: ValidationState;
  mermaidCode: string;
  curlSnippet: string;
  draftId: string | null;
  draftSummary: DraftSummary | null;
  jsonPrompt: string;
  jsonPromptError: string | null;
  isFetchingJsonPrompt: boolean;
};

type ScenarioWizardProps = {
  state: ScenarioWizardState;
  setState: React.Dispatch<React.SetStateAction<ScenarioWizardState>>;
  queueBase: string;
};

const initialValidation: ValidationState = {
  status: "idle",
  errors: [],
};

export const defaultScenarioWizardState: ScenarioWizardState = {
  wizardStep: 1,
  isCollapsed: true,
  selectedScenario: "",
  designerSource: null,
  descriptionText: "",
  designerJson: "",
  validation: { ...initialValidation },
  mermaidCode: "",
  curlSnippet: "",
  draftId: null,
  draftSummary: null,
  jsonPrompt: "",
  jsonPromptError: null,
  isFetchingJsonPrompt: false,
};

const toast = {
  success(message: string) {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message);
    } else {
      console.log(`SUCCESS: ${message}`);
    }
  },
  error(message: string) {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message);
    } else {
      console.error(`ERROR: ${message}`);
    }
  },
};

export function ScenarioWizard({ state, setState, queueBase }: ScenarioWizardProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [isGeneratingJson, setIsGeneratingJson] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const debounceHandle = useRef<number | null>(null);
  const validationRequest = useRef(0);
  const stateRef = useRef(state);
  const isSyncingBusinessDraft = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const updateState = useCallback(
    (
      updater:
        | ScenarioWizardState
        | ((prev: ScenarioWizardState) => ScenarioWizardState),
    ) => {
      setState((prev) =>
        typeof updater === "function" ? updater(prev) : { ...prev, ...updater },
      );
    },
    [setState],
  );

  const resetValidation = useCallback(() => {
    updateState((prev) => ({
      ...prev,
      validation: { ...initialValidation },
      mermaidCode: "",
    }));
  }, [updateState]);

  const runValidation = useCallback(
    async (json: string) => {
      const trimmed = json.trim();

      if (!trimmed) {
        resetValidation();
        return;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(trimmed);
      } catch (err: any) {
        updateState((prev) => ({
          ...prev,
          validation: {
            status: "invalid",
            errors: ["JSON inválido"],
          },
          mermaidCode: "",
        }));
        return;
      }

      const requestId = Date.now();
      validationRequest.current = requestId;

      updateState((prev) => ({
        ...prev,
        validation: {
          ...prev.validation,
          status: "validating",
          errors: [],
        },
      }));

      try {
        console.log("EHOOOO",parsed);
        const result = await validateScenario(parsed);
        if (validationRequest.current !== requestId) {
          return;
        }

        if (result.ok) {
          const scenario = result.scenario as Scenario;
          updateState((prev) => {
            const nextStep =
              prev.designerSource && prev.designerSource.kind === "business" &&
              prev.wizardStep <= 2
                ? 3
                : prev.wizardStep;

            return {
              ...prev,
              wizardStep: nextStep,
              validation: {
                status: "valid",
                errors: [],
                scenario,
                summary: result.summary ?? prev.validation.summary,
              },
              mermaidCode: buildMermaid(scenario),
            };
          });
        } else {
          const errors = Array.isArray(result.errors)
            ? (result.errors as string[])
            : ["Validación desconocida"];

          updateState((prev) => ({
            ...prev,
            validation: {
              status: "invalid",
              errors,
            },
            mermaidCode: "",
          }));
        }
      } catch (err) {
        console.warn("validateScenario failed", err);
        updateState((prev) => ({
          ...prev,
          validation: {
            status: "invalid",
            errors: ["No se pudo validar el escenario"],
          },
          mermaidCode: "",
        }));
      }
    },
    [resetValidation, updateState],
  );

  useEffect(() => {
    if (debounceHandle.current) {
      clearTimeout(debounceHandle.current);
    }

    const json = state.designerJson;

    if (!json.trim()) {
      resetValidation();
      return () => {};
    }

    debounceHandle.current = window.setTimeout(() => {
      void runValidation(json);
    }, 400);

    return () => {
      if (debounceHandle.current) {
        clearTimeout(debounceHandle.current);
        debounceHandle.current = null;
      }
    };
  }, [state.designerJson, runValidation, resetValidation]);

  useEffect(() => {
    setJsonError(null);
  }, [state.designerSource]);

  useEffect(() => {
    if (
      state.designerSource?.kind !== "business" ||
      state.draftId ||
      !state.designerJson.trim() ||
      isSyncingBusinessDraft.current
    ) {
      return;
    }

    let cancelled = false;
    isSyncingBusinessDraft.current = true;
    const description = state.designerSource.name
      ? `Escenario existente importado: ${state.designerSource.name}`
      : "Escenario existente importado desde catálogo";
    const jsonSnapshot = state.designerJson;

    const syncDraft = async () => {
      try {
        const draft = await createScenarioDraft(description);
        if (cancelled) {
          return;
        }

        updateState((prev) => ({
          ...prev,
          draftId: draft.id,
          draftSummary: null,
        }));

        if (jsonSnapshot.trim()) {
          try {
            await refineScenarioDraft(
              draft.id,
              `Utiliza este JSON como referencia inicial:\n${jsonSnapshot}`,
            );
          } catch (err) {
            console.warn("refineScenarioDraft failed", err);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setJsonError(`No se pudo preparar el borrador: ${message}`);
        }
      } finally {
        isSyncingBusinessDraft.current = false;
      }
    };

    void syncDraft();

    return () => {
      cancelled = true;
    };
  }, [
    state.designerJson,
    state.designerSource,
    state.draftId,
    updateState,
  ]);

  const handleToggleCollapsed = useCallback(() => {
    updateState((prev) => {
      if (prev.isCollapsed) {
        const baseStep =
          prev.designerSource && prev.designerSource.kind === "business"
            ? (prev.wizardStep === 1 ? 2 : prev.wizardStep)
            : prev.wizardStep;

        return {
          ...prev,
          isCollapsed: false,
          wizardStep: baseStep as WizardStep,
        };
      }

      return { ...prev, isCollapsed: true };
    });
  }, [updateState]);

  const handleCollapsePanel = useCallback(() => {
    updateState((prev) => ({ ...prev, isCollapsed: true }));
  }, [updateState]);

  const handleStartFromScratch = useCallback(() => {
    setIdeaError(null);
    setJsonError(null);
    updateState({
      isCollapsed: false,
      wizardStep: 1,
      designerSource: { kind: "manual" },
      selectedScenario: "",
      descriptionText: "",
      designerJson: "",
      validation: { ...initialValidation },
      mermaidCode: "",
      curlSnippet: "",
      draftId: null,
      draftSummary: null,
      jsonPrompt: "",
      jsonPromptError: null,
      isFetchingJsonPrompt: false,
    });
  }, [updateState]);

  const handleDescriptionChange = useCallback(
    (value: string) => {
      setIdeaError(null);
      updateState((prev) => ({ ...prev, descriptionText: value }));
    },
    [updateState],
  );

  const handleGenerateIdea = useCallback(async () => {
    const description = stateRef.current.descriptionText.trim();

    if (!description) {
      setIdeaError("Describe el escenario antes de generar la idea.");
      return;
    }

    setIsGeneratingIdea(true);
    setIdeaError(null);

    try {
      let draftId = stateRef.current.draftId;
      if (!draftId) {
        const created = await createScenarioDraft(description);
        draftId = created.id;
      } else {
        await refineScenarioDraft(draftId, description);
      }

      const summary = await fetchDraftSummary(draftId);

      updateState((prev) => ({
        ...prev,
        draftId,
        draftSummary: summary,
        designerSource: { kind: "manual" },
        jsonPrompt: "",
        jsonPromptError: null,
        isFetchingJsonPrompt: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIdeaError(`No se ha podido generar la propuesta de escenario: ${message}`);
    } finally {
      setIsGeneratingIdea(false);
    }
  }, [updateState]);

  const handleContinueFromDescription = useCallback(() => {
    updateState((prev) => ({
      ...prev,
      designerSource: { kind: "manual" },
      designerJson: "",
      validation: { ...initialValidation },
      mermaidCode: "",
      curlSnippet: "",
      jsonPrompt: "",
      jsonPromptError: null,
      isFetchingJsonPrompt: false,
      wizardStep: 2,
    }));
  }, [updateState]);

  const handleDesignerJsonChange = useCallback(
    (value: string) => {
      setJsonError(null);
      updateState((prev) => ({
        ...prev,
        designerJson: value,
        validation: { ...initialValidation },
        mermaidCode: "",
      }));
    },
    [updateState],
  );

  const handleValidateNow = useCallback(() => {
    if (debounceHandle.current) {
      clearTimeout(debounceHandle.current);
      debounceHandle.current = null;
    }

    void runValidation(stateRef.current.designerJson);
  }, [runValidation]);

  const handleNext = useCallback(() => {
    updateState((prev) => ({ ...prev, wizardStep: 3 }));
  }, [updateState]);

  const handleBack = useCallback(() => {
    updateState((prev) => {
      switch (prev.wizardStep) {
        case 4:
          return { ...prev, wizardStep: 3 };
        case 3:
          return { ...prev, wizardStep: 2 };
        case 2:
          if (prev.designerSource && prev.designerSource.kind === "manual") {
            return { ...prev, wizardStep: 1 };
          }
          return { ...prev, isCollapsed: true };
        case 1:
          return { ...prev, isCollapsed: true };
        default:
          return prev;
      }
    });
  }, [updateState]);

  const handleApplyScenario = useCallback(async () => {
    const scenario = stateRef.current.validation.scenario;

    if (!scenario) {
      return;
    }

    setIsApplying(true);

    try {
      await applyScenario(scenario);
      toast.success("Escenario aplicado correctamente.");
      updateState((prev) => ({
        ...prev,
        wizardStep: 4,
        curlSnippet: buildCurl(scenario, queueBase),
      }));
    } catch (err) {
      console.warn("applyScenario failed", err);
      toast.error("No se pudo aplicar el escenario.");
    } finally {
      setIsApplying(false);
    }
  }, [queueBase, updateState]);

  const handleGenerateJson = useCallback(async () => {
    const draftId = stateRef.current.draftId;

    if (!draftId) {
      setJsonError("No hay un borrador activo para generar el JSON.");
      return;
    }

    setIsGeneratingJson(true);
    setJsonError(null);

    try {
      const { generatedScenario, scenario } = await generateDraftJson(draftId);
      const scenarioPayload = generatedScenario?.content ?? generatedScenario ?? scenario;

      if (!scenarioPayload) {
        throw new Error("Respuesta sin escenario generado");
      }

      const json = JSON.stringify(scenarioPayload, null, 2);
      updateState((prev) => ({
        ...prev,
        designerJson: json,
        validation: { ...initialValidation },
        mermaidCode: "",
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJsonError(`No se pudo generar el JSON: ${message}`);
    } finally {
      setIsGeneratingJson(false);
    }
  }, [updateState]);

  const handleFetchJsonPrompt = useCallback(async () => {
    const draftId = stateRef.current.draftId;

    if (!draftId) {
      updateState((prev) => ({
        ...prev,
        jsonPromptError: "No hay un borrador activo para generar el prompt.",
      }));
      return;
    }

    updateState((prev) => ({
      ...prev,
      isFetchingJsonPrompt: true,
      jsonPromptError: null,
    }));

    try {
      const payload = await fetchScenarioDraftJsonPrompt(draftId);
      updateState((prev) => ({
        ...prev,
        jsonPrompt: payload.prompt ?? "",
        isFetchingJsonPrompt: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateState((prev) => ({
        ...prev,
        jsonPrompt: "",
        jsonPromptError: `No se pudo generar el prompt: ${message}`,
        isFetchingJsonPrompt: false,
      }));
    }
  }, [updateState]);

  const canContinueFromDescription = Boolean(state.draftId && state.draftSummary);

  const stepContent = useMemo(() => {
    switch (state.wizardStep) {
      case 1:
        return (
          <StepDescribe
            descriptionText={state.descriptionText}
            onDescriptionChange={handleDescriptionChange}
            onGenerate={handleGenerateIdea}
            onContinue={handleContinueFromDescription}
            isGenerating={isGeneratingIdea}
            summary={state.draftSummary}
            error={ideaError}
            canContinue={canContinueFromDescription}
          />
        );
      case 2:
        return (
          <StepJson
            designerJson={state.designerJson}
            onDesignerJsonChange={handleDesignerJsonChange}
            validation={state.validation}
            onValidateNow={handleValidateNow}
            onNext={handleNext}
            onBack={handleBack}
            designerSource={state.designerSource}
            onGenerateFromDraft={handleGenerateJson}
            canGenerateFromDraft={Boolean(state.draftId)}
            isGeneratingFromDraft={isGeneratingJson}
            generationError={jsonError}
            onGeneratePrompt={handleFetchJsonPrompt}
            canGeneratePrompt={Boolean(state.draftId)}
            isGeneratingPrompt={state.isFetchingJsonPrompt}
            promptText={state.jsonPrompt}
            promptError={state.jsonPromptError}
          />
        );
      case 3:
        return (
          <StepMermaid
            mermaidCode={state.mermaidCode}
            validationStatus={state.validation.status}
            onApply={handleApplyScenario}
            onBack={handleBack}
            isApplying={isApplying}
          />
        );
      case 4:
        return <StepCurl curlSnippet={state.curlSnippet} onBack={handleBack} />;
      default:
        return (
          <div className="text-[11px] text-zinc-500">
            Abre el wizard para diseñar un nuevo escenario.
          </div>
        );
    }
  }, [
    canContinueFromDescription,
    handleApplyScenario,
    handleBack,
    handleContinueFromDescription,
    handleDescriptionChange,
    handleDesignerJsonChange,
    handleGenerateIdea,
    handleGenerateJson,
    handleFetchJsonPrompt,
    handleNext,
    handleValidateNow,
    ideaError,
    isApplying,
    isGeneratingIdea,
    isGeneratingJson,
    jsonError,
    state.curlSnippet,
    state.descriptionText,
    state.designerJson,
    state.designerSource,
    state.draftId,
    state.draftSummary,
    state.isFetchingJsonPrompt,
    state.jsonPrompt,
    state.jsonPromptError,
    state.mermaidCode,
    state.validation,
    state.wizardStep,
  ]);

  return (
    <section className="w-full border-b border-zinc-800 bg-zinc-950 text-[11px] text-zinc-300">
      <div className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900 text-zinc-300">
        <span>Nuevo escenario</span>
        <button
          type="button"
          onClick={handleToggleCollapsed}
          aria-expanded={!state.isCollapsed}
          aria-controls="scenario-wizard-panel"
          className="px-2 py-1 border border-zinc-700 rounded text-xs hover:bg-zinc-800"
        >
          {state.isCollapsed ? "Expandir" : "Colapsar"}
        </button>
      </div>
      {state.isCollapsed ? null : (
        <div
          id="scenario-wizard-panel"
          className="px-3 py-3 space-y-4 border-t border-zinc-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 1, label: "Descripción" },
                { id: 2, label: "JSON" },
                { id: 3, label: "Mermaid" },
                { id: 4, label: "CURL" },
              ].map((definition) => (
                <WizardStepIndicator
                  key={definition.id}
                  currentStep={state.wizardStep}
                  definition={definition}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCollapsePanel}
                className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900"
              >
                Colapsar panel
              </button>
              <button
                type="button"
                onClick={handleStartFromScratch}
                className="px-2 py-1 rounded border border-green-600 text-green-400 hover:bg-zinc-900"
              >
                Nuevo borrador
              </button>
            </div>
          </div>
          <div className="border border-zinc-800 rounded px-3 py-3 bg-zinc-950/60">
            {stepContent}
          </div>
        </div>
      )}
    </section>
  );
}

type WizardStepIndicatorProps = {
  currentStep: number;
  definition: { id: number; label: string };
};

function WizardStepIndicator({
  currentStep,
  definition,
}: WizardStepIndicatorProps) {
  const isActive = currentStep === definition.id;
  const baseClasses =
    "px-3 py-1.5 rounded border uppercase tracking-wide transition-colors";
  const stateClasses = isActive
    ? "border-green-600 text-green-400 bg-zinc-900"
    : "border-zinc-700 text-zinc-400";

  return (
    <span className={`${baseClasses} ${stateClasses}`}>
      [{definition.id} {definition.label}]
    </span>
  );
}
