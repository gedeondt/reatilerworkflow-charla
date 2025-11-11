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
  "domains": DomainSpec[]
}

DomainSpec:
{
  "id": string,
  "queue": string,
  "events"?: Event[],
  "listeners"?: Listener[]
}

- TODOS los eventos y listeners deben declararse dentro de su dominio usando "domains[*].events" y "domains[*].listeners".
- Está prohibido usar las listas top-level "events" o "listeners".

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
- set-state → { "type": "set-state", "status": string }
- emit → { "type": "emit", "event": string, "toDomain"?: string, "mapping": Mapping }

- Los nombres de eventos son globales y únicos. Cualquier listener puede reaccionar al evento declarado en "on.event" sin importar el dominio que lo definió.
- Si defines "emit.toDomain", debe coincidir con el dominio que declaró ese evento. Si lo omites, se usa automáticamente el dominio propietario del evento destino.
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
    - Si el tipo es "string[]", "number[]" o "boolean[]":
      - Mapping permitido ÚNICAMENTE:
        - "campoDestino": "campoOrigen" cuando el evento de entrada tenga un campo array del mismo tipo,
        - "campoDestino": { "from": "campoOrigen" } bajo esa misma condición.
      - PROHIBIDO:
        - { "const": [ ... ] }
        - Objetos con arrayFrom, map, objectFrom u otras estructuras.
      - Si no existe un campo array compatible, no inventes el mapping: rediseña el escenario para que el array exista en el evento de entrada antes de emitir.
    - Para arrays de objetos (payloadSchema con "items": [ { ... } ]):
      - Se mantiene permitido:
        - "campoArrayDestino": { "arrayFrom": "campoArrayOrigen", "map": { ... } } solo en ese caso concreto.
      - arrayFrom debe apuntar a un campo array de objetos del evento origen y map solo puede referenciar campos del ítem origen o constantes tipadas correctamente.
  - Regla dura:
    - El tipo construido por mapping debe coincidir EXACTAMENTE con el tipo del payloadSchema destino.
    - Si no tienes un origen razonable para arrays de primitivos, rediseña el flujo para obtenerlo.
    - No referencies campos que no existan en el evento de entrada.
    - No uses { "const": [ ... ] } ni arrayFrom para campos cuyo tipo en el payloadSchema sea "string[]", "number[]" o "boolean[]".
- No declares campos en mapping que no existan en el payloadSchema destino.

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

Recuerda:
- Define los eventos y listeners dentro de cada dominio usando "domains[*].events" y "domains[*].listeners".
- No declares las listas top-level "events" ni "listeners" en el escenario generado.
- Mantén los nombres de los eventos únicos y reutilízalos cuando otros dominios deban reaccionar.

Cuando generes mappings:
- Para campos 'string[]', 'number[]' o 'boolean[]' del evento destino, SOLO puedes usar un campo array existente del evento de entrada ("campoDestino": "campoOrigen" o { 'from': 'campoOrigen' }).
- No uses { 'const': [ ... ] } ni 'arrayFrom' ni estructuras complejas para estos campos.
- Si no hay un campo array adecuado en el evento de entrada, rediseña el flujo de eventos para introducir ese dato antes de emitir.
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

  Reglas adicionales:
  - Declara "events" y "listeners" dentro del dominio correspondiente; no utilices listas top-level.
  - Mantén los nombres de eventos únicos en todo el escenario.

  Errores detectados:
  ${errorsList}

  Corrige especialmente los mappings de campos 'string[]'/'number[]'/'boolean[]': deben mapearse solo desde arrays existentes del evento de entrada ("campoDestino": "campoOrigen" o { "from": "campoOrigen" }), sin usar { "const": [ ... ] } ni 'arrayFrom'. Si falta ese origen, rediseña el flujo para incorporarlo antes de emitir.

  Recuerda:
  - Revisa la descripción inicial y la propuesta refinada.
  - Ajusta el JSON para corregir los errores sin introducir claves nuevas.
  - Al construir "mapping" en una acción "emit", respeta las reglas descritas: escalares con referencias directas o { "const": ... }, arrays de primitivos solo con referencias directas a arrays existentes y arrays de objetos con { "arrayFrom": ..., "map": { ... } }.
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
