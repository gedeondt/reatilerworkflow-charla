import OpenAI from 'openai';

export type ChatCompletionMessageParam =
  OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatCompletionResponseFormat =
  OpenAI.Chat.Completions.ChatCompletionCreateParams['response_format'];

export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o';

const SYSTEM_MESSAGE =
  'Responde siempre en español. Ajusta la salida al DSL de escenarios definido en este proyecto. No añadas texto fuera del JSON.';

export class ConfigurationError extends Error {}
export class OpenAIRequestFailedError extends Error {}

let cachedClient: OpenAI | null = null;

const createOpenAIClient = (): OpenAI => {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new ConfigurationError(
      'OPENAI_API_KEY es obligatorio para iniciar scenario-designer.',
    );
  }

  return new OpenAI({ apiKey });
};

export const ensureOpenAI = (): OpenAI => {
  if (!cachedClient) {
    cachedClient = createOpenAIClient();
  }

  return cachedClient;
};

export type RequestJsonContentOptions = {
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  responseFormat?: ChatCompletionResponseFormat;
  model?: string;
};

export const requestJsonContent = async ({
  messages,
  temperature = 0.2,
  responseFormat = { type: 'json_object' },
  model = OPENAI_MODEL,
}: RequestJsonContentOptions): Promise<string> => {
  const client = ensureOpenAI();

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature,
      response_format: responseFormat,
      messages: [{ role: 'system', content: SYSTEM_MESSAGE }, ...messages],
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

    throw new OpenAIRequestFailedError(
      'No se pudo completar la solicitud a OpenAI.',
    );
  }
};
