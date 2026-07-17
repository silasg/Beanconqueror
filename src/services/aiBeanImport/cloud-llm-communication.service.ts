import { AI_PROVIDER_ENUM } from '../../enums/settings/aiProvider';

export interface CloudLLMConfig {
  provider: AI_PROVIDER_ENUM;
  apiKey: string;
  model: string;
  baseUrl?: string; // for CUSTOM provider
  // Set to false when the caller already knows the model rejects an explicit
  // temperature (e.g. from OpenRouter's supported_parameters), so we skip
  // sending it up front instead of learning from a failed request.
  supportsTemperature?: boolean;
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

// ── Provider protocol config ─────────────────────────────────────────
//
// Each provider config defines URL, headers, request body shape, and
// response parsing. The shared sendCloudLLMPrompt function handles
// fetch, timeout, and error handling — protocol details stay here.

// Low temperature keeps label extraction deterministic. It is sent
// best-effort: models that reject an explicit temperature fall back to their
// default (see sendCloudLLMPrompt).
const DEFAULT_TEMPERATURE = 0.1;

/** Options that influence how a request body is built. */
interface BuildOptions {
  /** Whether to include the temperature parameter in the request body. */
  includeTemperature: boolean;
}

/** Protocol-level config that describes how to talk to a specific LLM API. */
interface ProviderProtocol {
  readonly url: string;
  readonly headers: Record<string, string>;
  buildRequestBody(
    model: string,
    messages: CloudLLMMessage[],
    options: BuildOptions,
  ): object;
  parseResponse(body: unknown): CloudLLMResponse;
}

/** Read a nested property from an unknown value, returning undefined on miss. */
function dig(obj: unknown, ...keys: (string | number)[]): unknown {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

// ── OpenAI-compatible protocol ───────────────────────────────────────
//
// Used by OpenAI, Google (Gemini), Mistral, OpenRouter, and Custom.
// All share the same body format, endpoint, and response shape.
// Differences are limited to base URL and optional extra headers.

class OpenAICompatibleProtocol implements ProviderProtocol {
  readonly url: string;
  readonly headers: Record<string, string>;

  constructor(
    baseUrl: string,
    apiKey: string,
    extraHeaders?: Record<string, string>,
  ) {
    this.url = `${baseUrl}/chat/completions`;
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
  }

  buildRequestBody(
    model: string,
    messages: CloudLLMMessage[],
    { includeTemperature }: BuildOptions,
  ): object {
    return {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(includeTemperature ? { temperature: DEFAULT_TEMPERATURE } : {}),
    };
  }

  // API response shape is not validated — access defensively.
  parseResponse(body: unknown): CloudLLMResponse {
    const usage = dig(body, 'usage') as
      | { prompt_tokens: number; completion_tokens: number }
      | undefined;
    return {
      content: String(dig(body, 'choices', 0, 'message', 'content') ?? ''),
      model: String(dig(body, 'model') ?? ''),
      usage,
    };
  }
}

// ── Anthropic protocol ───────────────────────────────────────────────
//
// Different auth header, API version header, body format (system message
// extracted, max_tokens required), endpoint (/messages), and response
// shape (content[].text instead of choices[].message.content).

class AnthropicProtocol implements ProviderProtocol {
  readonly url: string;
  readonly headers: Record<string, string>;

  constructor(apiKey: string) {
    this.url = 'https://api.anthropic.com/v1/messages';
    this.headers = {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  }

  buildRequestBody(
    model: string,
    messages: CloudLLMMessage[],
    { includeTemperature }: BuildOptions,
  ): object {
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsgs = messages.filter((m) => m.role !== 'system');
    return {
      model,
      max_tokens: 4096,
      ...(includeTemperature ? { temperature: DEFAULT_TEMPERATURE } : {}),
      system: systemMsg?.content ?? '',
      messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
    };
  }

  // API response shape is not validated — access defensively.
  parseResponse(body: unknown): CloudLLMResponse {
    const usage = dig(body, 'usage') as Record<string, unknown> | undefined;
    return {
      content: String(dig(body, 'content', 0, 'text') ?? ''),
      model: String(dig(body, 'model') ?? ''),
      usage: usage
        ? {
            prompt_tokens: Number(usage.input_tokens ?? 0),
            completion_tokens: Number(usage.output_tokens ?? 0),
          }
        : undefined,
    };
  }
}

// ── Factory ──────────────────────────────────────────────────────────

function createProtocol(config: CloudLLMConfig): ProviderProtocol {
  switch (config.provider) {
    case AI_PROVIDER_ENUM.ANTHROPIC:
      return new AnthropicProtocol(config.apiKey);

    case AI_PROVIDER_ENUM.OPENROUTER:
      return new OpenAICompatibleProtocol(
        'https://openrouter.ai/api/v1',
        config.apiKey,
        {
          'HTTP-Referer': 'https://beanconqueror.com',
          'X-OpenRouter-Title': 'Beanconqueror',
        },
      );

    case AI_PROVIDER_ENUM.CUSTOM:
      return new OpenAICompatibleProtocol(
        (config.baseUrl ?? '').replace(/\/+$/, ''),
        config.apiKey,
      );

    case AI_PROVIDER_ENUM.GOOGLE:
      return new OpenAICompatibleProtocol(
        'https://generativelanguage.googleapis.com/v1beta/openai',
        config.apiKey,
      );

    case AI_PROVIDER_ENUM.MISTRAL:
      return new OpenAICompatibleProtocol(
        'https://api.mistral.ai/v1',
        config.apiKey,
      );

    case AI_PROVIDER_ENUM.OPENAI:
    default:
      return new OpenAICompatibleProtocol(
        'https://api.openai.com/v1',
        config.apiKey,
      );
  }
}

// ── Temperature capability adaptation ────────────────────────────────
//
// A few models (notably OpenAI's GPT-5.x / reasoning family) reject an
// explicit temperature with a 400 and only accept their default value.
// Rather than maintain a model-name list, we send temperature best-effort:
// if a request is rejected specifically because of temperature, we drop it,
// retry once, and remember the model+provider so later requests skip it.
// This keeps the deterministic low temperature on every model that honors
// it and self-heals for models (present and future) that do not.

const temperatureUnsupported = new Set<string>();

function temperatureCacheKey(config: CloudLLMConfig): string {
  return `${config.provider}::${config.baseUrl ?? ''}::${config.model}`;
}

/** True when a response was rejected specifically because of temperature. */
function isTemperatureRejection(status: number, errorBody: string): boolean {
  return status === 400 && /temperature/i.test(errorBody);
}

/**
 * Reset the learned temperature-support cache.
 *
 * The cache is a session-lifetime optimization; this is primarily useful for
 * tests, but also lets callers clear it if a model's capabilities change.
 */
export function resetTemperatureSupportCache(): void {
  temperatureUnsupported.clear();
}

/**
 * Seed the cache with previously-learned keys (e.g. persisted in settings) so
 * the very first request of a session already skips temperature for models
 * known to reject it.
 */
export function hydrateTemperatureSupportCache(keys: readonly string[]): void {
  for (const key of keys) {
    temperatureUnsupported.add(key);
  }
}

/** Current set of keys known to reject temperature, for persistence. */
export function snapshotTemperatureSupportCache(): string[] {
  return Array.from(temperatureUnsupported);
}

// ── Public API ───────────────────────────────────────────────────────

/** Perform a single request with its own 30s timeout. */
async function performRequest(
  protocol: ProviderProtocol,
  model: string,
  messages: CloudLLMMessage[],
  includeTemperature: boolean,
): Promise<Response> {
  const requestBody = protocol.buildRequestBody(model, messages, {
    includeTemperature,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(protocol.url, {
      method: 'POST',
      headers: protocol.headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send a prompt to a cloud LLM provider and return the response.
 *
 * Protocol details (URL, headers, body format, response parsing) are
 * handled by provider-specific config classes. This function handles
 * fetch, timeout, error handling, and the temperature fallback described
 * above.
 */
export async function sendCloudLLMPrompt(
  config: CloudLLMConfig,
  messages: CloudLLMMessage[],
): Promise<CloudLLMResponse> {
  const protocol = createProtocol(config);
  const cacheKey = temperatureCacheKey(config);
  const includeTemperature =
    config.supportsTemperature !== false &&
    !temperatureUnsupported.has(cacheKey);

  try {
    let response = await performRequest(
      protocol,
      config.model,
      messages,
      includeTemperature,
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');

      // Retry once without temperature when that is what was rejected.
      if (
        includeTemperature &&
        isTemperatureRejection(response.status, errorBody)
      ) {
        temperatureUnsupported.add(cacheKey);
        response = await performRequest(
          protocol,
          config.model,
          messages,
          false,
        );
        if (!response.ok) {
          const retryErrorBody = await response.text().catch(() => '');
          throw new Error(
            `Cloud LLM API error (${response.status}): ${retryErrorBody}`,
          );
        }
      } else {
        throw new Error(
          `Cloud LLM API error (${response.status}): ${errorBody}`,
        );
      }
    }

    const body: unknown = await response.json();
    return protocol.parseResponse(body);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Cloud LLM request timed out after 30 seconds');
    }

    throw error;
  }
}
