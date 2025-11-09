import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { scenarioSchema, type Scenario } from '@reatiler/saga-kernel';
import {
  ConfigurationError,
  OpenAIRequestFailedError,
  ensureOpenAI,
  requestJsonContent,
  type ChatCompletionMessageParam,
} from './openaiClient.js';

type DraftParams = { id: string };

type ScenarioDraftHistoryEntryType = 'initial' | 'refinement';

type ScenarioLanguage = 'es';

const ScenarioEventSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })
  .strict();

const ScenarioProposalSchema = z
  .object({
    name: z.string().trim().min(1),
    domains: z.array(z.string().trim().min(1)).min(1),
    events: z.array(ScenarioEventSchema).min(1),
    sagaSummary: z.string().trim().min(1),
    openQuestions: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

const DraftResponseSchema = z
  .object({
    proposal: ScenarioProposalSchema,
    modelNote: z.string().trim().min(1),
  })
  .strict();

type ScenarioProposal = z.infer<typeof ScenarioProposalSchema>;

type ModelDraftResponse = z.infer<typeof DraftResponseSchema>;

const ScenarioBootstrapEventSchema = z
  .object({
    eventName: z.string().trim().min(1),
    data: z.record(z.unknown()),
  })
  .passthrough();

const ScenarioBootstrapSchema = z
  .object({
    queue: z.string().trim().min(1),
    event: ScenarioBootstrapEventSchema,
  })
  .passthrough();

type ScenarioBootstrapExample = z.infer<typeof ScenarioBootstrapSchema>;

type ScenarioDraftHistoryEntry = {
  type: ScenarioDraftHistoryEntryType;
  userNote: string;
  modelNote: string;
  timestamp: string;
};

type GeneratedScenario = {
  content: Scenario;
  createdAt: string;
  bootstrapExample?: ScenarioBootstrapExample;
};

type ScenarioDraftStatus = 'draft' | 'ready';

type ScenarioDraft = {
  id: string;
  inputDescription: string;
  currentProposal: ScenarioProposal;
  history: ScenarioDraftHistoryEntry[];
  generatedScenario?: GeneratedScenario;
  status: ScenarioDraftStatus;
};

const drafts = new Map<string, ScenarioDraft>();

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirname = dirname(moduleFilename);

const scenarioDslReference = JSON.parse(
  readFileSync(
    resolve(moduleDirname, '../../..', 'business', 'retailer-happy-path.json'),
    'utf8',
  ),
) as Scenario;

const scenarioDslReferenceString = JSON.stringify(scenarioDslReference, null, 2);

const buildDraftSummary = (draft: ScenarioDraft) => {
  const hasGeneratedScenario = Boolean(draft.generatedScenario);
  let guidance = 'Genera el JSON del escenario cuando la propuesta esté lista.';

  if (hasGeneratedScenario && draft.status === 'draft') {
    guidance = 'Revisa el JSON generado y marca el borrador como listo cuando esté validado.';
  } else if (hasGeneratedScenario && draft.status === 'ready') {
    guidance = 'Este borrador está marcado como listo. Usa visualizer-api para aplicarlo.';
  }

  return {
    id: draft.id,
    status: draft.status,
    currentProposal: draft.currentProposal,
    hasGeneratedScenario,
    generatedScenarioPreview: draft.generatedScenario?.content,
    guidance,
  } as const;
};

const createDraftBodySchema = z
  .object({
    description: z.string().trim().min(1, 'description must not be empty'),
  })
  .strict();

const refineDraftBodySchema = z
  .object({
    feedback: z.string().trim().min(1, 'feedback must not be empty'),
  })
  .strict();

const generateJsonBodySchema = z
  .object({
    language: z.literal('es').optional(),
  })
  .strict()
  .optional();

class InvalidModelResponseError extends Error {}
class ScenarioBootstrapGenerationError extends Error {}
class ScenarioJsonValidationError extends Error {
  details: string[];

  constructor(details: string[]) {
    super('Invalid scenario JSON');
    this.details = details;
  }
}

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

try {
  ensureOpenAI();
} catch (error) {
  if (error instanceof ConfigurationError) {
    app.log.error({ err: error }, error.message);
    process.exit(1);
  }

  throw error;
}

const extractModelResponse = (content: string | null | undefined): ModelDraftResponse => {
  if (!content) {
    throw new InvalidModelResponseError('El modelo devolvió una respuesta vacía.');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new InvalidModelResponseError('La respuesta del modelo no se pudo interpretar como JSON.');
  }

  const validation = DraftResponseSchema.safeParse(parsed);
  if (!validation.success) {
    throw new InvalidModelResponseError('La respuesta del modelo no coincide con el esquema esperado.');
  }

  return validation.data;
};

const initialPrompt = (description: string): string =>
  `Eres un asistente especializado en diseñar borradores estructurados de escenarios retail para un equipo de ingeniería.

Lee la descripción proporcionada por la persona usuaria y genera un borrador organizado sin ejecutar acciones.

Sigue estas reglas de forma estricta:
- Propón únicamente un escenario.
- Mantén el nombre del escenario en kebab-case con palabras concisas.
- Sugiere entre 3 y 7 dominios de negocio relevantes.
- Sugiere entre 5 y 20 eventos clave en orden cronológico. Cada evento debe incluir un campo "title" breve y una "description" que explique por qué es importante.
- Escribe un campo sagaSummary de 2 a 4 frases que describa el flujo completo en lenguaje natural.
- Enumera openQuestions con los puntos que sigan poco claros. Usa un array vacío si todo está claro.
- No inventes endpoints de API, comandos ni esquemas JSON.
- No menciones la activación de escenarios ni la generación del JSON final.
- Responde únicamente con JSON.

Devuelve un objeto JSON con la estructura:
{
  "proposal": {
    "name": "nombre-en-kebab-case",
    "domains": ["dominio-1", "dominio-2"],
    "events": [
      { "title": "titulo-del-evento", "description": "explicación breve" }
    ],
    "sagaSummary": "resumen corto",
    "openQuestions": ["pregunta-uno"]
  },
  "modelNote": "Resumen breve de cómo interpretaste la descripción"
}

Descripción proporcionada por la persona usuaria:
"""
${description}
"""`.trim();

const refinementPrompt = (
  description: string,
  currentProposal: ScenarioProposal,
  feedback: string,
): string =>
  `Anteriormente propusiste el siguiente borrador de escenario para un flujo retail:
${JSON.stringify(currentProposal, null, 2)}

La descripción original de la persona usuaria fue:
"""
${description}
"""

La persona usuaria ha aportado nuevo feedback:
"""
${feedback}
"""

Actualiza la propuesta manteniendo la estructura consistente.

Sigue estas instrucciones con cuidado:
- Mantén los nombres de los campos idénticos a la estructura proporcionada.
- Conserva el nombre del escenario salvo que el feedback pida un cambio explícito.
- Ajusta dominios, eventos, sagaSummary y openQuestions para reflejar el feedback sin perder los aciertos previos.
- Mantén los eventos en orden cronológico y asegúrate de que cada uno incluya title y description.
- Responde únicamente con JSON en la misma estructura anterior, incluyendo un modelNote conciso que resuma los cambios.
- No generes JSON final para sistemas posteriores ni menciones la activación del escenario.`.trim();

const scenarioJsonPrompt = (draft: ScenarioDraft, language: ScenarioLanguage): string => {
  const proposalSummary = JSON.stringify(draft.currentProposal, null, 2);

  return `Genera la definición ejecutable del escenario retail en formato JSON.

Debes respetar estrictamente el DSL utilizado por nuestro runner. Usa únicamente las claves y estructuras que aparecen en el siguiente ejemplo real, ajustando los valores según la propuesta actual:
${scenarioDslReferenceString}

Instrucciones obligatorias:
- El objeto raíz debe incluir exactamente las propiedades name, version, domains, events y listeners.
- Cada dominio debe tener exclusivamente los campos "id" y "queue".
- Cada evento debe definir "name" y "payloadSchema".
- \`payloadSchema\` solo puede usar los tipos primitivos \`string\`, \`number\`, \`boolean\`, sus variantes en array (\`string[]\`, \`number[]\`, \`boolean[]\`) u objetos planos de un nivel. También se admiten arrays de objetos planos. Está prohibido anidar objetos más allá de un nivel o crear arrays de arrays.
- Utiliza \`payloadSchema: {}\` cuando un evento no requiera datos.
- Cada listener debe definir "id", "on" (con "event"), opcionalmente "delayMs" y la lista "actions". Las acciones solo pueden ser de tipo "emit" (event, toDomain) o "set-state" (domain, status).
- Cada acción "emit" debe incluir "mapping" siguiendo el DSL: escalares con alias o {"from"}, constantes con {"const"}, objetos planos con {"map": { ... }} y arrays de objetos con {"arrayFrom": ..., "map": { ... }}. Los arrays de primitivos solo admiten referencias directas.
- No añadas ninguna propiedad adicional (por ejemplo sagaSummary, openQuestions, subscribesTo, publishes, metadata ni explicaciones).
- Mantén la coherencia con los dominios y eventos descritos en la propuesta aprobada, adaptando nombres si el flujo lo requiere.
- Redacta todos los identificadores y estados en español cuando sea pertinente.
- Devuelve únicamente el JSON final sin comentarios ni texto adicional.

Descripción inicial del reto:
${draft.inputDescription}

Propuesta actual aprobada:
${proposalSummary}

Idioma objetivo para cualquier texto descriptivo: ${language}.`.trim();
};

const requestOpenAIContent = async (
  messages: ChatCompletionMessageParam[],
  temperature = 0.1,
): Promise<string> =>
  requestJsonContent({ messages, temperature });

const scenarioBootstrapPrompt = (scenario: Scenario): string => {
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
- Asegúrate de que los campos del objeto data respeten el \`payloadSchema\` definido para ese evento.
- No añadas explicaciones ni texto fuera del JSON.

Escenario de referencia:
${scenarioJson}`.trim();
};

const generateScenarioBootstrapExample = async (
  scenario: Scenario,
): Promise<ScenarioBootstrapExample> => {
  let response: string;

  try {
    response = await requestJsonContent({
      messages: [
        {
          role: 'system',
          content:
            'Responde siempre en español. Ajusta la salida al DSL de escenarios definido en este proyecto. No añadas texto fuera del JSON.',
        },
        { role: 'user', content: scenarioBootstrapPrompt(scenario) },
      ],
      temperature: 0.2,
    });
  } catch (error) {
    throw new ScenarioBootstrapGenerationError('No se pudo solicitar el bootstrap al modelo.');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(response);
  } catch (error) {
    throw new ScenarioBootstrapGenerationError('El bootstrap generado no es JSON válido.');
  }

  const validation = ScenarioBootstrapSchema.safeParse(parsed);

  if (!validation.success) {
    throw new ScenarioBootstrapGenerationError('El bootstrap generado no cumple los requisitos mínimos.');
  }

  return validation.data;
};

const formatIssuePath = (path: (string | number)[]): string =>
  path
    .map((segment) =>
      typeof segment === 'number' ? `[${segment}]` : (segment.includes('.') ? `['${segment}']` : `.${segment}`),
    )
    .join('')
    .replace(/^[.]/u, '');

const formatSchemaIssues = (issues: z.ZodIssue[]): string[] =>
  issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return path ? `${issue.message} (ruta: ${path})` : issue.message;
  });

