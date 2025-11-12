import React, { useMemo } from "react";

import { MermaidSequenceDiagram } from "./components/MermaidSequenceDiagram";
import { scenarioToMermaidSequence } from "./lib/scenarioToMermaid";

type NewScenarioDiagramProps = {
  scenarioJson: unknown;
};

export const NewScenarioDiagram: React.FC<NewScenarioDiagramProps> = ({
  scenarioJson,
}) => {
  const diagramDefinition = useMemo(() => {
    try {
      return scenarioToMermaidSequence(scenarioJson);
    } catch (error) {
      console.error("Failed to transform scenario into Mermaid definition", error);
      return [
        "sequenceDiagram",
        "participant Escenario as \"Escenario\"",
        "Note over Escenario: No se pudo construir un diagrama de secuencia para este escenario",
      ].join("\n");
    }
  }, [scenarioJson]);

  return (
    <div className="space-y-2">
      <MermaidSequenceDiagram code={diagramDefinition} />
    </div>
  );
};

export default NewScenarioDiagram;
