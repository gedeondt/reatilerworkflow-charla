import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Scenario } from "@reatiler/saga-kernel";

import { applyScenario, validateScenario } from "../../api";
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

export type ScenarioWizardState = {
  wizardStep: 1 | 2 | 3 | 4 | 5;
  isOpen: boolean;
  selectedScenario: string;
  designerSource: DesignerSource;
  descriptionText: string;
  designerJson: string;
  validation: ValidationState;
  mermaidCode: string;
  curlSnippet: string;
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
  isOpen: false,
  selectedScenario: "",
  designerSource: null,
  descriptionText: "",
  designerJson: "",
  validation: { ...initialValidation },
  mermaidCode: "",
  curlSnippet: "",
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

function createScenarioSkeleton(description: string): Scenario {
  const fallbackName = "manual-scenario";
  const normalizedName = description
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");

  const scenarioName = normalizedName.length > 3 ? normalizedName : fallbackName;

  return {
    name: scenarioName,
    version: 1,
    domains: [
      {
        id: "orchestrator",
        queue: "orchestrator",
        events: [
          {
            name: "InitialEvent",
            payloadSchema: {
              type: "object",
              properties: {
                exampleId: { type: "string" },
              },
              required: ["exampleId"],
            },
          },
        ],
        listeners: [],
      },
    ],
  };
}

export function ScenarioWizard({ state, setState, queueBase }: ScenarioWizardProps) {
  const [isApplying, setIsApplying] = useState(false);
  const debounceHandle = useRef<number | null>(null);
  const validationRequest = useRef(0);
  const stateRef = useRef(state);

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
        const result = await validateScenario(parsed);
        if (validationRequest.current !== requestId) {
          return;
        }

        if (result.ok) {
          const scenario = result.scenario as Scenario;
          updateState((prev) => {
            const nextStep =
              prev.designerSource && prev.designerSource.kind === "business" &&
              prev.wizardStep <= 3
                ? 4
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

  const handleToggleOpen = useCallback(() => {
    updateState((prev) => {
      if (prev.isOpen) {
        return { ...prev, isOpen: false, wizardStep: 1 };
      }

      const baseStep =
        prev.designerSource && prev.designerSource.kind === "business"
          ? (prev.wizardStep >= 3 ? prev.wizardStep : 3)
          : prev.wizardStep >= 2
            ? prev.wizardStep
            : 2;

      return {
        ...prev,
        isOpen: true,
        wizardStep: baseStep as 2 | 3 | 4 | 5,
      };
    });
  }, [updateState]);

  const handleStartFromScratch = useCallback(() => {
    updateState({
      isOpen: true,
      wizardStep: 2,
      designerSource: { kind: "manual" },
      selectedScenario: "",
      descriptionText: "",
      designerJson: "",
      validation: { ...initialValidation },
      mermaidCode: "",
      curlSnippet: "",
    });
  }, [updateState]);

  const handleDescriptionChange = useCallback(
    (value: string) => {
      updateState((prev) => ({ ...prev, descriptionText: value }));
    },
    [updateState],
  );

  const handleContinueFromDescription = useCallback(() => {
    updateState((prev) => ({
      ...prev,
      designerSource: { kind: "manual" },
      designerJson: JSON.stringify(
        createScenarioSkeleton(prev.descriptionText),
        null,
        2,
      ),
      validation: { ...initialValidation },
      mermaidCode: "",
      wizardStep: 3,
    }));
  }, [updateState]);

  const handleDesignerJsonChange = useCallback(
    (value: string) => {
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
    updateState((prev) => ({ ...prev, wizardStep: 4 }));
  }, [updateState]);

  const handleBack = useCallback(() => {
    updateState((prev) => {
      switch (prev.wizardStep) {
        case 5:
          return { ...prev, wizardStep: 4 };
        case 4:
          return { ...prev, wizardStep: 3 };
        case 3:
          if (prev.designerSource && prev.designerSource.kind === "manual") {
            return { ...prev, wizardStep: 2 };
          }
          return { ...prev, wizardStep: 1, isOpen: false };
        case 2:
          return { ...prev, wizardStep: 1, isOpen: false };
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
        wizardStep: 5,
        curlSnippet: buildCurl(scenario, queueBase),
      }));
    } catch (err) {
      console.warn("applyScenario failed", err);
      toast.error("No se pudo aplicar el escenario.");
    } finally {
      setIsApplying(false);
    }
  }, [queueBase, updateState]);

  const handleRefine = useCallback(async (value: string) => {
    if (!value.trim()) {
      return "Describe el escenario para obtener sugerencias.";
    }

    return `Idea inicial:\n${value.trim()}\n\nDefine dominios, eventos y listeners en el paso siguiente.`;
  }, []);

  const stepContent = useMemo(() => {
    switch (state.wizardStep) {
      case 2:
        return (
          <StepDescribe
            descriptionText={state.descriptionText}
            onDescriptionChange={handleDescriptionChange}
            onContinue={handleContinueFromDescription}
            onRefine={handleRefine}
          />
        );
      case 3:
        return (
          <StepJson
            designerJson={state.designerJson}
            onDesignerJsonChange={handleDesignerJsonChange}
            validation={state.validation}
            onValidateNow={handleValidateNow}
            onNext={handleNext}
            onBack={handleBack}
            designerSource={state.designerSource}
          />
        );
      case 4:
        return (
          <StepMermaid
            mermaidCode={state.mermaidCode}
            validationStatus={state.validation.status}
            onApply={handleApplyScenario}
            onBack={handleBack}
            isApplying={isApplying}
          />
        );
      case 5:
        return <StepCurl curlSnippet={state.curlSnippet} onBack={handleBack} />;
      default:
        return (
          <div className="text-[11px] text-zinc-500">
            Abre el wizard para diseñar un nuevo escenario.
          </div>
        );
    }
  }, [
    handleApplyScenario,
    handleBack,
    handleContinueFromDescription,
    handleDescriptionChange,
    handleDesignerJsonChange,
    handleNext,
    handleRefine,
    handleValidateNow,
    isApplying,
    state.curlSnippet,
    state.descriptionText,
    state.designerJson,
    state.designerSource,
    state.mermaidCode,
    state.validation,
    state.wizardStep,
  ]);

  return (
    <section className="w-full border-b border-zinc-800 bg-zinc-950 text-[11px] text-zinc-300">
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-expanded={state.isOpen}
        aria-controls="scenario-wizard-panel"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-zinc-900 text-zinc-300 hover:bg-zinc-900/70"
      >
        <span>Nuevo escenario</span>
        <span>{state.isOpen ? "[-]" : "[+]"}</span>
      </button>
      {state.isOpen ? (
        <div
          id="scenario-wizard-panel"
          className="px-3 py-3 space-y-4 border-t border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[
              { id: 1, label: "1 Colapsado" },
              { id: 2, label: "2 Descripción" },
              { id: 3, label: "3 JSON" },
              { id: 4, label: "4 Mermaid" },
              { id: 5, label: "5 CURL" },
            ].map((definition) => (
              <WizardStepIndicator
                key={definition.id}
                currentStep={state.wizardStep}
                definition={definition}
              />
            ))}
          </div>
          <div className="border border-zinc-800 rounded px-3 py-3 bg-zinc-950/60">
            {stepContent}
          </div>
        </div>
      ) : (
        <div className="px-3 py-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={handleStartFromScratch}
            className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60"
          >
            Crear desde cero
          </button>
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

  return <span className={`${baseClasses} ${stateClasses}`}>[{definition.label}]</span>;
}
