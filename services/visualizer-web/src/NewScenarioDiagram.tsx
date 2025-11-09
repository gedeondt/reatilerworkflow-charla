import React, { useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";

import type { CSSProperties } from "react";

type NewScenarioDiagramProps = {
  scenarioJson: unknown;
};

type GraphSuccess = {
  status: "success";
  nodes: Node[];
  edges: Edge[];
  warnings: string[];
};

type GraphFallback = {
  status: "fallback";
  message: string;
  scenarioName: string;
};

type GraphError = {
  status: "error";
  message: string;
};

type GraphResult = GraphSuccess | GraphFallback | GraphError;

const NODE_HORIZONTAL_SPACING = 220;
const NODE_VERTICAL_SPACING = 160;

const nodeStyle: CSSProperties = {
  background: "#09090b",
  color: "#e4e4e7",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  minWidth: 160,
  textAlign: "center",
  whiteSpace: "pre-wrap",
  boxShadow: "0 0 0 1px rgba(34,197,94,0.08)",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function sanitizeId(value: string): string {
  const trimmed = value.trim();
  const normalized = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || `n-${Math.random().toString(36).slice(2, 8)}`;
}

function buildGraph(input: unknown): GraphResult {
  if (!isRecord(input)) {
    return {
      status: "fallback",
      message: "No se encontró estructura suficiente para diagrama detallado.",
      scenarioName: "Escenario sin nombre",
    };
  }

  const scenario = input as Record<string, unknown>;
  const scenarioName = typeof scenario.name === "string" && scenario.name.trim().length > 0
    ? scenario.name.trim()
    : "Escenario sin nombre";

  const usedNodeIds = new Set<string>();
  const domainKeyToNodeId = new Map<string, string>();
  const nodeDefinitions: Array<{ id: string; label: string }> = [];

  const registerNode = (key: string | null, label: string) => {
    if (key && domainKeyToNodeId.has(key)) {
      return domainKeyToNodeId.get(key)!;
    }

    const baseId = sanitizeId(key ?? label);
    let finalId = baseId;
    let counter = 2;

    while (usedNodeIds.has(finalId)) {
      finalId = `${baseId}-${counter++}`;
    }

    usedNodeIds.add(finalId);
    nodeDefinitions.push({ id: finalId, label });

    if (key) {
      domainKeyToNodeId.set(key, finalId);
    }

    return finalId;
  };

  const ensureDomainNode = (domainKey: string | null, labelFallback: string) => {
    if (domainKey && domainKeyToNodeId.has(domainKey)) {
      return domainKeyToNodeId.get(domainKey)!;
    }

    const label = domainKey && domainKey.trim().length > 0 ? domainKey : labelFallback;
    return registerNode(domainKey ?? null, label);
  };

  const domainRecords = Array.isArray(scenario.domains)
    ? scenario.domains.filter(isRecord)
    : [];

  domainRecords.forEach((domain, index) => {
    const domainId = typeof domain.id === "string" && domain.id.trim().length > 0
      ? domain.id.trim()
      : typeof domain.name === "string" && domain.name.trim().length > 0
        ? domain.name.trim()
        : null;
    const queue = typeof domain.queue === "string" && domain.queue.trim().length > 0
      ? domain.queue.trim()
      : null;

    const labelParts = [domainId ?? `Dominio ${index + 1}`];

    if (queue) {
      labelParts.push(`cola: ${queue}`);
    }

    ensureDomainNode(domainId, labelParts.join("\n"));
  });

  const listeners = Array.isArray(scenario.listeners)
    ? scenario.listeners.filter(isRecord)
    : [];

  const warnings: string[] = [];
  const edges: Edge[] = [];
  const usedEdgeKeys = new Set<string>();

  const inferSourceDomain = (listener: Record<string, unknown>) => {
    if (typeof listener.domain === "string" && listener.domain.trim().length > 0) {
      return listener.domain.trim();
    }

    if (isRecord(listener.on) && typeof listener.on.domain === "string" && listener.on.domain.trim().length > 0) {
      return listener.on.domain.trim();
    }

    if (typeof listener.id === "string") {
      const match = listener.id.match(/^([^\s]+?)-on-/i);

      if (match && match[1]) {
        return match[1];
      }
    }

    const actions = Array.isArray(listener.actions)
      ? listener.actions.filter(isRecord)
      : [];

    for (const action of actions) {
      if (typeof action.domain === "string" && action.domain.trim().length > 0) {
        return action.domain.trim();
      }
    }

    return null;
  };

  listeners.forEach((listener, listenerIndex) => {
    const sourceDomainKey = inferSourceDomain(listener);
    const sourceNodeId = sourceDomainKey
      ? ensureDomainNode(sourceDomainKey, sourceDomainKey)
      : null;

    const baseEventName = isRecord(listener.on) && typeof listener.on.event === "string"
      ? listener.on.event
      : null;

    const actions = Array.isArray(listener.actions)
      ? listener.actions.filter(isRecord)
      : [];

    actions.forEach((action, actionIndex) => {
      const actionType = typeof action.type === "string" ? action.type : null;

      if (actionType !== "emit" && actionType !== "forward-event") {
        return;
      }

      const emittedEvent = typeof action.event === "string"
        ? action.event
        : baseEventName;

      const targetDomainKey = typeof action.toDomain === "string"
        ? action.toDomain
        : typeof action.domain === "string"
          ? action.domain
          : null;

      const targetNodeId = targetDomainKey
        ? ensureDomainNode(targetDomainKey, targetDomainKey)
        : null;

      if (!sourceNodeId || !targetNodeId) {
        const warningEvent = emittedEvent ?? baseEventName ?? "evento desconocido";
        warnings.push(
          `No se pudo determinar ${!sourceNodeId ? "el origen" : "el destino"} para el evento "${warningEvent}".`,
        );
        return;
      }

      const eventLabel = emittedEvent ?? baseEventName ?? "Evento";
      const edgeKey = `${sourceNodeId}->${targetNodeId}::${eventLabel}`;

      if (usedEdgeKeys.has(edgeKey)) {
        return;
      }

      usedEdgeKeys.add(edgeKey);

      edges.push({
        id: `edge-${edges.length}-${listenerIndex}-${actionIndex}`,
        source: sourceNodeId,
        target: targetNodeId,
        label: eventLabel,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#22c55e", strokeWidth: 1.4 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: "#22c55e" },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: "#111827",
          fillOpacity: 0.9,
          stroke: "#334155",
          strokeWidth: 0.5,
        },
        labelStyle: {
          fill: "#e0f2fe",
          fontSize: 11,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        },
      });
    });
  });

  if (nodeDefinitions.length === 0) {
    const eventRecords = Array.isArray(scenario.events)
      ? scenario.events.filter(isRecord)
      : [];

    if (eventRecords.length === 0) {
      return {
        status: "fallback",
        message: "No se encontró estructura suficiente para diagrama detallado.",
        scenarioName,
      };
    }

    eventRecords.forEach((eventRecord, index) => {
      const name = typeof eventRecord.name === "string" && eventRecord.name.trim().length > 0
        ? eventRecord.name.trim()
        : `Evento ${index + 1}`;

      registerNode(name, name);
    });

    for (let index = 0; index < nodeDefinitions.length - 1; index += 1) {
      const current = nodeDefinitions[index];
      const next = nodeDefinitions[index + 1];
      const edgeKey = `${current.id}->${next.id}`;

      if (usedEdgeKeys.has(edgeKey)) {
        continue;
      }

      usedEdgeKeys.add(edgeKey);

      edges.push({
        id: `edge-sequence-${index}`,
        source: current.id,
        target: next.id,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#38bdf8", strokeWidth: 1.2 },
        label: "flujo",
        labelStyle: {
          fill: "#bae6fd",
          fontSize: 10,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
        },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: "#0f172a",
          fillOpacity: 0.85,
          stroke: "#1e293b",
          strokeWidth: 0.5,
        },
      });
    }

    warnings.push("Diagrama generado a partir de eventos por falta de dominios definidos.");
  }

  if (nodeDefinitions.length === 0) {
    registerNode(null, scenarioName);
    warnings.push("No se encontró estructura suficiente para diagrama detallado.");
  }

  const columns = Math.min(Math.max(nodeDefinitions.length, 1), 4);

  const nodes = nodeDefinitions.map((definition, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      id: definition.id,
      data: { label: definition.label },
      position: {
        x: column * NODE_HORIZONTAL_SPACING,
        y: row * NODE_VERTICAL_SPACING,
      },
      draggable: false,
      selectable: false,
      style: nodeStyle,
    } satisfies Node;
  });

  return {
    status: "success",
    nodes,
    edges,
    warnings,
  };
}

class DiagramErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("React Flow rendering error", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="text-red-400 text-[11px]">
          Vista previa de flujo no disponible, pero puedes seguir aplicando el escenario.
        </div>
      );
    }

    return this.props.children;
  }
}

type DiagramCanvasProps = {
  nodes: Node[];
  edges: Edge[];
};

const DiagramCanvas: React.FC<DiagramCanvasProps> = ({ nodes, edges }) => {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      try {
        fitView({ padding: 0.28, includeHiddenNodes: true });
      } catch (error) {
        console.error("Failed to fit diagram view", error);
      }
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [edges, nodes, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      defaultViewport={{ x: -80, y: -60, zoom: 0.85 }}
      minZoom={0.3}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnScroll
      zoomOnPinch
      panOnDrag
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={16} size={1} color="#27272a" />
      <Controls position="bottom-right" className="!bg-zinc-900/80 !border-zinc-700 !text-zinc-100" />
    </ReactFlow>
  );
};

const NewScenarioDiagram: React.FC<NewScenarioDiagramProps> = ({ scenarioJson }) => {
  const graph = useMemo<GraphResult>(() => {
    try {
      return buildGraph(scenarioJson);
    } catch (error) {
      console.error("Failed to build scenario diagram", error);
      return {
        status: "error",
        message:
          "No se pudo generar el diagrama a partir del JSON. Revisa la definición o vuelve a generar el escenario.",
      };
    }
  }, [scenarioJson]);

  if (graph.status === "error") {
    return <div className="text-red-400 text-[11px]">{graph.message}</div>;
  }

  if (graph.status === "fallback") {
    return (
      <div className="space-y-2">
        <div className="text-zinc-400 text-[11px]">
          {graph.message}
        </div>
        <div className="border border-zinc-800 rounded px-3 py-3 bg-zinc-950 text-zinc-200 text-[12px] text-center">
          {graph.scenarioName}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <DiagramErrorBoundary>
        <ReactFlowProvider>
          <div className="h-80 w-full border border-zinc-800 rounded bg-zinc-950/80">
            <DiagramCanvas nodes={graph.nodes} edges={graph.edges} />
          </div>
        </ReactFlowProvider>
      </DiagramErrorBoundary>
      {graph.warnings.length > 0 ? (
        <div className="text-yellow-400 text-[10px] space-y-1">
          {graph.warnings.map((warning, index) => (
            <div key={`diagram-warning-${index}`}>⚠️ {warning}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default NewScenarioDiagram;
