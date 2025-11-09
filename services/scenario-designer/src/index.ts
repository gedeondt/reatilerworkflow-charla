import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ConfigurationError,
  OpenAIRequestFailedError,
  ensureOpenAI,
  requestJsonContent,
  type ChatCompletionMessageParam,
} from './openaiClient.js';

type DraftParams = { id: string };

type ScenarioDraftHistoryEntryType = 'initial' | 'refinement';

type ScenarioJson = Record<string, unknown>;

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

type ScenarioDraftHistoryEntry = {
  type: ScenarioDraftHistoryEntryType;
  userNote: string;
  modelNote: string;
  timestamp: string;
};

type GeneratedScenario = {
  content: ScenarioJson;
  createdAt: string;
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

const initialPrompt = (description: string): string => `Eres un asistente especializado en diseñar borradores estructurados de escenarios retail para un equipo de ingeniería.

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
"""`;

const refinementPrompt = (
  description: string,
  currentProposal: ScenarioProposal,
  feedback: string,
): string => `Anteriormente propusiste el siguiente borrador de escenario para un flujo retail:
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
- No generes JSON final para sistemas posteriores ni menciones la activación del escenario.`;

const scenarioJsonPrompt = (draft: ScenarioDraft, language: ScenarioLanguage): string => {
  const proposalSummary = JSON.stringify(draft.currentProposal, null, 2);
  const baseSchema = JSON.stringify(
    {
      name: 'Retailer Happy Path Saga',
      version: 1,
      domains: [{ id: 'order', queue: 'orders' }],
      events: [{ name: 'OrderPlaced' }],
      listeners: [
        {
          id: 'example',
          on: { event: 'OrderPlaced' },
          actions: [
            { type: 'emit', event: 'AnotherEvent', toDomain: 'order' },
            { type: 'set-state', domain: 'order', status: 'COMPLETED' },
          ],
        },
      ],
    },
    null,
    2,
  );

  return [
    'Genera un escenario JSON listo para ser usado por el runner interno.',
    'Utiliza exclusivamente el idioma español en descripciones dentro del JSON.',
    `Descripción inicial del reto:\n${draft.inputDescription}`,
    `Propuesta actual aprobada:\n${proposalSummary}`,
    'Reglas imprescindibles:',
    '- Produce un único objeto JSON válido que siga la estructura general del escenario base.',
    '- Respeta la coherencia con los dominios y eventos de la propuesta actual, ajustando nombres cuando sea necesario.',
    '- Cada dominio debe declarar de forma explícita cómo interactúa (por ejemplo, subscribesTo, publishes u otras claves equivalentes del DSL).',
    '- Incluye listeners que conecten los eventos relevantes y mantengan la narrativa completa.',
    '- Solo usa delayMs cuando sea imprescindible para la claridad del flujo.',
    '- No añadas texto fuera del JSON, ni comentarios, ni explicaciones adicionales.',
    'Esquema de referencia (no lo copies literal, úsalo como guía de campos admitidos):',
    baseSchema,
    `Idioma objetivo: ${language}.`,
    'Devuelve únicamente el JSON final sin envoltorios adicionales.',
  ].join('\n\n');
};

const requestOpenAIContent = async (
  messages: ChatCompletionMessageParam[],
  temperature = 0.1,
): Promise<string> =>
  requestJsonContent({ messages, temperature });

const domainHasInteraction = (domain: Record<string, unknown>): boolean => {
  const interactionKeys = [
    'subscribesTo',
    'publishes',
    'emits',
    'consumes',
    'produces',
    'commands',
    'events',
  ];

  return interactionKeys.some((key) => {
    const candidate = domain[key];
    return Array.isArray(candidate) && candidate.length > 0;
  });
};

const validateScenarioJson = (payload: unknown): string[] => {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    errors.push('La respuesta del modelo debe ser un objeto JSON en la raíz.');
    return errors;
  }

  const root = payload as Record<string, unknown>;

  if (typeof root.name !== 'string' || root.name.trim().length === 0) {
    errors.push('El campo "name" debe ser un texto no vacío.');
  }

  if (typeof root.version !== 'number') {
    errors.push('El campo "version" debe ser un número.');
  }

  if (!('domains' in root)) {
    errors.push('Debe existir la propiedad "domains".');
    return errors;
  }

  const domainsValue = root.domains;

  if (Array.isArray(domainsValue)) {
    if (domainsValue.length === 0) {
      errors.push('La lista de dominios no puede estar vacía.');
    }

    domainsValue.forEach((domain, index) => {
      if (!domain || typeof domain !== 'object' || Array.isArray(domain)) {
        errors.push(`El dominio en la posición ${index} debe ser un objeto.`);
        return;
      }

      const domainRecord = domain as Record<string, unknown>;
      const id = domainRecord.id;

      if (typeof id !== 'string' || id.trim().length === 0) {
        errors.push(`El dominio en la posición ${index} debe tener un "id" de texto.`);
      }

      if (!domainHasInteraction(domainRecord)) {
        errors.push(
          `El dominio "${typeof id === 'string' ? id : index}" debe declarar interacciones (subscribesTo/publishes/etc.).`,
        );
      }
    });
  } else if (domainsValue && typeof domainsValue === 'object') {
    const entries = Object.entries(domainsValue as Record<string, unknown>);

    if (entries.length === 0) {
      errors.push('La definición de dominios no puede estar vacía.');
    }

    entries.forEach(([domainId, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`El dominio "${domainId}" debe ser un objeto.`);
        return;
      }

      if (!domainHasInteraction(value as Record<string, unknown>)) {
        errors.push(`El dominio "${domainId}" debe declarar interacciones (subscribesTo/publishes/etc.).`);
      }
    });
  } else {
    errors.push('El campo "domains" debe ser un objeto o una lista de objetos.');
  }

  if ('events' in root && !Array.isArray(root.events)) {
    errors.push('El campo "events" debe ser una lista si está presente.');
  }

  if ('listeners' in root && !Array.isArray(root.listeners)) {
    errors.push('El campo "listeners" debe ser una lista si está presente.');
  }

  return errors;
};

