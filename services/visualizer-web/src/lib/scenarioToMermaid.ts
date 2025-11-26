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
  const domainEntries = Array.isArray(scenario.domains)
    ? scenario.domains.filter(isRecord)
    : [];

  const eventOwners = new Map<string, string>();
  const eventConsumers = new Map<string, string>();
  let startEventName: string | null = null;
  let startOwner: string | null = null;
  const eventConsumers = new Map<string, string>();

  domainEntries.forEach((domain) => {
    const domainId = typeof domain.id === "string" && domain.id.trim().length > 0
      ? domain.id.trim()
      : null;

    if (!domainId) {
      return;
    }

    const publishes = Array.isArray(domain.publishes)
      ? domain.publishes.filter(isRecord)
      : null;

    const events = publishes && publishes.length > 0
      ? publishes
      : Array.isArray(domain.events)
        ? domain.events.filter(isRecord)
        : [];

    events.forEach((event) => {
      if (typeof event.name === "string" && event.name.trim().length > 0) {
        eventOwners.set(event.name.trim(), domainId);
        if (event.start === true) {
          startEventName = event.name.trim();
          startOwner = domainId;
        }
      }
    });
  });

  const interactions: string[] = [];
  const notes: string[] = [];
  const seenInteractions = new Set<string>();

  domainEntries.forEach((domain) => {
    const listeners = Array.isArray(domain.listeners)
      ? domain.listeners.filter(isRecord)
      : [];

    listeners.forEach((listener) => {
      const triggeringEvent = isRecord(listener.on) && typeof listener.on.event === "string"
        ? listener.on.event.trim()
        : null;

      if (triggeringEvent) {
        eventConsumers.set(triggeringEvent, domain.id as string);
      }
    });
  });

  const startParticipant = startEventName && startOwner ? registerAnonymousParticipant(registry, "start_node") : null;
  const endParticipant = startEventName && startOwner ? registerAnonymousParticipant(registry, "end_node") : null;

  if (startParticipant && startOwner) {
    interactions.push(
      `${startParticipant.alias}-->>${registerParticipant(registry, startOwner, startOwner).alias}: ${formatEventLabel(startEventName)}`
    );
  }

  domainEntries.forEach((domain) => {
    const listeners = Array.isArray(domain.listeners)
      ? domain.listeners.filter(isRecord)
      : [];

    listeners.forEach((listener) => {
      const triggeringEvent = isRecord(listener.on) && typeof listener.on.event === "string"
        ? listener.on.event.trim()
        : null;

      if (!triggeringEvent) {
        notes.push("Listener sin evento desencadenante conocido.");
        return;
      }

      const declaredFromDomain = isRecord(listener.on) && typeof listener.on.fromDomain === "string"
        ? listener.on.fromDomain.trim()
        : null;

      const sourceDomain = declaredFromDomain || eventOwners.get(triggeringEvent) ?? null;

      if (!sourceDomain) {
        notes.push(`No se encontró el dominio para el evento "${triggeringEvent}".`);
        return;
      }

      if (sourceDomain !== domain.id) {
        const source = registerParticipant(registry, sourceDomain, sourceDomain);
        const consumer = registerParticipant(registry, domain.id, domain.id);
        const key = `${source.alias}->${consumer.alias}:${triggeringEvent}`;
        if (!seenInteractions.has(key)) {
          seenInteractions.add(key);
          interactions.push(`${source.alias}->>${consumer.alias}: ${formatEventLabel(triggeringEvent)}`);
        }
      }

      const actions = Array.isArray(listener.actions)
        ? listener.actions.filter(isRecord)
        : [];

      actions.forEach((action) => {
        const type = typeof action.type === "string" ? action.type : null;
        if (type !== "emit") {
          return;
        }

        const emittedEvent = typeof action.event === "string"
          ? action.event.trim()
          : null;

        if (!emittedEvent) {
          notes.push("Acción emit sin evento definido.");
          return;
        }

        const targetDomain = eventConsumers.get(emittedEvent) ?? null;

        if (!targetDomain) {
          if (endParticipant) {
            const consumer = registerParticipant(registry, domain.id as string, domain.id as string);
            const key = `${consumer.alias}->${endParticipant.alias}:${emittedEvent}`;
            if (!seenInteractions.has(key)) {
              seenInteractions.add(key);
              interactions.push(`${consumer.alias}-->>${endParticipant.alias}: ${formatEventLabel(emittedEvent)}`);
            }
          }
          return;
        }

        const source = registerParticipant(registry, sourceDomain, sourceDomain);
        const target = registerParticipant(registry, targetDomain, targetDomain);

        const key = `${source.alias}->${target.alias}:${emittedEvent}`;
        if (seenInteractions.has(key)) {
          return;
        }

        seenInteractions.add(key);
        interactions.push(`${source.alias}->>${target.alias}: ${formatEventLabel(emittedEvent)}`);
      });

      if (endParticipant && (!listener.actions || listener.actions.every((action) => action.type !== "emit"))) {
        const consumer = registerParticipant(registry, domain.id as string, domain.id as string);
        const key = `${consumer.alias}->${endParticipant.alias}:${triggeringEvent}`;
        if (!seenInteractions.has(key)) {
          seenInteractions.add(key);
          interactions.push(`${consumer.alias}-->>${endParticipant.alias}: ${formatEventLabel(triggeringEvent)}`);
        }
      }
    });
  });

  if (endParticipant) {
    eventOwners.forEach((ownerDomain, eventName) => {
      if (eventConsumers.has(eventName)) {
        return;
      }

      const owner = registerParticipant(registry, ownerDomain, ownerDomain);
      const key = `${owner.alias}->${endParticipant.alias}:${eventName}`;
      if (!seenInteractions.has(key)) {
        seenInteractions.add(key);
        interactions.push(`${owner.alias}-->>${endParticipant.alias}: ${formatEventLabel(eventName)}`);
      }
    });
  }

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