type ScenarioValidationResult =
  | { type: 'ok'; scenario: Scenario }
  | { type: 'json-error'; details: string }
  | { type: 'schema-error'; issues: z.ZodIssue[] };

const evaluateScenarioResponse = (content: string): ScenarioValidationResult => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    return {
      type: 'json-error',
      details: 'La respuesta del modelo no es JSON válido.',
    };
  }

  const validation = scenarioSchema.safeParse(parsed);

  if (!validation.success) {
    return { type: 'schema-error', issues: validation.error.issues };
  }

  return { type: 'ok', scenario: validation.data };
};

const generateScenarioJson = async (
  draft: ScenarioDraft,
  language: ScenarioLanguage,
): Promise<Scenario> => {
  const systemMessage: ChatCompletionMessageParam = {
    role: 'system',
    content:
      'Responde siempre en español. Ajusta la salida al DSL de escenarios definido en este proyecto. No añadas texto fuera del JSON.',
  };

  const baseMessages: ChatCompletionMessageParam[] = [
    systemMessage,
    { role: 'user', content: scenarioJsonPrompt(draft, language) },
  ];

  let firstResponse: string;

  try {
    firstResponse = await requestOpenAIContent(baseMessages);
  } catch (error) {
    throw new OpenAIRequestFailedError('No se pudo obtener una respuesta del modelo.');
  }

  const firstEvaluation = evaluateScenarioResponse(firstResponse);

  if (firstEvaluation.type === 'ok') {
    return firstEvaluation.scenario;
  }

  const correctionMessage: string =
    firstEvaluation.type === 'json-error'
      ? 'La respuesta anterior no es JSON válido. Devuelve únicamente el JSON corregido con el DSL indicado.'
      : [
          'La respuesta anterior no cumple el DSL del escenario. Corrige los siguientes problemas sin añadir campos nuevos:',
          ...formatSchemaIssues(firstEvaluation.issues).map((detail) => `- ${detail}`),
          'Responde exclusivamente con el JSON corregido.',
        ].join('\n');

  const retryMessages: ChatCompletionMessageParam[] = [
    ...baseMessages,
    { role: 'assistant', content: firstResponse },
    { role: 'user', content: correctionMessage },
  ];

  let secondResponse: string;

  try {
    secondResponse = await requestOpenAIContent(retryMessages);
  } catch (error) {
    throw new OpenAIRequestFailedError('No se pudo corregir la respuesta del modelo.');
  }

  const secondEvaluation = evaluateScenarioResponse(secondResponse);

  if (secondEvaluation.type === 'ok') {
    return secondEvaluation.scenario;
  }

  if (secondEvaluation.type === 'json-error') {
    throw new ScenarioJsonValidationError([secondEvaluation.details]);
  }

  throw new ScenarioJsonValidationError(formatSchemaIssues(secondEvaluation.issues));
};

