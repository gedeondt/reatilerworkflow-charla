import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

type DraftParams = { id: string };

type ScenarioDraftHistoryEntryType = 'initial' | 'refinement';

type ScenarioJson = Record<string, unknown>;

type ScenarioLanguage = 'es';

type ChatCompletionMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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

type ScenarioDraft = {
  id: string;
  inputDescription: string;
  currentProposal: ScenarioProposal;
  history: ScenarioDraftHistoryEntry[];
  generatedScenario?: GeneratedScenario;
};

const drafts = new Map<string, ScenarioDraft>();

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

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

class ConfigurationError extends Error {}
class InvalidModelResponseError extends Error {}
class ScenarioJsonValidationError extends Error {
  details: string[];

  constructor(details: string[]) {
    super('Invalid scenario JSON');
    this.details = details;
  }
}

class OpenAIRequestFailedError extends Error {}

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const createOpenAIClient = (): OpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new ConfigurationError(
      'OPENAI_API_KEY es obligatorio para iniciar scenario-designer.',
    );
  }

  return new OpenAI({ apiKey });
};

const openaiClient = (() => {
  try {
    return createOpenAIClient();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      app.log.error({ err: error }, error.message);
      process.exit(1);
    }

    throw error;
  }
})();

const ensureOpenAI = (): OpenAI => openaiClient;

const extractModelResponse = (content: string | null | undefined): ModelDraftResponse => {
  if (!content) {
    throw new InvalidModelResponseError('Model returned an empty response.');
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new InvalidModelResponseError('Model response could not be parsed as JSON.');
  }

  const validation = DraftResponseSchema.safeParse(parsed);
  if (!validation.success) {
    throw new InvalidModelResponseError('Model response did not match the expected schema.');
  }

  return validation.data;
};

const initialPrompt = (description: string): string => `You are an assistant that designs high-level retail scenarios for an engineering team.

Read the user's description and produce a structured draft without taking any action.

Follow these rules strictly:
- Only propose a single scenario.
- Keep the scenario name in kebab-case with concise wording.
- Suggest between 3 and 7 relevant business domains.
- Suggest between 5 and 20 key events in chronological order. Each event must include a short "title" and a "description" explaining why it matters.
- Write a short sagaSummary (2-4 sentences) that explains the flow end-to-end in natural language.
- List openQuestions capturing unclear requirements. Use an empty array when everything is clear.
- Do not invent API endpoints, commands, or JSON schemas.
- Never mention activating scenarios or generating final JSON.
- Respond only with JSON.

Return a JSON object that matches this structure:
{
  "proposal": {
    "name": "kebab-case-name",
    "domains": ["domain-1", "domain-2"],
    "events": [
      { "title": "event-title", "description": "brief explanation" }
    ],
    "sagaSummary": "short overview",
    "openQuestions": ["question-one"]
  },
  "modelNote": "Short summary of how you interpreted the description"
}

User description:
"""
${description}
"""`;

const refinementPrompt = (
  description: string,
  currentProposal: ScenarioProposal,
  feedback: string,
): string => `You previously proposed the following scenario draft for a retail workflow:
${JSON.stringify(currentProposal, null, 2)}

The original description from the user was:
"""
${description}
"""

The user has provided new feedback:
"""
${feedback}
"""

Update the proposal while keeping the structure consistent.

Apply these instructions carefully:
- Keep field names identical to the provided structure.
- Preserve the existing scenario name unless the feedback explicitly requests a rename.
- Adjust domains, events, sagaSummary, and openQuestions to reflect the feedback without losing previously valid insights.
- Maintain chronological ordering of events and make sure each has a title and description.
- Respond only with JSON in the same structure as before, including a concise modelNote summarising the changes.
- Do not generate any final JSON for downstream systems or mention activating scenarios.`;

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
): Promise<string> => {
  const client = ensureOpenAI();

  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages,
    });

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new OpenAIRequestFailedError('La respuesta del modelo estuvo vacía.');
    }

    return content;
  } catch (error) {
    if (error instanceof OpenAIRequestFailedError) {
      throw error;
    }

    throw new OpenAIRequestFailedError('No se pudo completar la solicitud a OpenAI.');
  }
};

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
  const client = ensureOpenAI();

  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a focused assistant that proposes structured drafts for retail workflow scenarios. Keep responses deterministic and format them as strict JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    return extractModelResponse(content);
  } catch (error) {
    if (error instanceof ConfigurationError || error instanceof InvalidModelResponseError) {
      throw error;
    }

    app.log.error({ err: error }, 'OpenAI request failed');
    throw new InvalidModelResponseError('Model request failed unexpectedly.');
  }
};

const handleModelError = (error: unknown, reply: FastifyReply) => {
  if (error instanceof ConfigurationError) {
    return reply.status(500).send({ message: error.message });
  }

  if (error instanceof InvalidModelResponseError) {
    return reply.status(502).send({ message: error.message });
  }

  app.log.error({ err: error }, 'Unexpected error while handling model response');
  return reply.status(502).send({ message: 'Failed to generate scenario proposal.' });
};

app.post<{ Body: unknown }>('/scenario-drafts', async (request, reply) => {
  const parsedBody = createDraftBodySchema.safeParse(request.body);

  if (!parsedBody.success) {
    return reply.status(400).send({ message: 'Invalid request body.', issues: parsedBody.error.issues });
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
    return reply.status(400).send({ message: 'Invalid request body.', issues: parsedBody.error.issues });
  }

  const draft = drafts.get(id);

  if (!draft) {
    return reply.status(404).send({ message: 'Scenario draft not found.' });
  }

  const { feedback } = parsedBody.data;

  try {
    const modelResponse = await callOpenAI(refinementPrompt(draft.inputDescription, draft.currentProposal, feedback));

    draft.currentProposal = modelResponse.proposal;
    draft.generatedScenario = undefined;
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
      .send({ message: 'Invalid request body.', issues: parsedBody.error.issues });
  }

  const draft = drafts.get(id);

  if (!draft) {
    return reply.status(404).send({ message: 'Scenario draft not found.' });
  }

  const language: ScenarioLanguage = (parsedBody.data?.language ?? 'es') as ScenarioLanguage;

  try {
    const scenarioJson = await generateScenarioJson(draft, language);

    draft.generatedScenario = {
      content: scenarioJson,
      createdAt: new Date().toISOString(),
    };

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

    app.log.error({ err: error }, 'Failed to generate scenario JSON');
    return reply
      .status(502)
      .send({
        error: 'openai_request_failed',
        message: 'No se pudo generar el JSON del escenario.',
      });
  }
});

app.get<{ Params: DraftParams }>('/scenario-drafts/:id', async (request, reply) => {
  const { id } = request.params;
  const draft = drafts.get(id);

  if (!draft) {
    return reply.status(404).send({ message: 'Scenario draft not found.' });
  }

  return reply.send(draft);
});

app.get<{ Params: DraftParams }>('/scenario-drafts/:id/json', async (request, reply) => {
  const { id } = request.params;
  const draft = drafts.get(id);

  if (!draft) {
    return reply.status(404).send({ message: 'Scenario draft not found.' });
  }

  if (!draft.generatedScenario) {
    return reply
      .status(404)
      .send({ message: 'Generated scenario JSON not found for this draft.' });
  }

  return reply.send(draft.generatedScenario.content);
});

app.get('/health', async (_request, reply) => {
  return reply.send({ ok: true });
});

const port = Number(process.env.PORT) || 3400;

try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ port }, 'scenario-designer listening');
} catch (error) {
  app.log.error({ err: error }, 'Failed to start scenario-designer');
  process.exit(1);
}
