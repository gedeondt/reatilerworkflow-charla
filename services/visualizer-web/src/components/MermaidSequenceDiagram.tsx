import React, { useEffect, useState } from "react";
import mermaid from "mermaid";

let _mermaidInited = false;

function ensureMermaid() {
  if (!_mermaidInited) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "dark",
      themeVariables: {
        primaryColor: "#111827",
        primaryBorderColor: "#22c55e",
        primaryTextColor: "#e2e8f0",
        lineColor: "#22c55e",
        actorTextColor: "#cbd5f5",
        noteBkgColor: "#1f2937",
        noteTextColor: "#f9fafb",
      },
    });
    _mermaidInited = true;
  }
}

type MermaidSequenceDiagramProps = {
  definition: string;
};

export const MermaidSequenceDiagram: React.FC<MermaidSequenceDiagramProps> = ({
  definition,
}) => {
  const [html, setHtml] = useState<string>("");
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    setRenderError(null);
    setHtml("");

    if (!definition?.trim()) {
      return;
    }

    try {
      ensureMermaid();
      const id = `mmd-${Date.now()}`;

      mermaid
        .render(id, definition)
        .then(({ svg }) => {
          setHtml(svg);
        })
        .catch((error) => {
          setRenderError(
            "No se pudo renderizar el diagrama de secuencia. Revisa el escenario generado.",
          );
          console.error("Failed to render Mermaid diagram", error);
        });
    } catch (e) {
      setRenderError(String(e));
    }
  }, [definition]);

  return (
    <div className="space-y-2">
      <div className="w-full overflow-auto border border-zinc-800 rounded bg-zinc-950/80 p-2 min-h-[20rem]">
        {renderError ? (
          <div className="text-red-400 text-[11px]">{renderError}</div>
        ) : (
          <div
            className="min-h-full"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
};

export default MermaidSequenceDiagram;