const callOpenAI = async (prompt: string): Promise<ModelDraftResponse> => {
  try {
    const content = await requestJsonContent({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    return extractModelResponse(content);
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof InvalidModelResponseError) {
      throw error;
    }

    if (error instanceof OpenAIRequestFailedError) {
      app.log.error({ err: error }, 'Fallo en la petición a OpenAI');
      throw new InvalidModelResponseError('La solicitud al modelo falló de forma inesperada.');
    }

    app.log.error({ err: error }, 'Fallo en la petición a OpenAI');
    throw new InvalidModelResponseError('La solicitud al modelo falló de forma inesperada.');
  }
};

const handleModelError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof ConfigurationError) {
    return reply.status(500).send({ message: error.message });
  }

  if (error instanceof InvalidModelResponseError) {
    return reply.status(502).send({ message: error.message });
  }

  app.log.error({ err: error }, 'Error inesperado al manejar la respuesta del modelo');
  return reply
    .status(502)
    .send({ message: 'No se pudo generar la propuesta del escenario.' });
};

app.post<{ Body: unknown }>('/scenario-drafts', async (request, reply) => {
  const parsedBody = createDraftBodySchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply
      .status(400)
      .send({ message: 'Cuerpo de la solicitud inválido.', issues: parsedBody.error.issues });
  }

  const { description } = parsedBody.data;

  try {
    const modelResponse = await callOpenAI(initialPrompt(description));

    const draft: ScenarioDraft = {
      id: randomUUID(),
      inputDescription: description,
      currentProposal: modelResponse.proposal,
      history: [
        {
          type: 'initial',
          userNote: description,
          modelNote: modelResponse.modelNote,
          timestamp: new Date().toISOString(),
        },
      ],
      status: 'draft',
    };

    drafts.set(draft.id, draft);

    return reply.status(201).send(draft);
  } catch (error) {
    return handleModelError(error, reply);
  }
});

