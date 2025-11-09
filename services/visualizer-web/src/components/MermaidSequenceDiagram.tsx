import React, { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

const mermaidConfig = {
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict" as const,
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

let initialized = false;

const initializeMermaid = () => {
  if (!initialized) {
    mermaid.initialize(mermaidConfig);
    initialized = true;
  }
};

const generateId = () => `mermaid-${Math.random().toString(36).slice(2, 10)}`;

type MermaidSequenceDiagramProps = {
  definition: string;
};

export const MermaidSequenceDiagram: React.FC<MermaidSequenceDiagramProps> = ({
  definition,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderId = useMemo(() => generateId(), []);

  useEffect(() => {
    initializeMermaid();
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    let isMounted = true;
    container.innerHTML = "";
    setRenderError(null);

    const renderDiagram = async () => {
      try {
        const { svg } = await mermaid.render(renderId, definition);

        if (isMounted && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (error) {
        console.error("Failed to render Mermaid diagram", error);
        if (isMounted) {
          setRenderError(
            "No se pudo renderizar el diagrama de secuencia. Revisa el escenario generado.",
          );
        }
      }
    };

    void renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [definition, renderId]);

  return (
    <div className="space-y-2">
      <div className="h-80 w-full overflow-auto border border-zinc-800 rounded bg-zinc-950/80 p-2">
        {renderError ? (
          <div className="text-red-400 text-[11px]">{renderError}</div>
        ) : (
          <div ref={containerRef} className="min-h-full" />
        )}
      </div>
    </div>
  );
};

export default MermaidSequenceDiagram;
