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
Contrato obligatorio de @reatiler/saga-kernel.scenarioSchema (todos los escenarios deben cumplirlo exactamente):

Raíz del JSON:
{
  "name": string,
  "version": number,
  "domains": Domain[],
  "events": Event[],
  "listeners": Listener[]
}

Domain:
{ "id": string, "queue": string }

Event:
{
  "name": string,
  "payloadSchema": PayloadSchema
}

PayloadSchema permitido:
- Objeto plano. Cada propiedad se define como uno de estos valores literales:
  * "string" | "number" | "boolean"
  * "string[]" | "number[]" | "boolean[]"
  * Un array con un ÚNICO objeto plano que describe la forma de los ítems. Ejemplo:
    "items": [ { "sku": "string", "cantidad": "number" } ]
- No se permiten objetos anidados arbitrarios fuera de los arrays descritos.
- No se permiten arrays de arrays ni claves especiales como fields/payload.

Listener:
{
  "id": string,
  "on": { "event": string },
  "delayMs"?: number,
  "actions": Action[]
}

Acciones válidas:
- set-state → { "type": "set-state", "domain": string, "status": string }
- emit → { "type": "emit", "event": string, "toDomain": string, "mapping": Mapping }

Reglas críticas para Mapping:
- Construye el mapping consultando el payloadSchema del EVENTO DESTINO.
- Para cada campo del schema destino:
  * Si es primitivo ("string", "number", "boolean" o versiones []):
    - Usa "campoDestino": "campoOrigen" (referencia directa) o
      "campoDestino": { "from": "campoOrigen" } o
      "campoDestino": { "const": valor compatible }.
    - No utilices objetos adicionales ni arrayFrom.
  * Si es un ARRAY de OBJETOS (ej.: [ { ... } ]):
    - Usa la forma exacta:
      "campoArrayDestino": {
        "arrayFrom": "campoArrayOrigen",
        "map": {
          "subCampoDestino": "subCampoOrigen" | { "const": valorCompatible }
        }
      }
    - arrayFrom debe apuntar a un campo array existente en el evento origen.
    - map solo puede usar subcampos del ítem origen o constantes tipadas correctamente.
- No declares campos en mapping que no existan en el payloadSchema destino.
- No referencies campos inexistentes en el evento origen.
- Si no existe un origen válido, usa { "const": ... } del tipo adecuado.

Prohibido:
- Cualquier clave extra (fields, steps, lanes, subscribesTo, sagaSummary, openQuestions, metadata, etc.).
- Estructuras de mapping diferentes a las descritas.
`.trim();

export const scenarioJsonPrompt = (
  draft: ScenarioDraftSummary,
  language: ScenarioLanguage,
): string => {
  const proposalSummary = JSON.stringify(draft.currentProposal, null, 2);

  return `Analiza la descripción y la propuesta refinada para generar un escenario SAGA ejecutable en formato JSON.

${scenarioDslRules}

Reglas clave al escribir "mapping" dentro de una acción "emit":
- Revisa primero el payloadSchema del evento destino.
- Para campos escalares, usa únicamente "campoDestino": "campoOrigen", "campoDestino": { "from": "campoOrigen" } o "campoDestino": { "const": valorCompatible }.
- Para arrays de objetos usa SOLO la forma: "campoArrayDestino": { "arrayFrom": "campoArrayOrigen", "map": { ... } }.
- No inventes otras estructuras ni incluyas campos no definidos en el payloadSchema destino.
- No referencies campos inexistentes del evento origen; emplea { "const": ... } si es necesario.

Instrucciones clave:
- Lee la descripción inicial y la propuesta aprobada para comprender el proceso.
- Si se trata de un proceso de negocio coherente, define dominios, eventos y listeners siguiendo el DSL oficial.
- Si el texto es absurdo o incoherente, inventa una SAGA creativa pero válida usando el mismo DSL.
- Devuelve SOLO un JSON que cumpla ese esquema, sin comentarios ni texto adicional.
- No añadas claves prohibidas ni estructuras fuera del contrato.
- Asegúrate de que "payloadSchema" no utiliza campos especiales (fields, payload, etc.) y solo contiene las definiciones permitidas.

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
- Al construir "mapping" en una acción "emit", respeta las reglas descritas: escalares con "campoDestino": "campoOrigen" | { "from": ... } | { "const": ... } y arrays de objetos con { "arrayFrom": ..., "map": { ... } }.
- Devuelve SOLO el JSON corregido que cumpla exactamente el DSL; no añadas texto adicional.

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