app.post<{ Params: DraftParams; Body: unknown }>('/scenario-drafts/:id/refine', async (request, reply) => {
  const { id } = request.params;
  const parsedBody = refineDraftBodySchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply
      .status(400)
      .send({ message: 'Cuerpo de la solicitud inválido.', issues: parsedBody.error.issues });
  }

  const draft = drafts.get(id);

  if (!draft) {
    return reply
      .status(404)
      .send({ message: 'No se encontró el borrador del escenario.' });
  }

  const { feedback } = parsedBody.data;

  try {
    const modelResponse = await callOpenAI(refinementPrompt(draft.inputDescription, draft.currentProposal, feedback));

    draft.currentProposal = modelResponse.proposal;
    draft.generatedScenario = undefined;
    draft.status = 'draft';
    draft.history.push({
      type: 'refinement',
      userNote: feedback,
      modelNote: modelResponse.modelNote,
      timestamp: new Date().toISOString(),
    });

    return reply.send(draft);
  } catch (error) {
    return handleModelError(error, reply);
  }
});

app.post<{ Params: DraftParams; Body: unknown }>('/scenario-drafts/:id/generate-json', async (request, reply) => {
  const { id } = request.params;
  const parsedBody = generateJsonBodySchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply
      .status(400)
      .send({ message: 'Cuerpo de la solicitud inválido.', issues: parsedBody.error.issues });
  }

  const draft = drafts.get(id);

  if (!draft) {
    return reply
      .status(404)
      .send({ message: 'No se encontró el borrador del escenario.' });
  }

  const language: ScenarioLanguage = (parsedBody.data?.language ?? 'es') as ScenarioLanguage;

  try {
    const scenarioJson = await generateScenarioJson(draft, language);

    let bootstrapExample: ScenarioBootstrapExample | undefined;

    try {
      bootstrapExample = await generateScenarioBootstrapExample(scenarioJson);
    } catch (error) {
      if (error instanceof ScenarioBootstrapGenerationError) {
        app.log.warn({ err: error }, 'No se pudo generar bootstrap para el escenario.');
      } else {
        app.log.warn({ err: error }, 'Error inesperado generando bootstrap para el escenario.');
      }
    }

    draft.generatedScenario = {
      content: scenarioJson,
      createdAt: new Date().toISOString(),
      ...(bootstrapExample ? { bootstrapExample } : {}),
    };
    draft.status = 'draft';

    return reply.send({
      id: draft.id,
      status: 'generated',
      generatedScenario: scenarioJson,
    });
  } catch (error) {
    if (error instanceof ScenarioJsonValidationError) {
      return reply
        .status(400)
        .send({ error: 'invalid_scenario_json', details: error.details });
    }

    if (error instanceof OpenAIRequestFailedError) {
      return reply
        .status(502)
        .send({ error: 'openai_request_failed', message: error.message });
    }

    app.log.error({ err: error }, 'Error al generar el JSON del escenario');
    return reply
      .status(502)
      .send({
        error: 'openai_request_failed',
        message: 'No se pudo generar el JSON del escenario.',
      });
  }
});

