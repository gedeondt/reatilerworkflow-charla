import type { InspectScenarioContractFailure, ScenarioContract } from './scenarioContract.js';

export type ScenarioEventProposal = { title: string; description: string };

export type ScenarioProposalInput = {
  name: string;
  domains: string[];
  events: ScenarioEventProposal[];
  sagaSummary: string;
  openQuestions: string[];
};

export type ScenarioJsonPromptInput = {
  draftDescription: string;
  proposal: ScenarioProposalInput;
  language: 'es';
};

export type ScenarioJsonRetryPromptInput = ScenarioJsonPromptInput & {
  previousResponse: string;
  inspection: InspectScenarioContractFailure;
};

const scenarioDslExample: ScenarioContract = {
  name: 'retail-order-orchestration',
  version: 1,
  domains: [
    { id: 'orders', queue: 'orders-stream' },
    { id: 'inventory', queue: 'inventory-updates' },
    { id: 'shipping', queue: 'shipping-commands' },
  ],
  events: [
    {
      name: 'OrderPlaced',
      fields: {
        orderId: 'text',
        customerId: 'text',
        items: {
          type: 'array',
          items: {
            sku: 'text',
            quantity: 'number',
          },
        },
        totalAmount: 'number',
        requestedAt: 'datetime',
      },
    },
    {
      name: 'InventoryReserved',
      fields: {
        orderId: 'text',
        reservationId: 'text',
        reservedItems: {
          type: 'array',
          items: {
            sku: 'text',
            quantity: 'number',
          },
        },
      },
    },
    {
      name: 'ShipmentPrepared',
      fields: {
        orderId: 'text',
        trackingCode: 'text',
        packages: {
          type: 'array',
          items: {
            packageId: 'text',
            weightKg: 'number',
          },
        },
      },
    },
  ],
  listeners: [
    {
      id: 'orders-on-OrderPlaced',
      on: { event: 'OrderPlaced' },
      actions: [
        { type: 'set-state', domain: 'orders', status: 'PLACED' },
        {
          type: 'emit',
          event: 'InventoryReserved',
          toDomain: 'inventory',
          map: {
            orderId: 'orderId',
            reservationId: { const: 'RES-001' },
            reservedItems: {
              from: 'items',
              item: {
                sku: 'sku',
                quantity: 'quantity',
              },
            },
          },
        },
      ],
    },
    {
      id: 'inventory-on-InventoryReserved',
      on: { event: 'InventoryReserved' },
      delayMs: 30,
      actions: [
        { type: 'set-state', domain: 'inventory', status: 'RESERVED' },
        {
          type: 'emit',
          mode: 'AUTO',
          event: 'ShipmentPrepared',
          toDomain: 'shipping',
          map: {
            orderId: 'orderId',
            packages: {
              from: 'reservedItems',
              item: {
                packageId: 'sku',
                weightKg: { const: 1.2 },
              },
            },
            trackingCode: { const: 'TRACK-001' },
          },
        },
      ],
    },
  ],
};

const scenarioDslExampleString = JSON.stringify(scenarioDslExample, null, 2);

export const scenarioDslRules = `Reglas del DSL de escenarios:
- El objeto raíz debe incluir únicamente: name (string), version (number entero), domains, events y listeners.
- Cada dominio declara { "id": string, "queue": string }.
- Cada evento usa { "name": string, "fields"?: registro de campos }. Los campos aceptan tipos primitivos "text", "number", "boolean" o "datetime". Para colecciones usa { "type": "array", "items": { ...campos primitivos... } }.
- No se permiten objetos anidados arbitrarios ni arrays de arrays. Las colecciones siempre contienen objetos planos con campos primitivos.
- Cada listener tiene { "id", "on": { "event" }, "delayMs"? y "actions" }.
- Las acciones disponibles son "set-state" (con domain y status) y "emit" (con event, toDomain, mode? y map?).
- Las acciones "emit" solo aceptan mode "AUTO" cuando se especifique. Si no se indica, se asume "AUTO".
- El objeto "map" de una acción "emit" relaciona campos del evento escuchado con el evento emitido. Cada destino puede recibir una referencia directa "campoFuente", un valor constante { "const": valor } o un array { "from": "campoArray", "item": { ... } }.
- Las referencias directas solo pueden apuntar a campos primitivos definidos en el evento de origen.
- Los arrays en map solo pueden provenir de campos declarados como { "type": "array" }. Dentro de "item", cada clave debe apuntar a un subcampo primitivo del elemento del array o a un { "const": valor }.
- No se admiten otras claves como payloadSchema, mapping, subscribesTo, steps, lanes, actors ni metadatos adicionales.
- El JSON de salida no debe contener texto ni comentarios adicionales.`;

