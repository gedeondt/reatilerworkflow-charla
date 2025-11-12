import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Scenario } from "@reatiler/saga-kernel";

import { applyScenario, validateScenario } from "../../api";
import type {
  ApplyScenarioPayloadResponse,
  ScenarioSummary,
  ValidateScenarioResponse,
} from "../../types";
import { MermaidSequenceDiagram } from "../MermaidSequenceDiagram";

type ValidationStatus = "idle" | "validating" | "valid" | "invalid";

type StepEditJsonProps = {
  designerJson: string;
  setDesignerJson: (value: string) => void;
  onScenarioValidated?: (summary: ScenarioSummary | null) => void;
  onScenarioApplied?: (payload: {
    scenario: Scenario;
    summary: ScenarioSummary;
  }) => void;
};

export type StepEditJsonHandle = {
  triggerValidation: () => Promise<void>;
};

const ensureArray = <T,>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const buildMermaid = (scenario: Scenario): string => {
  const lines: string[] = ["sequenceDiagram", "autonumber", "%% generated from designer"];
  const participants = new Set<string>();

  for (const domain of ensureArray<Scenario["domains"][number]>(scenario.domains)) {
    if (domain && typeof domain.id === "string" && domain.id.length > 0) {
      participants.add(domain.id);
    }
  }

  for (const participant of participants) {
    lines.push(`participant ${participant}`);
  }

  const findEventDomain = (eventName: string): string | null => {
    for (const domain of ensureArray<Scenario["domains"][number]>(scenario.domains)) {
      const events = ensureArray(domain?.events);
      if (events.some((event) => event && event.name === eventName)) {
        return typeof domain?.id === "string" ? domain.id : null;
      }
    }
    return null;
  };

  for (const domain of ensureArray<Scenario["domains"][number]>(scenario.domains)) {
    if (!domain || typeof domain.id !== "string") {
      continue;
    }

    const domainId = domain.id;
    const listeners = ensureArray(domain.listeners);

    for (const listener of listeners) {
      const actions = ensureArray(listener?.actions);

      for (const action of actions) {
        if (!action || typeof action !== "object" || typeof action.type !== "string") {
          continue;
        }

        if (action.type === "emit") {
          const eventName = typeof action.event === "string" ? action.event : null;
          if (!eventName) {
            continue;
          }

          const explicitDomain =
            typeof action.toDomain === "string" && action.toDomain.length > 0
              ? action.toDomain
              : null;
          const targetDomain = findEventDomain(eventName) ?? explicitDomain ?? domainId;
          lines.push(`${domainId}->>${targetDomain}: ${eventName}`);
        } else if (action.type === "set-state") {
          const status =
            typeof action.status === "string" && action.status.length > 0
              ? ` ${action.status}`
              : "";
          lines.push(`${domainId}-->>${domainId}: set-state${status}`);
        }
      }
    }
  }

  return lines.join("\n");
};

