import React from "react";

import { MermaidSequenceDiagram } from "../MermaidSequenceDiagram";

type StepMermaidProps = {
  mermaidCode: string;
  validationStatus: "idle" | "validating" | "valid" | "invalid";
  onApply: () => void;
  onBack: () => void;
  isApplying: boolean;
};

export function StepMermaid({
  mermaidCode,
  validationStatus,
  onApply,
  onBack,
  isApplying,
}: StepMermaidProps) {
  const isValid = validationStatus === "valid";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="uppercase text-[10px] text-zinc-500">
          Vista Mermaid
        </div>
        {mermaidCode ? (
          <div className="max-h-[420px] overflow-auto border border-zinc-800 rounded bg-zinc-950 p-2">
            <MermaidSequenceDiagram definition={mermaidCode} />
          </div>
        ) : (
          <div className="text-[10px] text-zinc-500">
            Valida el JSON para generar el diagrama de secuencia.
          </div>
        )}
      </div>
      {isValid ? null : (
        <div className="text-[11px] text-yellow-300">
          La validación debe ser correcta para aplicar el escenario.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-200 text-xs hover:bg-zinc-900/60"
        >
          Atrás
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!isValid || isApplying}
          className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isApplying ? "Aplicando…" : "Aplicar escenario"}
        </button>
      </div>
    </div>
  );
}
