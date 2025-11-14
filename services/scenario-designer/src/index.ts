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
import {
  validateScenario,
  type ScenarioContract,
} from './domain/validateScenario.js';
import {
  scenarioBootstrapPrompt,
  scenarioDslRules,
  scenarioJsonPrompt,
  scenarioJsonRetryPrompt,
  type ScenarioLanguage,
} from './scenarioPrompts.js';

type DraftParams = { id: string };

type ScenarioDraftHistoryEntryType = 'initial' | 'refinement';

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

type GeneratedScenarioRecord = {
  scenario: ScenarioContract;
  createdAt: string;
  bootstrapExample?: ScenarioBootstrapExample;
};

type ScenarioDraftStatus = 'draft' | 'ready';

type ScenarioDraft = {
  id: string;
  inputDescription: string;
  currentProposal: ScenarioProposal;
  history: ScenarioDraftHistoryEntry[];
  generatedScenario?: GeneratedScenarioRecord;
  status: ScenarioDraftStatus;
};

const drafts = new Map<string, ScenarioDraft>();

const buildJsonGenerationPrompt = (
  draft: ScenarioDraft,
  language: ScenarioLanguage,
): string => {
  return scenarioJsonPrompt(
    {
      inputDescription: draft.inputDescription,
      currentProposal: draft.currentProposal,
    },
    language,
  );
};

const jsonPromptQuerySchema = z
  .object({
    language: z.literal('es').optional(),
  })
  .strict()
  .optional();

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
    generatedScenarioPreview: draft.generatedScenario?.scenario,
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

const requestOpenAIContent = async (
  messages: ChatCompletionMessageParam[],
  temperature = 0.1,
): Promise<string> =>
  requestJsonContent({ messages, temperature });

const generateScenarioBootstrapExample = async (
  scenario: ScenarioContract,
): Promise<ScenarioBootstrapExample | null> => {
  try {
    const response = await requestJsonContent({
      messages: [
        {
          role: 'system',
          content: [
            'Eres un asistente que genera eventos iniciales para ejecutar SAGA.',
            'Responde siempre en español y devuelve únicamente JSON válido.',
          ].join('\n'),
        },
        { role: 'user', content: scenarioBootstrapPrompt(scenario) },
      ],
      temperature: 0.2,
    });

    const parsed = JSON.parse(response) as unknown;
    const validation = ScenarioBootstrapSchema.safeParse(parsed);

    if (!validation.success) {
      app.log.warn(
        { errors: validation.error.issues.map((issue) => issue.message) },
        'invalid bootstrap example generated',
      );
      return null;
    }

    return validation.data;
  } catch (error) {
    app.log.warn({ err: error }, 'failed to generate scenario bootstrap example');
    return null;
  }
};

type GenerateScenarioJsonOk = {
  ok: true;
  scenario: ScenarioContract;
};

type GenerateScenarioJsonError = {
  ok: false;
  errors: string[];
  rawScenario: unknown;
  response: string;
};

type GenerateScenarioJsonResult = GenerateScenarioJsonOk | GenerateScenarioJsonError;

const interpretModelResponse = (response: string): GenerateScenarioJsonResult => {
  const validation = validateScenario(response);

  if (validation.ok) {
    return { ok: true, scenario: validation.scenario };
  }

  return {
    ok: false,
    errors: validation.errors,
    rawScenario: validation.rawScenario,
    response,
  };
};

const generateScenarioJson = async (
  draft: ScenarioDraft,
  language: ScenarioLanguage,
): Promise<GenerateScenarioJsonResult> => {
  const systemMessage: ChatCompletionMessageParam = {
    role: 'system',
    content: [
      'Eres un asistente que genera definiciones de SAGA JSON ejecutables.',
      'Debes seguir estrictamente las siguientes reglas:',
      scenarioDslRules,
    ].join('\n'),
  };

  const baseMessages: ChatCompletionMessageParam[] = [
    systemMessage,
    { role: 'user', content: buildJsonGenerationPrompt(draft, language) },
  ];

  const firstResponse = await requestOpenAIContent(baseMessages);
  const firstInspection = interpretModelResponse(firstResponse);

  if (firstInspection.ok) {
    return firstInspection;
  }

  const retryMessages: ChatCompletionMessageParam[] = [
    ...baseMessages,
    { role: 'assistant', content: firstResponse },
    {
      role: 'user',
      content: scenarioJsonRetryPrompt({
        draftDescription: draft.inputDescription,
        proposal: draft.currentProposal,
        language,
        previousResponse: firstResponse,
        errors: firstInspection.errors,
      }),
    },
  ];

  const secondResponse = await requestOpenAIContent(retryMessages);
  const secondInspection = interpretModelResponse(secondResponse);

  if (secondInspection.ok) {
    return secondInspection;
  }

  return secondInspection;
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
    const result = await generateScenarioJson(draft, language);

    if (!result.ok) {
      request.log.error(
        {
          draftId: id,
          errors: result.errors,
          rawScenario: result.rawScenario,
        },
        'generated scenario invalid',
      );

      return reply.status(422).send({
        status: 'error',
        draftId: id,
        errors: result.errors,
        message: 'El escenario generado no cumple el DSL de saga-kernel.',
      });
    }

    const scenario = result.scenario;
    let bootstrapExample: ScenarioBootstrapExample | null = null;

    try {
      bootstrapExample = await generateScenarioBootstrapExample(scenario);
    } catch (err) {
      request.log.warn({ err }, 'failed to generate bootstrap example');
    }

    const generatedScenario: GeneratedScenarioRecord = {
      scenario,
      createdAt: new Date().toISOString(),
      ...(bootstrapExample ? { bootstrapExample } : {}),
    };

    draft.generatedScenario = generatedScenario;
    draft.status = 'draft';

    return reply.send({
      id: draft.id,
      status: 'ok',
      generatedScenario: scenario,
      bootstrapExample: bootstrapExample ?? undefined,
      createdAt: generatedScenario.createdAt,
    });
  } catch (error) {
    if (error instanceof OpenAIRequestFailedError) {
      return reply.status(502).send({ error: 'openai_request_failed', message: error.message });
    }

    request.log.error({ err: error }, 'Error al generar el JSON del escenario');
    return reply
      .status(502)
      .send({
        error: 'openai_request_failed',
        message: 'No se pudo generar el JSON del escenario.',
      });
  }
});

app.get<{ Params: DraftParams; Querystring: { language?: string } }>(
  '/scenario-drafts/:id/json-prompt',
  async (request, reply) => {
    const { id } = request.params;
    const draft = drafts.get(id);

    if (!draft) {
      return reply
        .status(404)
        .send({ message: 'No se encontró el borrador del escenario.' });
    }

    const parsedQuery = jsonPromptQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply
        .status(400)
        .send({ message: 'Parámetros inválidos.', issues: parsedQuery.error.issues });
    }

    const language: ScenarioLanguage = (parsedQuery.data?.language ?? 'es') as ScenarioLanguage;

    try {
      const prompt = buildJsonGenerationPrompt(draft, language);
      return reply.send({
        draftId: id,
        prompt,
        language,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      request.log.error({ err: error, draftId: id }, 'failed to build JSON prompt');
      return reply.status(500).send({
        error: 'prompt_generation_failed',
        message: 'No se pudo preparar el prompt del escenario.',
      });
    }
  },
);

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

  return reply.send(draft.generatedScenario.scenario);
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
