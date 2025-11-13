import React, { useMemo } from "react";

import type { Scenario } from "@reatiler/saga-kernel";

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

type StepJsonProps = {
  designerJson: string;
  onDesignerJsonChange: (value: string) => void;
  validation: ValidationState;
  onValidateNow: () => void;
  onNext: () => void;
  onBack: () => void;
  designerSource: DesignerSource;
  onGenerateFromDraft?: () => void;
  canGenerateFromDraft?: boolean;
  isGeneratingFromDraft?: boolean;
  generationError?: string | null;
};

export function StepJson({
  designerJson,
  onDesignerJsonChange,
  validation,
  onValidateNow,
  onNext,
  onBack,
  designerSource,
  onGenerateFromDraft,
  canGenerateFromDraft = false,
  isGeneratingFromDraft = false,
  generationError,
}: StepJsonProps) {
  const statusLabel = useMemo(() => {
    switch (validation.status) {
      case "valid":
        return "Válido ✓";
      case "invalid":
        return "Inválido";
      case "validating":
        return "Validando…";
      default:
        return "En espera";
    }
  }, [validation.status]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="uppercase text-[10px] text-zinc-500">
          JSON del escenario
        </label>
        <textarea
          value={designerJson}
          onChange={(event) => onDesignerJsonChange(event.target.value)}
          placeholder="Pega o edita el escenario en formato JSON"
          className="w-full min-h-[220px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
        />
        {designerSource && designerSource.kind === "business" ? (
          <p className="text-[10px] text-zinc-500">
            Precargado desde catálogo: {designerSource.name}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="text-zinc-400">Estado: {statusLabel}</span>
        {validation.summary ? (
          <span className="text-zinc-500">
            Dominios: <span className="text-zinc-300">{validation.summary.domainsCount}</span>, Eventos:{" "}
            <span className="text-zinc-300">{validation.summary.eventsCount}</span>, Listeners:{" "}
            <span className="text-zinc-300">{validation.summary.listenersCount}</span>
          </span>
        ) : null}
      </div>
      {validation.errors.length > 0 ? (
        <div className="space-y-1">
          {validation.errors.map((error, index) => (
            <div key={`validation-error-${index}`} className="text-[10px] text-red-400">
              {error}
            </div>
          ))}
        </div>
      ) : null}
      {generationError ? (
        <div className="text-[10px] text-red-400">{generationError}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-200 text-xs hover:bg-zinc-900/60"
        >
          Atrás
        </button>
        {onGenerateFromDraft ? (
          <button
            type="button"
            onClick={onGenerateFromDraft}
            disabled={!canGenerateFromDraft || isGeneratingFromDraft}
            className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-200 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGeneratingFromDraft ? "Generando JSON…" : "Generar JSON con IA"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onValidateNow}
          className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-200 text-xs hover:bg-zinc-900/60"
        >
          Validar ahora
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={validation.status !== "valid"}
          className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}