export const StepEditJson = forwardRef<StepEditJsonHandle, StepEditJsonProps>(
  ({ designerJson, setDesignerJson, onScenarioApplied, onScenarioValidated }, ref) => {
    const [status, setStatus] = useState<ValidationStatus>("idle");
    const [errors, setErrors] = useState<string[]>([]);
    const [mermaidSrc, setMermaidSrc] = useState<string>("");
    const [validatedScenario, setValidatedScenario] = useState<Scenario | null>(null);
    const [summary, setSummary] = useState<ScenarioSummary | null>(null);
    const [isApplying, setIsApplying] = useState(false);
    const [applyError, setApplyError] = useState<string | null>(null);
    const [applyMessage, setApplyMessage] = useState<string | null>(null);

    const debounceTimer = useRef<NodeJS.Timeout | null>(null);
    const validationRequestId = useRef(0);

    const resetState = useCallback(() => {
      validationRequestId.current += 1;
      setStatus("idle");
      setErrors([]);
      setMermaidSrc("");
      setValidatedScenario(null);
      setSummary(null);
      onScenarioValidated?.(null);
    }, [onScenarioValidated]);

    const runValidation = useCallback(async (): Promise<void> => {
      const trimmed = designerJson.trim();

      if (trimmed.length === 0) {
        resetState();
        return;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(designerJson);
      } catch {
        validationRequestId.current += 1;
        setStatus("invalid");
        setErrors(["JSON inválido"]);
        setValidatedScenario(null);
        setMermaidSrc("");
        setSummary(null);
        onScenarioValidated?.(null);
        return;
      }

      const currentId = ++validationRequestId.current;
      setStatus("validating");
      setErrors([]);
      setApplyError(null);
      setApplyMessage(null);

      try {
        const result = (await validateScenario(parsed)) as ValidateScenarioResponse;

        if (validationRequestId.current !== currentId) {
          return;
        }

        if (!result.ok) {
          setStatus("invalid");
          setErrors(result.errors ?? ["El escenario no es válido"]);
          setValidatedScenario(null);
          setMermaidSrc("");
          setSummary(null);
          onScenarioValidated?.(null);
          return;
        }

        setStatus("valid");
        setErrors([]);
        setValidatedScenario(result.scenario);
        setSummary(result.summary);
        setMermaidSrc(buildMermaid(result.scenario));
        onScenarioValidated?.(result.summary);
      } catch (error) {
        if (validationRequestId.current !== currentId) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setStatus("invalid");
        setErrors([message]);
        setValidatedScenario(null);
        setMermaidSrc("");
        setSummary(null);
        onScenarioValidated?.(null);
      }
    }, [designerJson, onScenarioValidated, resetState]);

    useEffect(() => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      if (designerJson.trim().length === 0) {
        resetState();
        return;
      }

      debounceTimer.current = setTimeout(() => {
        void runValidation();
      }, 400);

      return () => {
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
        }
      };
    }, [designerJson, resetState, runValidation]);

    useImperativeHandle(
      ref,
      () => ({
        triggerValidation: async () => {
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
            debounceTimer.current = null;
          }

          await runValidation();
        },
      }),
      [runValidation],
    );

    const handleDesignerJsonChange = useCallback(
      (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDesignerJson(event.target.value);
      },
      [setDesignerJson],
    );

    const handleValidateNow = useCallback(() => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }

      void runValidation();
    }, [runValidation]);

    const handleApply = useCallback(async () => {
      if (status !== "valid" || !validatedScenario || !summary) {
        return;
      }

      setIsApplying(true);
      setApplyError(null);
      setApplyMessage(null);

      try {
        const result = (await applyScenario(validatedScenario)) as ApplyScenarioPayloadResponse;

        if (!result.ok) {
          const message = result.errors?.join("; ") || "No se pudo aplicar el escenario.";
          setApplyError(message);
          setIsApplying(false);
          return;
        }

        setApplyMessage("Escenario aplicado correctamente.");
        setIsApplying(false);
        onScenarioApplied?.({ scenario: validatedScenario, summary });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setApplyError(message);
        setIsApplying(false);
      }
    }, [onScenarioApplied, status, summary, validatedScenario]);

    const statusBadge = useMemo(() => {
      switch (status) {
        case "validating":
          return <span className="text-xs text-zinc-400">Validando…</span>;
        case "valid":
          return <span className="text-xs text-green-400">Válido ✓</span>;
        case "invalid":
          return <span className="text-xs text-red-400">Con errores</span>;
        default:
          return <span className="text-xs text-zinc-500">Pendiente</span>;
      }
    }, [status]);

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="uppercase text-[10px] text-zinc-500">
            Escenario en formato JSON
          </label>
          <textarea
            value={designerJson}
            onChange={handleDesignerJsonChange}
            className="w-full min-h-[200px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
            placeholder="Pega o edita un escenario en formato JSON…"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleValidateNow}
              className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60"
            >
              Validar ahora
            </button>
            {statusBadge}
          </div>
          {status === "invalid" && errors.length > 0 ? (
            <div className="border border-red-700 bg-red-950/40 text-red-300 rounded px-3 py-2 text-[11px] space-y-1">
              <div className="font-semibold text-[10px] uppercase tracking-wide">
                Errores de validación
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {errors.map((error, index) => (
                  <li key={`validation-error-${index}`}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {status === "valid" && summary ? (
            <div className="text-[10px] text-zinc-400">
              Dominios: <span className="text-zinc-200">{summary.domainsCount}</span>; Eventos: {" "}
              <span className="text-zinc-200">{summary.eventsCount}</span>; Listeners: {" "}
              <span className="text-zinc-200">{summary.listenersCount}</span>
            </div>
          ) : null}
        </div>

        {status === "valid" && mermaidSrc ? (
          <div className="space-y-2">
            <div className="uppercase text-[10px] text-zinc-500">Diagrama de secuencia</div>
            <MermaidSequenceDiagram code={mermaidSrc} />
          </div>
        ) : null}

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleApply}
            disabled={status !== "valid" || isApplying}
            className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Aplicar escenario
          </button>
          {isApplying ? (
            <div className="text-green-400 text-[10px]">Aplicando escenario…</div>
          ) : null}
          {applyError ? (
            <div className="text-red-400 text-[10px]">{applyError}</div>
          ) : null}
          {applyMessage ? (
            <div className="text-green-400 text-[10px]">{applyMessage}</div>
          ) : null}
        </div>
      </div>
    );
  },
);

StepEditJson.displayName = "StepEditJson";

export default StepEditJson;
