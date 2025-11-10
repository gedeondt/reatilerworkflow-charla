import type { InspectScenarioContractFailure, ScenarioContract } from './scenarioContract.js';

export const scenarioDslRules = `
Genera escenarios usando exclusivamente este DSL basado en campos y mapeos:
- El JSON raíz debe contener { name, version, domains, events, listeners } sin claves adicionales.
- domains es un array de { "id": string, "queue": string }.
- events es un array de { "name": string, "fields"?: { [campo: string]: "text" | "number" | "boolean" | "datetime" | { "type": "array", "items": { [subCampo: string]: "text" | "number" | "boolean" | "datetime" } } } }.
- listeners es un array de { "id": string, "on": { "event": string }, "delayMs"?: number, "actions": [...] }.
- Las acciones válidas son { "type": "set-state", "domain": string, "status": string } y { "type": "emit", "mode"?: "AUTO", "event": string, "toDomain": string, "map"?: { ... } }.
- En map cada clave destino puede tomar un string que referencie un campo del evento de entrada, un objeto { "const": valor } o un objeto { "from": nombreArray, "item": { ... } } para transformar elementos de arrays definidos en fields.
- Los mapeos de arrays solo pueden utilizar los campos de cada item tal y como se definieron en fields. No se permiten arrays de arrays ni objetos anidados arbitrarios.
- Está prohibido utilizar payloadSchema, mapping, steps, lanes, actors, subscribesTo, sagaSummary, openQuestions, metadata u otras claves ajenas al DSL.
`.trim();

type ScenarioProposalForPrompt = {
  name: string;
  domains: string[];
  events: { title: string; description: string }[];
  sagaSummary: string;
  openQuestions: string[];
};

type ScenarioDraftForPrompt = {
  inputDescription: string;
  currentProposal: ScenarioProposalForPrompt;
};

export const scenarioJsonPrompt = (
  draft: ScenarioDraftForPrompt,
  language: string,
): string => {
  const proposalSummary = JSON.stringify(draft.currentProposal, null, 2);

  return `Tu misión es convertir la propuesta aprobada en un escenario ejecutable respetando el DSL indicado.

${scenarioDslRules}

Sigue este flujo de trabajo:
1. Lee la descripción original y la propuesta para entender el proceso.
2. Si la descripción parece un proceso de negocio real, conviértelo tal cual al DSL.
3. Si la descripción no define un proceso claro, inventa una SAGA creativa pero coherente siguiendo el mismo DSL.
4. Devuelve únicamente un JSON válido con { "name", "version", "domains", "events", "listeners" }.
5. Utiliza fields para describir los datos de cada evento con los tipos permitidos.
6. Usa map solo para leer campos del evento que activa el listener (o de sus items) y para constantes con {"const": ...}.
7. No añadas texto fuera del JSON ni claves prohibidas.

Descripción inicial proporcionada por la persona usuaria:
"""
${draft.inputDescription}
"""

Propuesta actual aprobada:
${proposalSummary}

Idioma objetivo para textos descriptivos: ${language}.
`.trim();
};

type ScenarioJsonRetryPromptParams = {
  draftDescription: string;
  proposal: ScenarioProposalForPrompt;
  language: string;
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

  return `La respuesta anterior no cumple el contrato del escenario. Corrige el JSON siguiendo las reglas del DSL.

${scenarioDslRules}

Errores detectados en la validación:
${errorsList}

Respuesta previa del asistente (solo para contexto, no la repitas):
"""
${previousResponse}
"""

Descripción inicial de la persona usuaria:
"""
${draftDescription}
"""

Propuesta aprobada que debes respetar:
${proposalSummary}

Devuelve únicamente un JSON válido corregido con { "name", "version", "domains", "events", "listeners" } sin texto adicional. Usa fields y map conforme a las reglas. Idioma objetivo: ${language}.
`.trim();
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
- Asegúrate de que data respeta los fields definidos para ese evento en el escenario.
- No añadas explicaciones ni texto fuera del JSON.

Escenario de referencia:
${scenarioJson}`.trim();
};
