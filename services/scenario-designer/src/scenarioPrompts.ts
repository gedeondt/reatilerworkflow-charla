import type { InspectScenarioContractFailure, ScenarioContract } from './scenarioContract.js';

export type ScenarioLanguage = 'es';

export type ScenarioProposalSummary = {
  name: string;
  domains: string[];
  events: Array<{ title: string; description: string }>;
  sagaSummary: string;
  openQuestions: string[];
};

export type ScenarioDraftSummary = {
  inputDescription: string;
  currentProposal: ScenarioProposalSummary;
};

export const scenarioDslRules = `
El escenario debe seguir al pie de la letra el contrato de @reatiler/saga-kernel.scenarioSchema.

La forma general es:
{
  "name": string,
  "version": number,
  "domains": [
    { "id": string, "queue": string }
  ],
  "events": [
    {
      "name": string,
      "payloadSchema": {
        "<campo>":
          | "string" | "number" | "boolean"
          | "string[]" | "number[]" | "boolean[]"
          | { "<subcampo>": ... } // objeto plano con tipos primitivos
          | [ { "<subcampo>": ... } ] // array de objetos planos
      }
    }
  ],
  "listeners": [
    {
      "id": string,
      "on": { "event": string },
      "delayMs"?: number,
      "actions": [
        { "type": "set-state", "domain": string, "status": string }
        |
        {
          "type": "emit",
          "event": string,
          "toDomain": string,
          "mapping": {
            "<campo>":
              | string // referencia directa a un campo del payload recibido
              | { "const": string | number | boolean | null } // constante escalar permitida por el schema destino
              | { "<subcampo>": string | { "const": string | number | boolean | null } } // para objetos anidados definidos en el payloadSchema destino
              | { "from": string, "item": { ... } } // solo si el campo destino es un array según su payloadSchema
          }
        }
      ]
    }
  ]
}

Reglas estrictas:
- Mantén EXACTAMENTE estas claves y tipos.
- "payloadSchema" define los campos permitidos del payload del evento. Sólo acepta tipos primitivos, objetos planos o arrays de objetos planos según el schema real.
- Para cada acción "emit":
  - Debes mirar el "payloadSchema" del evento DESTINO antes de construir el "mapping".
  - Para cada campo del "payloadSchema" destino:
    - Si es un valor escalar (string, number, boolean, etc.):
      - el "mapping" para ese campo debe ser SIEMPRE una referencia a un campo del evento de entrada ("campoDestino": "campoOrigen") o una constante escalar ("campoDestino": { "const": "VALOR" }).
      - NO uses objetos ni estructuras de array para ese campo.
    - Si el "payloadSchema" destino define un array:
      - solo entonces puedes usar una estructura de mapeo de array: "campoArrayDestino": { "from": "campoArrayOrigen", "item": { ... } }.
      - dentro de "item", usa únicamente referencias a campos del elemento origen o { "const": ... }.
    - Si el campo destino es un objeto anidado permitido por el schema:
      - construye un objeto con mappings escalares dentro, sin añadir niveles adicionales arbitrarios.
- Regla dura: el TIPO del valor producido por "mapping" debe coincidir con el tipo definido en el "payloadSchema" del evento destino. Si el campo destino es escalar, el mapping debe ser escalar. Si es array, el mapping debe ser de array según el patrón permitido.
- No inventes estructuras de mapeo complejas si el payloadSchema del evento destino no las define.
- No añadas claves no reconocidas por scenarioSchema (por ejemplo: fields, steps, lanes, actors, subscribesTo, sagaSummary, openQuestions, metadata, mode, item, etc.).
- Si la descripción no corresponde a un negocio real, inventa una SAGA creativa pero válida siguiendo este mismo DSL.
`.trim();

