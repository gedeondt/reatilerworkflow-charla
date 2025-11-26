import type { Scenario } from "@reatiler/saga-kernel";

const domainEvents = (domain: Scenario["domains"][number] | undefined) => {
  if (!domain) {
    return [] as NonNullable<Scenario["domains"][number]["publishes"]>;
  }

  if (Array.isArray(domain.publishes) && domain.publishes.length > 0) {
    return domain.publishes;
  }

  return domain.events ?? [];
};

type DomainEvent = ReturnType<typeof domainEvents>[number];
type Summary = {
  domainsCount: number;
  eventsCount: number;
  listenersCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeType(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string");
    return typeof first === "string" ? first : undefined;
  }

  return undefined;
}

function buildExampleFromSchema(schema: unknown): unknown {
  if (!isRecord(schema)) {
    return {};
  }

  const type = normalizeType(schema.type);

  switch (type) {
    case "string":
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        const firstEnum = schema.enum.find((entry) => typeof entry === "string");
        if (typeof firstEnum === "string") {
          return firstEnum;
        }
      }
      return "example";
    case "number":
    case "integer":
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        const firstEnum = schema.enum.find((entry) => typeof entry === "number");
        if (typeof firstEnum === "number") {
          return firstEnum;
        }
      }
      return 0;
    case "boolean":
      if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        const firstEnum = schema.enum.find((entry) => typeof entry === "boolean");
        if (typeof firstEnum === "boolean") {
          return firstEnum;
        }
      }
      return true;
    case "array": {
      const items = buildExampleFromSchema(schema.items ?? {});
      return [items];
    }
    case "object": {
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(properties)) {
        result[key] = buildExampleFromSchema(value);
      }
      return result;
    }
    default:
      return {};
  }
}

