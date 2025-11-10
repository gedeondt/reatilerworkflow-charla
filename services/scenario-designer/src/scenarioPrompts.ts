import type { InspectScenarioContractFailure, ScenarioContract } from './scenarioContract.js';

export const scenarioDslRules = `Contrato obligatorio en JSON con las claves { name, version, domains, events, listeners }. Cada dominio tiene { id, queue }. Los eventos describen "name" y opcionalmente "fields" (text, number, boolean, datetime) o un único nivel de arrays de objetos planos. Los listeners contienen { id, on: { event }, delayMs?, actions[] } donde las acciones solo pueden ser set-state o emit. Las acciones emit usan map con asignaciones "dest": "source", constantes mediante { "const": valor } y arrays con "destArray": { from, item: { ... } } siempre leyendo del payload del evento que activa el listener.`;

type ScenarioDraftForPrompt = {
  inputDescription: string;
  currentProposal: {
    name: string;
    domains: string[];
    events: { title: string; description: string }[];
    sagaSummary: string;
    openQuestions: string[];
  };
};

type ScenarioJsonRetryPromptOptions = {
  draftDescription: string;
  proposal: ScenarioDraftForPrompt['currentProposal'];
  language: string;
  previousResponse: string;
  inspection: InspectScenarioContractFailure;
};

export const scenarioJsonPrompt = (
  draft: ScenarioDraftForPrompt,
  language: string,
): string => {
  const proposalSummary = JSON.stringify(draft.currentProposal, null, 2);

  return `Diseña el contrato ejecutable del escenario retail basándote en la propuesta aprobada.

${scenarioDslRules}

Instrucciones estrictas:
- Si la descripción original es un caso de negocio realista, produce una SAGA coherente y profesional.
- Si la descripción es absurda o humorística, genera una SAGA creativa pero que siga siendo válida bajo el mismo DSL.
- Devuelve únicamente un JSON con las claves { name, version, domains, events, listeners }.
- Los eventos deben usar "fields" para describir su payload siguiendo los tipos permitidos. Cuando no haya datos, omite "fields" o usa un objeto vacío.
- En las acciones emit define "map" respetando el DSL: referencias a campos del evento que dispara el listener, constantes y mapeos de arrays de un solo nivel.
- No utilices payloadSchema, mapping antiguo, steps, lanes, actors, subscribesTo, sagaSummary, openQuestions ni otras claves prohibidas.
- Respeta los dominios y la secuencia narrativa de la propuesta.
- Escribe identificadores y textos descriptivos en el idioma solicitado (${language}).
- No añadas comentarios ni texto fuera del JSON.

Descripción inicial proporcionada por la persona usuaria:
"""
${draft.inputDescription}
"""

Propuesta actual aprobada:
${proposalSummary}`.trim();
};

export const scenarioJsonRetryPrompt = ({
  draftDescription,
  proposal,
  language,
  previousResponse,
  inspection,
}: ScenarioJsonRetryPromptOptions): string => {
  const proposalSummary = JSON.stringify(proposal, null, 2);
  const errorsList = inspection.errors.map((error) => `- ${error}`).join('\n');

  return `La respuesta anterior no cumple el contrato del escenario y debe corregirse.

${scenarioDslRules}

Errores detectados en la última respuesta (${inspection.type}):
${errorsList}

Genera un nuevo JSON que respete las reglas y el contrato esperado.

Recuerda:
- Usa "fields" y "map" exactamente como define el DSL.
- No añadas claves prohibidas como payloadSchema ni mapping antiguo.
- Mantén coherencia con la propuesta aprobada.
- Respeta el idioma solicitado (${language}) en nombres y textos descriptivos.
- Devuelve únicamente el JSON final sin texto adicional.

Descripción original:
"""
${draftDescription}
"""

Propuesta aprobada:
${proposalSummary}

Respuesta anterior del asistente (solo para tu referencia, no la repitas):
"""
${previousResponse}
"""`.trim();
};

export const scenarioBootstrapPrompt = (scenario: ScenarioContract): string => {
  const scenarioJson = JSON.stringify(scenario, null, 2);

  return `Analiza el siguiente contrato de escenario y genera un único evento inicial de arranque.

Responde únicamente con un objeto JSON que siga la estructura:
{
  "queue": "nombre-cola-existente",
  "event": {
    "eventName": "NombreDelEvento",
    "version": 1,
    "eventId": "evt-1",
    "traceId": "trace-1",
    "correlationId": "saga-1",
    "occurredAt": "2025-01-01T00:00:00.000Z",
    "data": { }
  }
}

Requisitos clave:
- Selecciona una cola (queue) que exista en el apartado domains del contrato.
- Usa un eventName que corresponda con los eventos declarados.
- Completa version, eventId, traceId, correlationId y occurredAt con valores de ejemplo coherentes.
- El objeto data debe respetar los "fields" definidos en el evento seleccionado, usando valores de ejemplo compatibles con sus tipos.
- No añadas campos adicionales ni texto fuera del JSON.

Contrato del escenario:
${scenarioJson}`.trim();
};
