import Fastify, { type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

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

type ScenarioDraftHistoryEntry = {
  type: ScenarioDraftHistoryEntryType;
  userNote: string;
  modelNote: string;
  timestamp: string;
};

type ScenarioDraft = {
  id: string;
  inputDescription: string;
  currentProposal: ScenarioProposal;
  history: ScenarioDraftHistoryEntry[];
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

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

class ConfigurationError extends Error {}
class InvalidModelResponseError extends Error {}

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const openaiClient = (() => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    app.log.warn('OPENAI_API_KEY is not set. Scenario proposals cannot be generated.');
    return null;
  }

  return new OpenAI({ apiKey });
})();

const ensureOpenAI = (): OpenAI => {
  if (!openaiClient) {
    throw new ConfigurationError('OpenAI API key is not configured for scenario-designer.');
  }

  return openaiClient;
};

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

app.get<{ Params: DraftParams }>('/scenario-drafts/:id', async (request, reply) => {
  const { id } = request.params;
  const draft = drafts.get(id);

  if (!draft) {
    return reply.status(404).send({ message: 'Scenario draft not found.' });
  }

  return reply.send(draft);
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
