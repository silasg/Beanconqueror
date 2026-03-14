import { CLOUD_AI_PROVIDER_ENUM } from '../../enums/settings/cloudAiProvider';

export interface CloudModel {
  id: string;
  name: string;
  supportsVision: boolean;
  contextLength?: number;
}

const TIMEOUT_MS = 15000;

const OPENAI_EXCLUDED_PREFIXES = [
  'text-embedding',
  'whisper',
  'dall-e',
  'tts',
  'davinci',
  'babbage',
];

function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeout),
  );
}

async function fetchOpenAIModels(apiKey: string): Promise<CloudModel[]> {
  const response = await fetchWithTimeout('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await response.json();
  const models: CloudModel[] = (body.data ?? [])
    .filter(
      (m: any) =>
        !OPENAI_EXCLUDED_PREFIXES.some((prefix) => m.id.startsWith(prefix)),
    )
    .map((m: any) => ({
      id: m.id,
      name: m.id,
      supportsVision: false,
    }));
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

async function fetchAnthropicModels(apiKey: string): Promise<CloudModel[]> {
  const response = await fetchWithTimeout(
    'https://api.anthropic.com/v1/models',
    {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    },
  );
  const body = await response.json();
  const models: CloudModel[] = (body.data ?? []).map((m: any) => ({
    id: m.id,
    name: m.display_name ?? m.id,
    supportsVision: false,
  }));
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

async function fetchGeminiModels(apiKey: string): Promise<CloudModel[]> {
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  const body = await response.json();
  const models: CloudModel[] = (body.models ?? [])
    .filter((m: any) =>
      Boolean(m.supportedGenerationMethods?.includes('generateContent')),
    )
    .map((m: any) => ({
      id: (m.name ?? '').replace(/^models\//, ''),
      name: m.displayName ?? m.name ?? '',
      supportsVision: true,
    }));
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

async function fetchMistralModels(apiKey: string): Promise<CloudModel[]> {
  const response = await fetchWithTimeout('https://api.mistral.ai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await response.json();
  const models: CloudModel[] = (body.data ?? [])
    .filter((m: any) => !m.id.startsWith('mistral-embed'))
    .map((m: any) => ({
      id: m.id,
      name: m.id,
      supportsVision: false,
    }));
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

async function fetchOpenRouterModels(): Promise<CloudModel[]> {
  const response = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/models',
  );
  const body = await response.json();
  const models: CloudModel[] = (body.data ?? []).map((m: any) => ({
    id: m.id,
    name: m.name ?? m.id,
    supportsVision:
      m.architecture?.input_modalities?.includes('image') ?? false,
    contextLength: m.context_length,
  }));
  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}

async function fetchCustomModels(
  apiKey: string,
  baseUrl: string,
): Promise<CloudModel[]> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const response = await fetchWithTimeout(`${cleanUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await response.json();
  const models: CloudModel[] = (body.data ?? []).map((m: any) => ({
    id: m.id,
    name: m.id,
    supportsVision: false,
  }));
  return models;
}

export async function fetchAvailableModels(
  provider: CLOUD_AI_PROVIDER_ENUM,
  apiKey: string,
  baseUrl?: string,
): Promise<CloudModel[]> {
  try {
    switch (provider) {
      case CLOUD_AI_PROVIDER_ENUM.OPENAI:
        return await fetchOpenAIModels(apiKey);
      case CLOUD_AI_PROVIDER_ENUM.ANTHROPIC:
        return await fetchAnthropicModels(apiKey);
      case CLOUD_AI_PROVIDER_ENUM.MISTRAL:
        return await fetchMistralModels(apiKey);
      case CLOUD_AI_PROVIDER_ENUM.GOOGLE:
        return await fetchGeminiModels(apiKey);
      case CLOUD_AI_PROVIDER_ENUM.OPENROUTER:
        return await fetchOpenRouterModels();
      case CLOUD_AI_PROVIDER_ENUM.CUSTOM:
        return await fetchCustomModels(apiKey, baseUrl ?? '');
      default:
        return [];
    }
  } catch {
    return [];
  }
}