app.get<{ Params: DraftParams }>('/scenario-drafts/:id/summary', async (request, reply) => {
  const { id } = request.params;
  const draft = drafts.get(id);

  if (!draft) {
    return reply
      .status(404)
      .send({ error: 'draft_not_found', message: 'No se encontró el borrador del escenario.' });
  }

  return reply.send(buildDraftSummary(draft));
});

app.post<{ Params: DraftParams }>('/scenario-drafts/:id/mark-ready', async (request, reply) => {
  const { id } = request.params;
  const draft = drafts.get(id);

  if (!draft) {
    return reply
      .status(404)
      .send({ error: 'draft_not_found', message: 'No se encontró el borrador del escenario.' });
  }

  if (!draft.generatedScenario) {
    return reply.status(400).send({
      error: 'scenario_not_generated',
      message: 'Genera el JSON del escenario antes de marcar el borrador como listo.',
    });
  }

  draft.status = 'ready';

  return reply.send({ id: draft.id, status: draft.status });
});

app.get<{ Params: DraftParams }>('/scenario-drafts/:id', async (request, reply) => {
  const { id } = request.params;
  const draft = drafts.get(id);

  if (!draft) {
    return reply
      .status(404)
      .send({ message: 'No se encontró el borrador del escenario.' });
  }

  return reply.send(draft);
});

app.get<{ Params: DraftParams }>('/scenario-drafts/:id/json', async (request, reply) => {
  const { id } = request.params;
  const draft = drafts.get(id);

  if (!draft) {
    return reply
      .status(404)
      .send({ message: 'No se encontró el borrador del escenario.' });
  }

  if (!draft.generatedScenario) {
    return reply
      .status(404)
      .send({ message: 'No se encontró JSON generado para este borrador.' });
  }

  return reply.send(draft.generatedScenario.content);
});

app.get('/health', async (_request, reply) => {
  return reply.send({ ok: true });
});

const port = Number(process.env.PORT) || 3201;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`[scenario-designer] listening on http://localhost:${port}`);
} catch (error) {
  app.log.error({ err: error }, 'No se pudo iniciar scenario-designer');
  process.exit(1);
}
