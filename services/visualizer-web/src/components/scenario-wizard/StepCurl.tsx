import React, { useState } from "react";

type StepCurlProps = {
  curlSnippet: string;
  onBack: () => void;
};

export function StepCurl({ curlSnippet, onBack }: StepCurlProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(curlSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn("Failed to copy curl snippet", err);
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="uppercase text-[10px] text-zinc-500">CURL de ejemplo</div>
        <div className="overflow-auto border border-zinc-800 rounded bg-zinc-950 p-3">
          <pre className="text-[11px] text-green-200 whitespace-pre-wrap break-all">
            {curlSnippet}
          </pre>
        </div>
      </div>
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
          onClick={() => void handleCopy()}
          className="px-3 py-1.5 rounded border border-green-600 text-green-400 text-xs hover:bg-zinc-900/60"
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
