import React, { useEffect, useMemo, useState } from "react";
import type MermaidAPI from "mermaid";

const mermaidConfig = {
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose" as const,
  themeVariables: {
    primaryColor: "#111827",
    primaryBorderColor: "#22c55e",
    primaryTextColor: "#e2e8f0",
    lineColor: "#22c55e",
    actorTextColor: "#cbd5f5",
    noteBkgColor: "#1f2937",
    noteTextColor: "#f9fafb",
  },
};

let mermaidPromise: Promise<MermaidAPI> | null = null;
let initialized = false;

const loadMermaid = async (): Promise<MermaidAPI> => {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((module) => module.default ?? (module as unknown as MermaidAPI))
      .catch((error) => {
        mermaidPromise = null;
        throw error;
      });
  }

  const api = await mermaidPromise;

  if (!initialized) {
    api.initialize(mermaidConfig);
    initialized = true;
  }

  return api;
};

const generateId = () => `mermaid-${Math.random().toString(36).slice(2, 10)}`;

type MermaidSequenceDiagramProps = {
  code: string;
};

export const MermaidSequenceDiagram: React.FC<MermaidSequenceDiagramProps> = ({
  code,
}) => {
  const [renderError, setRenderError] = useState<string | null>(null);
  const [html, setHtml] = useState<string>("");
  const renderId = useMemo(() => generateId(), []);

  useEffect(() => {
    let cancelled = false;
    setRenderError(null);
    setHtml("");

    const renderDiagram = async () => {
      try {
        const api = await loadMermaid();
        const { svg } = await api.render(renderId, code);

        if (!cancelled) {
          setHtml(svg);
        }
      } catch (error) {
        console.error("Failed to render Mermaid diagram", error);
        if (!cancelled) {
          setRenderError("No se pudo renderizar diagrama.");
        }
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [code, renderId]);

  return (
    <div className="space-y-2">
      <div className="h-80 w-full overflow-auto border border-zinc-800 rounded bg-zinc-950/80 p-2">
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
