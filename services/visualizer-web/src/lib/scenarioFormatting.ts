import type { Scenario } from "@reatiler/saga-kernel";

type DomainEvent = NonNullable<Scenario["domains"][number]["events"]>[number];
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
    const domainEvents = domain.events ?? [];
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

  scenario.domains.forEach((domain) => {
    lines.push(`participant ${domain.id}`);

    const domainEvents = domain.events ?? [];
    domainEvents.forEach((event) => {
      if (typeof event?.name === "string" && event.name.trim().length > 0) {
        eventToDomain.set(event.name, domain.id);
      }
    });
  });

  scenario.domains.forEach((domain) => {
    const listeners = domain.listeners ?? [];

    listeners.forEach((listener) => {
      const triggeringEventName = listener.on?.event;
      const triggeringDomain =
        typeof triggeringEventName === "string"
          ? eventToDomain.get(triggeringEventName)
          : undefined;

      if (!triggeringDomain) {
        return;
      }

      const actions = listener.actions ?? [];

      actions.forEach((action) => {
        if (action.type === "emit") {
          const emittedEventName = action.event;
          if (typeof emittedEventName !== "string") {
            return;
          }

          const targetDomain = eventToDomain.get(emittedEventName);
          if (!targetDomain) {
            return;
          }

          lines.push(`${triggeringDomain}->>${targetDomain}: ${emittedEventName}`);
        }

        if (action.type === "set-state") {
          const label = action.status ? `set-state ${action.status}` : "set-state";
          lines.push(`${domain.id}-->>${domain.id}: ${label}`);
        }
      });
    });
  });

  if (lines.length <= 2) {
    lines.push("Note over Escenario: Sin interacciones detectadas");
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

  scenario.domains.forEach((domain) => {
    const domainEvents = domain.events ?? [];
    domainEvents.forEach((event) => {
      definedEvents.push({ domainId: domain.id, queue: domain.queue, event });
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
    `curl -X POST ${url}`,
    '  -H "Content-Type: application/json"',
    `  -d '${jsonPayload}'`,
  ].join("\n");
}

export function buildSummary(scenario: Scenario): Summary {
  const domainsCount = scenario.domains.length;
  let eventsCount = 0;
  let listenersCount = 0;

  scenario.domains.forEach((domain) => {
    eventsCount += domain.events?.length ?? 0;
    listenersCount += domain.listeners?.length ?? 0;
  });

  return { domainsCount, eventsCount, listenersCount };
}