export const scenarioJsonPrompt = (
  draft: ScenarioDraftSummary,
  language: ScenarioLanguage,
): string => {
  const proposalSummary = JSON.stringify(draft.currentProposal, null, 2);

  return `Analiza la descripción y la propuesta refinada para generar un escenario SAGA ejecutable en formato JSON.

${scenarioDslRules}

Cuando definas "mapping" en una acción "emit":
- Revisa primero el "payloadSchema" del evento destino.
- Asegúrate de que cada entrada en "mapping" produce un valor del tipo correcto para ese campo destino.
- Si el esquema del campo destino es escalar, usa solo "campoDestino": "campoOrigen" o "campoDestino": { "const": ... }.
- Solo uses la forma con "from" + "item" cuando el campo destino es un array en el payloadSchema.

Instrucciones clave:
- Lee la descripción inicial y la propuesta aprobada para comprender el proceso.
- Si se trata de un proceso de negocio coherente, define dominios, eventos y listeners siguiendo el DSL oficial.
- Si el texto es absurdo o incoherente, inventa una SAGA creativa pero válida usando el mismo DSL.
- Devuelve SOLO un JSON que cumpla ese esquema, sin comentarios ni texto adicional.
- No uses claves prohibidas ni estructuras fuera del contrato.

Descripción inicial del escenario:
"""
${draft.inputDescription}
"""

Propuesta refinada actual:
${proposalSummary}

Idioma objetivo para nombres y descripciones: ${language}.`.trim();
};

export type ScenarioJsonRetryPromptParams = {
  draftDescription: string;
  proposal: ScenarioProposalSummary;
  language: ScenarioLanguage;
  previousResponse: string;
  inspection: InspectScenarioContractFailure;
};

export const scenarioJsonRetryPrompt = ({
  draftDescription,
  proposal,
  language,
  previousResponse,
  inspection,
}: ScenarioJsonRetryPromptParams): string => {
  const proposalSummary = JSON.stringify(proposal, null, 2);
  const errorsList = inspection.errors.map((error) => `- ${error}`).join('\n');

  return `La respuesta anterior no cumple el contrato del escenario. Corrige el JSON anterior siguiendo exactamente las reglas del DSL y estas correcciones:

${scenarioDslRules}

Errores detectados:
${errorsList}

Recuerda:
- Revisa la descripción inicial y la propuesta refinada.
- Ajusta el JSON para corregir los errores sin introducir claves nuevas.
- Cuando definas "mapping" en una acción "emit", revisa primero el "payloadSchema" del evento destino, respeta el tipo de cada campo y aplica las reglas de mapeo descritas.
- Devuelve SOLO el JSON corregido. No añadas comentarios ni texto fuera del JSON.

Descripción inicial:
"""
${draftDescription}
"""

Propuesta aprobada:
${proposalSummary}

Respuesta previa del modelo:
"""
${previousResponse}
"""

Idioma objetivo: ${language}.`.trim();
};

export const scenarioBootstrapPrompt = (scenario: ScenarioContract): string => {
  const scenarioJson = JSON.stringify(scenario, null, 2);

  return `Analiza el escenario descrito a continuación y prepara un único evento inicial para arrancar la SAGA.

Responde exclusivamente con un objeto JSON que siga esta estructura exacta:
{
  "queue": "nombre-cola",
  "event": {
    "eventName": "...",
    "version": 1,
    "eventId": "evt-1",
    "traceId": "trace-1",
    "correlationId": "saga-1",
    "occurredAt": "2025-01-01T00:00:00.000Z",
    "data": { }
  }
}

Requisitos clave:
- Selecciona una cola (queue) que exista dentro de los dominios del escenario.
- Usa un eventName coherente con los eventos definidos en el escenario.
- Completa version, eventId, traceId, correlationId y occurredAt con ejemplos plausibles.
- Incluye en data únicamente los campos imprescindibles para que la historia del escenario tenga sentido.
- Asegúrate de que los campos del objeto data respeten el payloadSchema del evento correspondiente en el escenario.

Escenario de referencia:
${scenarioJson}`.trim();
};
