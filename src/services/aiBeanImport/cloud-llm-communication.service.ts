import { CLOUD_AI_PROVIDER_ENUM } from '../../enums/settings/cloudAiProvider';

export interface CloudLLMConfig {
  provider: CLOUD_AI_PROVIDER_ENUM;
  apiKey: string;
  model: string;
  baseUrl?: string; // for CUSTOM provider
}

export interface CloudLLMMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CloudLLMResponse {
  content: string;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function getBaseUrl(
  provider: CLOUD_AI_PROVIDER_ENUM,
  customUrl?: string,
): string {
  switch (provider) {
    case CLOUD_AI_PROVIDER_ENUM.OPENAI:
      return 'https://api.openai.com/v1';
    case CLOUD_AI_PROVIDER_ENUM.GOOGLE:
      return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case CLOUD_AI_PROVIDER_ENUM.ANTHROPIC:
      return 'https://api.anthropic.com/v1';
    case CLOUD_AI_PROVIDER_ENUM.MISTRAL:
      return 'https://api.mistral.ai/v1';
    case CLOUD_AI_PROVIDER_ENUM.OPENROUTER:
      return 'https://openrouter.ai/api/v1';
    case CLOUD_AI_PROVIDER_ENUM.CUSTOM:
      return (customUrl ?? '').replace(/\/+$/, '');
    default:
      return '';
  }
}

function buildHeaders(
  provider: CLOUD_AI_PROVIDER_ENUM,
  apiKey: string,
): Record<string, string> {
  if (provider === CLOUD_AI_PROVIDER_ENUM.ANTHROPIC) {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === CLOUD_AI_PROVIDER_ENUM.OPENROUTER) {
    headers['HTTP-Referer'] = 'https://beanconqueror.com';
    headers['X-OpenRouter-Title'] = 'Beanconqueror';
  }
  return headers;
}

function buildRequestBody(
  provider: CLOUD_AI_PROVIDER_ENUM,
  model: string,
  messages: CloudLLMMessage[],
): object {
  if (provider === CLOUD_AI_PROVIDER_ENUM.ANTHROPIC) {
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsgs = messages.filter((m) => m.role !== 'system');
    return {
      model,
      max_tokens: 4096,
      temperature: 0.1,
      system: systemMsg?.content ?? '',
      messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
    };
  }
  return {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.1,
  };
}

function getEndpointPath(provider: CLOUD_AI_PROVIDER_ENUM): string {
  if (provider === CLOUD_AI_PROVIDER_ENUM.ANTHROPIC) return '/messages';
  return '/chat/completions';
}

interface AnthropicApiResponse {
  content?: Array<{ text?: string }>;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

interface OpenAIApiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

function parseResponse(
  provider: CLOUD_AI_PROVIDER_ENUM,
  body: unknown,
): CloudLLMResponse {
  if (provider === CLOUD_AI_PROVIDER_ENUM.ANTHROPIC) {
    const data = body as AnthropicApiResponse;
    return {
      content: data.content?.[0]?.text ?? '',
      model: data.model ?? '',
      usage: data.usage
        ? {
            prompt_tokens: data.usage.input_tokens,
            completion_tokens: data.usage.output_tokens,
          }
        : undefined,
    };
  }
  const data = body as OpenAIApiResponse;
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: data.model ?? '',
    usage: data.usage,
  };
}

/**
 * Send a prompt to a cloud LLM provider and return the response.
 * Handles URL construction, headers, request body formatting, and response parsing
 * for all supported providers.
 *
 * @param config Provider configuration (provider, apiKey, model, optional baseUrl)
 * @param messages Array of system/user messages to send
 * @returns Parsed response with content, model, and optional usage stats
 */
export async function sendCloudLLMPrompt(
  config: CloudLLMConfig,
  messages: CloudLLMMessage[],
): Promise<CloudLLMResponse> {
  const url =
    getBaseUrl(config.provider, config.baseUrl) +
    getEndpointPath(config.provider);
  const headers = buildHeaders(config.provider, config.apiKey);
  const requestBody = buildRequestBody(config.provider, config.model, messages);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Cloud LLM API error (${response.status}): ${errorBody}`);
    }

    const body: unknown = await response.json();
    return parseResponse(config.provider, body);
  } catch (error) {
    clearTimeout(timeout);

    if (error.name === 'AbortError') {
      throw new Error('Cloud LLM request timed out after 30 seconds');
    }

    throw error;
  }
}
