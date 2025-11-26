import type { ScenarioContract } from './domain/validateScenario.js';

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
  "domains": DomainSpec[]
}

DomainSpec:
{
  "id": string,
  "queue": string,
  "publishes"?: Event[],
  "listeners"?: Listener[]
}

- Declara los eventos que el dominio emite en "domains[*].publishes" (alias "events" solo por compatibilidad).
- Marca exactamente un evento en todo el escenario con "start": true: es el que arranca la SAGA.
- Asume flujos lineales: cada evento debe ser consumido por un único listener (no hagas fan-out).
- No dupliques listas top-level "events" ni "listeners": todo vive dentro de cada dominio.
- Evita listeners autocontenidos que reaccionen a eventos del mismo dominio solo para reenviarlos; las reacciones viven en el dominio consumidor.
- Está prohibido usar las listas top-level "events" o "listeners".

Event:
{
  "name": string,
  "start"?: boolean,
  "payloadSchema": PayloadSchema
}

PayloadSchema permitido:
- Objeto plano. Cada propiedad se define como uno de estos valores literales:
  * "string" | "number" | "boolean"
  * Un objeto plano (sin arrays) que describa campos anidados sencillos.
  * Un array con un ÚNICO objeto plano que describe la forma de los ítems. Ejemplo:
    "items": [ { "sku": "string", "cantidad": "number" } ]
- No se permiten sufijos escalares como "string[]", "number[]" o "boolean[]": todos los arrays deben representarse como arrays de objetos planos con un único ejemplo.
- No se permiten objetos anidados arbitrarios fuera de los arrays descritos ni arrays de arrays.
- No se permiten claves especiales como fields/payload.

Listener:
{
  "id": string,
  "on": { "event": string, "fromDomain"?: string },
  "delayMs"?: number,
  "actions": Action[]
}

Acciones válidas:
- emit → { "type": "emit", "event": string, "mapping": Mapping }

- Los nombres de eventos son globales y únicos. Los listeners viven en el dominio consumidor y reaccionan a eventos publicados por otros dominios.
- Usa "fromDomain" para reforzar qué dominio publica el evento que escucha el listener.
- Las acciones "emit" deben referenciar eventos publicados por el propio dominio (normalmente definidos en "publishes"). No incluyas "toDomain".
- Los listeners viven dentro de su dominio y su "id" debe ser único en todo el escenario.

Reglas críticas para Mapping:
- Cuando definas mapping para un evento destino:
  - Revisa el payloadSchema del evento destino.
  - Para cada campo del destino:
    - Si el tipo es "string", "number" o "boolean":
      - Mapping permitido:
        - "campoDestino": "campoOrigen"
        - "campoDestino": { "from": "campoOrigen" }
        - "campoDestino": { "const": <valor escalar compatible> }
    - Si el tipo es un objeto plano:
      - Usa { "map": { ... } } con opcional "objectFrom" para señalar el origen.
    - Para arrays de objetos (payloadSchema con "items": [ { ... } ]):
      - Se mantiene permitido:
        - "campoArrayDestino": { "arrayFrom": "campoArrayOrigen", "map": { ... } } solo en ese caso concreto.
      - arrayFrom debe apuntar a un campo array de objetos del evento origen y map solo puede referenciar campos del ítem origen o constantes tipadas correctamente.
  - Regla dura:
    - El tipo construido por mapping debe coincidir EXACTAMENTE con el tipo del payloadSchema destino.
    - Si no tienes un origen razonable para arrays de primitivos, rediseña el flujo para obtenerlo.
    - No referencies campos que no existan en el evento de entrada.
    - No inventes arrays escalares ni uses sufijos "[]": cuando necesites un array, defínelo como array de objetos y mapea con arrayFrom + map.
- No declares campos en mapping que no existan en el payloadSchema destino.

Prohibido:
- Declarar "toDomain" en acciones "emit": el dominio destino se infiere del evento publicado.
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

Recuerda:
- Declara los eventos publicados en "domains[*].publishes" (alias legacy: "events") y los listeners en "domains[*].listeners".
- No declares las listas top-level "events" ni "listeners" en el escenario generado.
- Mantén los nombres de los eventos únicos y reutilízalos cuando otros dominios deban reaccionar.
- Los listeners deben vivir en el dominio consumidor; evita generar listeners que reboten el mismo evento publicado por su dominio.
- Marca exactamente un evento con "start": true (el que arranca la SAGA) y asegura un flujo lineal: cada evento es consumido por un único listener.

Cuando generes mappings:
- No inventes arrays escalares ni uses sufijos "[]". Cuando el destino tenga un array, debe estar descrito como array de objetos y debes usar { "arrayFrom": "...", "map": { ... } }.
- Si no hay un campo array adecuado en el evento de entrada, rediseña el flujo de eventos para introducirlo antes de emitir.
- Utiliza 'arrayFrom' + 'map' únicamente cuando el payloadSchema destino defina un array de objetos ("items": [ { ... } ]).
- No inventes otras estructuras ni incluyas campos no definidos en el payloadSchema destino.
- No referencies campos inexistentes del evento origen; emplea { 'const': ... } solo para campos escalares cuando sea necesario.

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
  errors: string[];
};

export const scenarioJsonRetryPrompt = ({
  draftDescription,
  proposal,
  language,
  previousResponse,
  errors,
}: ScenarioJsonRetryPromptParams): string => {
  const proposalSummary = JSON.stringify(proposal, null, 2);
  const errorsList = errors.map((error) => `- ${error}`).join('\n');

  return `La respuesta anterior no cumple el contrato del escenario. Corrige el JSON anterior siguiendo exactamente las reglas del DSL y estas correcciones:

${scenarioDslRules}

  Reglas adicionales:
  - Declara "publishes" (o su alias "events") y "listeners" dentro del dominio correspondiente; no utilices listas top-level.
  - Mantén los nombres de eventos únicos en todo el escenario.
  - Asegura linealidad: cada evento solo puede tener un listener que lo consuma.

  Errores detectados:
  ${errorsList}

  Corrige especialmente cualquier campo array: todos deben representarse como arrays de objetos y mapearse con { "arrayFrom": "...", "map": { ... } } desde un array existente del evento de entrada. Si falta ese origen, rediseña el flujo para incorporarlo antes de emitir.

  Recuerda:
  - Revisa la descripción inicial y la propuesta refinada.
  - Ajusta el JSON para corregir los errores sin introducir claves nuevas.
  - Al construir "mapping" en una acción "emit", respeta las reglas descritas: escalares con referencias directas o { "const": ... }, objetos con { "map": { ... } } y arrays de objetos con { "arrayFrom": ..., "map": { ... } }.
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