const formatProposalSummary = (proposal: ScenarioProposalInput): string =>
  JSON.stringify(proposal, null, 2);

export const scenarioJsonPrompt = ({
  draftDescription,
  proposal,
  language,
}: ScenarioJsonPromptInput): string => {
  return `Eres el asistente del diseñador de escenarios retail. Recibirás la descripción inicial de la persona usuaria y la propuesta refinada actual.

${scenarioDslRules}

Ejemplo canónico válido:
${scenarioDslExampleString}

Tareas a realizar:
1. Analiza si la descripción describe un proceso de negocio retail o logístico. Si es así, identifica dominios técnicos coherentes y define eventos con sus campos.
2. Si la descripción es confusa o no parece un proceso de negocio, diseña una SAGA creativa pero verosímil utilizando el mismo DSL.
3. Emplea únicamente los campos declarados en la propuesta actual cuando tenga sentido y complétalos según las reglas del DSL.

Requisitos estrictos:
- Responde solo con un JSON con las propiedades { name, version, domains, events, listeners }.
- Usa el idioma ${language} para cualquier texto libre.
- Mantén coherencia entre dominios, eventos y listeners. Cada listener debe escuchar un evento existente y solo puede usar los campos del payload de ese evento en los "map".
- Define version como un número entero >= 1.
- Los campos de eventos deben usar exclusivamente "fields" y el formato descrito. No inventes payloadSchema ni estructuras antiguas.
- No incluyas texto fuera del JSON final.

Descripción original de la persona usuaria:
"""
${draftDescription}
"""

Propuesta refinada aprobada:
${formatProposalSummary(proposal)}
`;
};

export const scenarioJsonRetryPrompt = ({
  draftDescription,
  proposal,
  language,
  previousResponse,
  inspection,
}: ScenarioJsonRetryPromptInput): string => {
  const issueList = inspection.errors.map((detail) => `- ${detail}`).join('\n');

  return `La salida anterior no cumple el DSL exigido para el escenario.

${scenarioDslRules}

Errores detectados:
${issueList || '- Se devolvió un formato vacío o ilegible.'}

Repite el ejercicio devolviendo únicamente un JSON válido y autoconsistente.

Recuerda:
- No añadas texto fuera del JSON.
- Respeta los campos del evento de origen al construir los map.
- Si el escenario inicial no era un proceso claro, puedes generar una historia creativa pero consistente.

Descripción original:
"""
${draftDescription}
"""

Propuesta aprobada:
${formatProposalSummary(proposal)}

Respuesta inválida previa (para que puedas corregirla):
${previousResponse}

Idioma objetivo: ${language}.`;
};

export const scenarioBootstrapPrompt = (scenario: ScenarioContract): string => {
  const scenarioJson = JSON.stringify(scenario, null, 2);

  return `Genera un único evento inicial para disparar la SAGA descrita.

Responde exclusivamente con un JSON con la forma:
{
  "queue": "nombre-cola",
  "event": {
    "eventName": "nombre-evento",
    "version": 1,
    "eventId": "evt-1",
    "traceId": "trace-1",
    "correlationId": "saga-1",
    "occurredAt": "2025-01-01T00:00:00.000Z",
    "data": { ...camposNecesarios }
  }
}

Reglas:
- Elige una queue existente en domains.
- Usa un eventName coherente con events.
- Asegúrate de que data respete los fields declarados para el evento elegido. Si un campo es un array, construye objetos que respeten sus subcampos.
- No añadas texto fuera del JSON.

Escenario de referencia:
${scenarioJson}`;
};
