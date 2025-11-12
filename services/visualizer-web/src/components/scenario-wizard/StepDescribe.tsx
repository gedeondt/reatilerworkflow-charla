import React, { useState } from "react";

type StepDescribeProps = {
  descriptionText: string;
  onDescriptionChange: (value: string) => void;
  onContinue: () => void;
  onRefine?: (value: string) => Promise<string | null>;
};

export function StepDescribe({
  descriptionText,
  onDescriptionChange,
  onContinue,
  onRefine,
}: StepDescribeProps) {
  const [isRefining, setIsRefining] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRefine = async () => {
    if (!onRefine) {
      setSuggestion("Sin conexión con IA. Ajusta manualmente la descripción.");
      return;
    }

    setIsRefining(true);
    setError(null);

    try {
      const result = await onRefine(descriptionText);
      if (result) {
        setSuggestion(result);
      } else {
        setSuggestion(null);
      }
    } catch (err) {
      console.warn("Refine scenario description failed", err);
      setError("No se pudo obtener una sugerencia automática.");
    } finally {
      setIsRefining(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <label className="uppercase text-[10px] text-zinc-500">
          Descripción del escenario
        </label>
        <textarea
          value={descriptionText}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder="Describe el flujo de negocio que quieres modelar…"
          className="w-full min-h-[140px] font-mono text-[11px] bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-green-600"
        />
        <p className="text-[10px] text-zinc-500">
          Escribe en lenguaje natural los dominios, eventos y objetivos del escenario.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleRefine()}
            disabled={isRefining}
            className="px-3 py-1.5 rounded border border-zinc-600 text-zinc-200 text-xs hover:bg-zinc-900/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Refinar con IA
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60"
          >
            Continuar
          </button>
          {isRefining ? (
            <span className="text-[10px] text-green-400">Solicitando sugerencia…</span>
          ) : null}
        </div>
        {error ? <div className="text-[10px] text-red-400">{error}</div> : null}
      </div>
      <div className="space-y-2">
        <div className="uppercase text-[10px] text-zinc-500">Sugerencia</div>
        <div className="min-h-[140px] rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px] text-zinc-300 whitespace-pre-wrap">
          {suggestion ?? "Pulsa \"Refinar con IA\" para obtener una propuesta."}
        </div>
      </div>
    </div>
  );
}
