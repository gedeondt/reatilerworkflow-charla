const sanitizeAlias = (value: string) => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : `actor_${Math.random().toString(36).slice(2, 8)}`;
};

const escapeLabel = (value: string) => value.replace(/"/g, '\\"');

const escapeNote = (value: string) => value.replace(/"/g, "'");

const formatEventLabel = (value: string) => value.replace(/"/g, "'");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

type Participant = {
  key: string;
  alias: string;
  label: string;
};

type ParticipantRegistry = {
  map: Map<string, Participant>;
  order: Participant[];
  aliases: Set<string>;
};

const createRegistry = (): ParticipantRegistry => ({
  map: new Map(),
  order: [],
  aliases: new Set(),
});

const registerParticipant = (
  registry: ParticipantRegistry,
  key: string,
  label: string,
): Participant => {
  if (registry.map.has(key)) {
    return registry.map.get(key)!;
  }

  const baseAlias = sanitizeAlias(key);
  let alias = baseAlias;
  let counter = 2;

  while (registry.aliases.has(alias)) {
    alias = `${baseAlias}_${counter++}`;
  }

  const participant: Participant = { key, alias, label };
  registry.map.set(key, participant);
  registry.order.push(participant);
  registry.aliases.add(alias);

  return participant;
};

const registerAnonymousParticipant = (
  registry: ParticipantRegistry,
  label: string,
): Participant => {
  const key = `anon_${label}_${registry.order.length}`;
  const baseAlias = sanitizeAlias(label);
  let alias = baseAlias.length > 0 ? baseAlias : "actor";
  let counter = 2;

  while (registry.aliases.has(alias)) {
    alias = `${baseAlias || "actor"}_${counter++}`;
  }

  const participant: Participant = { key, alias, label };
  registry.map.set(key, participant);
  registry.order.push(participant);
  registry.aliases.add(alias);

  return participant;
};

/**
 * Heurística para deducir el dominio emisor de un listener.
 * Prioriza propiedades explícitas y cae hacia patrones comunes del DSL
 * cuando faltan datos directos.
 */
const inferSourceDomain = (listener: Record<string, unknown>): string | null => {
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

const extractParticipantsFromDomains = (
  scenario: Record<string, unknown>,
  registry: ParticipantRegistry,
) => {
  const domainEntries = Array.isArray(scenario.domains)
    ? scenario.domains.filter(isRecord)
    : [];

  domainEntries.forEach((domain, index) => {
    const rawId = typeof domain.id === "string" && domain.id.trim().length > 0
      ? domain.id.trim()
      : typeof domain.name === "string" && domain.name.trim().length > 0
        ? domain.name.trim()
        : `Dominio ${index + 1}`;

    const queue = typeof domain.queue === "string" && domain.queue.trim().length > 0
      ? domain.queue.trim()
      : null;

    const label = queue ? `${rawId} (${queue})` : rawId;
    registerParticipant(registry, rawId, label);
  });
};

type InteractionExtractionResult = {
  interactions: string[];
  notes: string[];
};

/**
 * Genera líneas Mermaid para interacciones emitidas en los listeners.
 * Si no se dispone de información completa, se registran notas para la vista.
 */
const extractInteractions = (
  scenario: Record<string, unknown>,
  registry: ParticipantRegistry,
): InteractionExtractionResult => {
  const listeners = Array.isArray(scenario.listeners)
    ? scenario.listeners.filter(isRecord)
    : [];

  const interactions: string[] = [];
  const notes: string[] = [];
  const seenInteractions = new Set<string>();

  listeners.forEach((listener) => {
    const baseEvent = isRecord(listener.on) && typeof listener.on.event === "string"
      ? listener.on.event.trim()
      : null;

    const actions = Array.isArray(listener.actions)
      ? listener.actions.filter(isRecord)
      : [];

    const sourceDomain = inferSourceDomain(listener);

    actions.forEach((action) => {
      const type = typeof action.type === "string" ? action.type : null;
      if (type !== "emit" && type !== "forward-event") {
        return;
      }

      const eventName = typeof action.event === "string"
        ? action.event.trim()
        : baseEvent;

      const targetDomain = typeof action.toDomain === "string" && action.toDomain.trim().length > 0
        ? action.toDomain.trim()
        : typeof action.domain === "string" && action.domain.trim().length > 0
          ? action.domain.trim()
          : null;

      if (!eventName) {
        notes.push("Evento emitido sin nombre conocido.");
        return;
      }

      if (!sourceDomain || !targetDomain) {
        const missing = !sourceDomain ? "origen" : "destino";
        notes.push(`No se pudo determinar el ${missing} para "${eventName}".`);
        return;
      }

      const source = registerParticipant(registry, sourceDomain, sourceDomain);
      const target = registerParticipant(registry, targetDomain, targetDomain);

      const key = `${source.alias}->${target.alias}:${eventName}`;
      if (seenInteractions.has(key)) {
        return;
      }

      seenInteractions.add(key);
      interactions.push(`${source.alias}->>${target.alias}: ${formatEventLabel(eventName)}`);
    });
  });

  return { interactions, notes };
};

export const scenarioToMermaidSequence = (scenarioJson: unknown): string => {
  const lines: string[] = ["sequenceDiagram"];

  const registry = createRegistry();

  if (!isRecord(scenarioJson)) {
    const fallback = registerAnonymousParticipant(registry, "Escenario");
    lines.push(`participant ${fallback.alias} as "${fallback.label}"`);
    lines.push(
      `Note over ${fallback.alias}: No se pudo construir un diagrama de secuencia para este escenario`,
    );
    return lines.join("\n");
  }

  const scenario = scenarioJson as Record<string, unknown>;
  extractParticipantsFromDomains(scenario, registry);
  const { interactions, notes } = extractInteractions(scenario, registry);

  if (registry.order.length === 0) {
    registerAnonymousParticipant(registry, "Escenario");
  }

  registry.order.forEach((participant) => {
    lines.push(`participant ${participant.alias} as "${escapeLabel(participant.label)}"`);
  });

  if (interactions.length > 0) {
    lines.push(...interactions);
  }

  const noteAlias = registry.order[0]?.alias ?? "Escenario";

  if (notes.length > 0) {
    const noteContent = notes.map(escapeNote).join("<br/>");
    lines.push(`Note over ${noteAlias}: ${noteContent}`);
  }

  if (interactions.length === 0 && notes.length === 0) {
    lines.push(
      `Note over ${noteAlias}: No se pudo construir un diagrama de secuencia para este escenario`,
    );
  }

  return lines.join("\n");
};

export default scenarioToMermaidSequence;