function findEventDomain(
  scenario: Scenario,
  eventName: string,
): { domainId: string; queue: string } | null {
  for (const domain of scenario.domains) {
    const domainEvents = getDomainEvents(domain);
    for (const event of domainEvents) {
      if (event.name === eventName) {
        return { domainId: domain.id, queue: domain.queue };
      }
    }
  }
  return null;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function buildMermaid(scenario: Scenario): string {
  const lines: string[] = ["sequenceDiagram", "autonumber"];
  const eventToDomain = new Map<string, string>();
  const eventToConsumer = new Map<string, { domainId: string; listener: NonNullable<Scenario["domains"][number]["listeners"]>[number] }>();
  const seen = new Set<string>();

  scenario.domains.forEach((domain) => {
    lines.push(`participant ${domain.id}`);

    domainEvents(domain).forEach((event) => {
      if (typeof event?.name === "string" && event.name.trim().length > 0) {
        eventToDomain.set(event.name, domain.id);
      }
    });

    domain.listeners?.forEach((listener) => {
      const triggeringEventName = listener.on?.event;
      if (typeof triggeringEventName === "string") {
        eventToConsumer.set(triggeringEventName, { domainId: domain.id, listener });
      }
    });
  });

  const startEventEntry = (() => {
    for (const domain of scenario.domains) {
      const start = domainEvents(domain).find((event) => event.start);
      if (start) {
        return { event: start, owner: domain.id };
      }
    }
    return null;
  })();

  if (!startEventEntry) {
    if (lines.length <= 2) {
      lines.push("Note over Escenario: Sin interacciones detectadas");
    }
    return lines.join("\n");
  }

  const startId = "start_node";
  const endId = "end_node";
  lines.push(`participant ${startId}`);
  lines.push(`participant ${endId}`);

  const visitedEvents = new Set<string>();
  let currentEventName = startEventEntry.event.name;
  let currentOwner = startEventEntry.owner;

  lines.push(`${startId}-->>${currentOwner}: ${currentEventName}`);

  while (currentEventName && !visitedEvents.has(currentEventName)) {
    visitedEvents.add(currentEventName);
    const consumer = eventToConsumer.get(currentEventName);

    if (!consumer) {
      const endKey = `${currentOwner}->${endId}:${currentEventName}`;
      if (!seen.has(endKey)) {
        seen.add(endKey);
        lines.push(`${currentOwner}-->>${endId}: ${currentEventName}`);
      }
      break;
    }

    const { domainId, listener } = consumer;

    if (domainId !== currentOwner) {
      const key = `${currentOwner}->${domainId}:${currentEventName}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`${currentOwner}->>${domainId}: ${currentEventName}`);
      }
    }

    let nextEvent: string | null = null;
    for (const action of listener.actions ?? []) {
      if (action.type === "emit") {
        const emittedEventName = action.event;
        if (typeof emittedEventName !== "string") {
          continue;
        }

        const consumer = eventToConsumer.get(emittedEventName);
        const targetDomain = consumer?.domainId ?? endId;

        const key = `${domainId}->${targetDomain}:${emittedEventName}`;
        if (!seen.has(key)) {
          seen.add(key);
          lines.push(`${domainId}->>${targetDomain}: ${emittedEventName}`);
        }

        if (!nextEvent) {
          nextEvent = emittedEventName;
        }
      }
    }

    if (!nextEvent) {
      const endKey = `${domainId}->${endId}:${currentEventName}`;
      if (!seen.has(endKey)) {
        seen.add(endKey);
        lines.push(`${domainId}-->>${endId}: ${currentEventName}`);
      }
      break;
    }

    currentEventName = nextEvent;
    currentOwner = eventToDomain.get(currentEventName) ?? domainId;
  }

  return lines.join("\n");
}

export function buildCurl(scenario: Scenario, queueBase: string): string {
  const definedEvents: Array<{
    domainId: string;
    queue: string;
    event: DomainEvent;
  }> = [];
  const emittedEvents = new Set<string>();
  let startEvent: { domainId: string; queue: string; event: DomainEvent } | null = null;

  scenario.domains.forEach((domain) => {
    domainEvents(domain).forEach((event) => {
      definedEvents.push({ domainId: domain.id, queue: domain.queue, event });
      if (event.start) {
        startEvent = { domainId: domain.id, queue: domain.queue, event };
      }
    });

    const listeners = domain.listeners ?? [];
    listeners.forEach((listener) => {
      const actions = listener.actions ?? [];
      actions.forEach((action) => {
        if (action.type === "emit" && action.event) {
          emittedEvents.add(action.event);
        }
      });
    });
  });

  if (definedEvents.length === 0) {
    return "# No se encontraron eventos para generar el ejemplo de CURL";
  }

  const primaryEvent =
    startEvent ??
    definedEvents.find((entry) => !emittedEvents.has(entry.event.name)) ??
    definedEvents[0];

  const queueInfo =
    findEventDomain(scenario, primaryEvent.event.name) ??
    ({ domainId: primaryEvent.domainId, queue: primaryEvent.queue } as const);

  const exampleData = buildExampleFromSchema(primaryEvent.event.payloadSchema);

  const payload = {
    eventName: primaryEvent.event.name,
    version: 1,
    eventId: "evt-1",
    traceId: "trace-1",
    correlationId: "saga-1",
    occurredAt: new Date().toISOString(),
    data: exampleData,
  };

  const sanitizedBase = normalizeBaseUrl(queueBase);
  const url = `${sanitizedBase}/queues/${queueInfo.queue}/messages`;
  const jsonPayload = JSON.stringify(payload, null, 2);

  return [
    `curl -X POST ${url} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${jsonPayload}'`,
  ].join("\n");
}

export function buildSummary(scenario: Scenario): Summary {
  const domainsCount = scenario.domains.length;
  let eventsCount = 0;
  let listenersCount = 0;

  scenario.domains.forEach((domain) => {
    eventsCount += domainEvents(domain).length;
    listenersCount += domain.listeners?.length ?? 0;
  });

  return { domainsCount, eventsCount, listenersCount };
}
