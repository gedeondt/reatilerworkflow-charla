import React, { useCallback, useEffect, useMemo, useState } from "react";

import { applyScenario, validateScenario } from "../../api";
import { MermaidSequenceDiagram } from "../MermaidSequenceDiagram";

type WizardStep = 1 | 2 | 3 | 4;

type StepEditJsonProps = {
  designerJson: string;
  onDesignerJsonChange: (value: string) => void;
  designerSource?: { kind: "business" | "manual"; name?: string } | null;
  setWizardStep: (step: WizardStep) => void;
  setIsDesignerOpen: (open: boolean) => void;
};

type ValidationSummary = {
  domainsCount: number;
  eventsCount: number;
  listenersCount: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function buildMermaid(scenario: any): string {
  const lines: string[] = ["sequenceDiagram", "autonumber"];
  const domains = Array.isArray(scenario?.domains) ? scenario.domains : [];
  const eventToDomain = new Map<string, string>();

  domains.forEach((domain: any, index: number) => {
    if (!isRecord(domain)) {
      return;
    }

    const domainId = asString(domain.id) ?? `domain_${index + 1}`;
    lines.push(`participant ${domainId}`);

    const events = Array.isArray(domain.events) ? domain.events : [];
    events.forEach((event: any) => {
      if (isRecord(event)) {
        const eventName = asString(event.name);
        if (eventName) {
          eventToDomain.set(eventName, domainId);
        }
      }
    });
  });

  domains.forEach((domain: any, index: number) => {
    if (!isRecord(domain)) {
      return;
    }

    const domainId = asString(domain.id) ?? `domain_${index + 1}`;
    const listeners = Array.isArray(domain.listeners) ? domain.listeners : [];

    listeners.forEach((listener: any) => {
      if (!isRecord(listener)) {
        return;
      }

      const actions = Array.isArray(listener.actions) ? listener.actions : [];

      actions.forEach((action: any) => {
        if (!isRecord(action)) {
          return;
        }

        if (action.type === "emit") {
          const eventName = asString(action.event);
          if (!eventName) {
            return;
          }

          const targetDomain =
            eventToDomain.get(eventName) ?? asString(action.toDomain) ?? domainId;

          lines.push(`${domainId}->>${targetDomain}: ${eventName}`);
        } else if (action.type === "set-state") {
          const status = asString(action.status);
          const label = status ? `set-state ${status}` : "set-state";
          lines.push(`${domainId}-->>${domainId}: ${label}`);
        }
      });
    });
  });

  if (lines.length <= 2) {
    lines.push("Note over Escenario: Sin interacciones detectadas");
  }

  return lines.join("\n");
}

export function StepEditJson({
  designerJson,
  onDesignerJsonChange,
  designerSource,
  setWizardStep,
  setIsDesignerOpen,
}: StepEditJsonProps) {
  const [status, setStatus] = useState<"idle" | "validating" | "valid" | "invalid">(
    "idle",
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [validatedScenario, setValidatedScenario] = useState<any>(null);
  const [mermaidSrc, setMermaidSrc] = useState<string>("");
  const [summary, setSummary] = useState<ValidationSummary | null>(null);

  const validateNow = useCallback(async () => {
    try {
      setStatus("validating");
      const parsed = JSON.parse(designerJson);
      const result = await validateScenario(parsed);

      if (!result.ok) {
        setStatus("invalid");
        setErrors(Array.isArray(result.errors) ? result.errors : ["Validación desconocida"]);
        setMermaidSrc("");
        setValidatedScenario(null);
        setSummary(null);
        return;
      }

      setStatus("valid");
      setErrors([]);
      setValidatedScenario(result.scenario);
      setMermaidSrc(buildMermaid(result.scenario));
      setSummary(result.summary ?? null);
    } catch (error: any) {
      setStatus("invalid");
      const message =
        typeof error?.message === "string" && error.message.includes("JSON")
          ? "JSON inválido"
          : String(error?.message ?? error);
      setErrors([message]);
      setMermaidSrc("");
      setValidatedScenario(null);
      setSummary(null);
    }
  }, [designerJson]);

  useEffect(() => {
    if (!designerJson?.trim()) {
      setStatus("idle");
      setErrors([]);
      setMermaidSrc("");
      setValidatedScenario(null);
      setSummary(null);
      return;
    }

    const handle = setTimeout(() => {
      void validateNow();
    }, 400);

    return () => clearTimeout(handle);
  }, [designerJson, validateNow]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "valid":
        return "Válido ✓";
      case "invalid":
        return "Inválido";
      case "validating":
        return "Validando…";
      default:
        return "En espera";
    }
  }, [status]);

  const handleApplyScenario = useCallback(async () => {
    if (!validatedScenario) {
      return;
    }

    try {
      await applyScenario(validatedScenario);
      toast.success("Escenario aplicado correctamente.");
      setWizardStep(3);
      setIsDesignerOpen(false);
    } catch (error: any) {
      const message =
        typeof error?.message === "string"
          ? error.message
          : "No se pudo aplicar el escenario.";
      toast.error(message);
    }
  }, [validatedScenario, setWizardStep, setIsDesignerOpen]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="uppercase text-[10px] text-zinc-500">
          JSON del escenario
        </label>
        <textarea
          value={designerJson}
          onChange={(event) => onDesignerJsonChange(event.target.value)}
          placeholder="Pega o edita un escenario en formato JSON…"
          className="w-full min-h-[160px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
        />
        {designerSource && designerSource.kind === "business" ? (
          <p className="text-[10px] text-zinc-500">
            precargado desde {designerSource.kind}: {designerSource.name}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="text-zinc-400">Estado: {statusLabel}</span>
        {summary ? (
          <span className="text-zinc-500">
            Dominios: <span className="text-zinc-300">{summary.domainsCount}</span>, Eventos:
            <span className="text-zinc-300"> {summary.eventsCount}</span>, Listeners:
            <span className="text-zinc-300"> {summary.listenersCount}</span>
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void validateNow()}
          className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-200 text-xs hover:bg-zinc-900/60"
        >
          Validar ahora
        </button>
        <button
          type="button"
          onClick={() => void handleApplyScenario()}
          disabled={status !== "valid"}
          className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Aplicar escenario
        </button>
      </div>
      {errors.length > 0 ? (
        <div className="space-y-1">
          {errors.map((error, index) => (
            <div key={`designer-error-${index}`} className="text-[10px] text-red-400">
              {error}
            </div>
          ))}
        </div>
      ) : null}
      {mermaidSrc ? (
        <div className="space-y-2">
          <div className="uppercase text-[10px] text-zinc-500">Diagrama</div>
          <MermaidSequenceDiagram definition={mermaidSrc} />
        </div>
      ) : null}
    </div>
  );
}

export default StepEditJson;
