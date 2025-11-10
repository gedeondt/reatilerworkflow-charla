import { scenarioDslRules } from './scenarioContract.js';

export const scenarioSystemPrompt = `
Eres un asistente que diseña escenarios retail en un DSL estricto basado en DOMINIOS, EVENTOS y LISTENERS.
Responde siempre en español.
Sigue estas reglas del DSL sin añadir claves nuevas ni modos inesperados:
${scenarioDslRules}
Recuerda que el map de un emit solo puede leer campos del evento que activa al listener.
Si la descripción de la persona usuaria no parece un caso de negocio, imagina una SAGA creativa pero válida dentro de este DSL.
`.trim();

const scenarioJsonRulesBlock = `
${scenarioDslRules}
- El JSON raíz debe ser exactamente { name, version, domains, events, listeners }.
- Define fields solo cuando el evento requiere datos; si no, omite fields.
- El map de los emit solo puede leer campos del evento que activa el listener.
- No inventes claves nuevas ni estructuras fuera del DSL.
- Las claves deben respetar el DSL, sin texto adicional fuera del JSON.
`.trim();

export const scenarioJsonPrompt = ({
  description,
  proposal,
  language,
}: {
  description: string;
  proposal: string;
  language: string;
}): string => `Genera el JSON ejecutable del escenario retail solicitado.

Sigue estas reglas estrictas:
${scenarioJsonRulesBlock}

Devuelve ÚNICAMENTE un JSON válido con { name, version, domains, events, listeners }.

Descripción inicial del reto:
"""
${description}
"""

Propuesta actual aprobada:
${proposal}

Idioma objetivo para textos descriptivos: ${language}.
`.trim();

export const scenarioJsonRetryPrompt = ({
  description,
  proposal,
  language,
  reason,
}: {
  description: string;
  proposal: string;
  language: string;
  reason: string;
}): string => `Genera nuevamente el JSON ejecutable del escenario retail solicitado.

Sigue estas reglas estrictas:
${scenarioJsonRulesBlock}

La salida anterior fue inválida por: ${reason}. Corrígela sin añadir texto fuera del JSON.

Descripción inicial del reto:
"""
${description}
"""

Propuesta actual aprobada:
${proposal}

Idioma objetivo para textos descriptivos: ${language}.
`.trim();