const parseJson = (content: string): unknown => {
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    const syntaxError = new Error('invalid json');
    (syntaxError as { cause?: unknown }).cause = error;
    throw syntaxError;
  }
};

const generateScenarioJson = async (draft: ScenarioDraft, language: ScenarioLanguage) => {
  const systemMessage: ChatCompletionMessageParam = {
    role: 'system',
    content:
      'Eres un asistente experto en retail que genera escenarios compatibles con el runner interno. Responde siempre con JSON válido sin texto adicional.',
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

  let parsed: unknown;

  try {
    parsed = parseJson(firstResponse);
  } catch {
    const retryMessages: ChatCompletionMessageParam[] = [
      ...baseMessages,
      { role: 'assistant', content: firstResponse },
      {
        role: 'user',
        content: 'La respuesta anterior no es JSON válido. Responde únicamente con el JSON corregido.',
      },
    ];

    let secondResponse: string;

    try {
      secondResponse = await requestOpenAIContent(retryMessages);
    } catch (error) {
      throw new OpenAIRequestFailedError('No se pudo corregir la respuesta del modelo.');
    }

    try {
      parsed = parseJson(secondResponse);
    } catch {
      throw new OpenAIRequestFailedError('El modelo devolvió una respuesta inválida tras el reintento.');
    }
  }

  const validationErrors = validateScenarioJson(parsed);

  if (validationErrors.length > 0) {
    throw new ScenarioJsonValidationError(validationErrors);
  }

  return parsed as ScenarioJson;
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

    draft.generatedScenario = {
      content: scenarioJson,
      createdAt: new Date().toISOString(),
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
