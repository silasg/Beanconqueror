import { CLOUD_AI_PROVIDER_ENUM } from '../../../enums/settings/cloudAiProvider';
import { fetchAvailableModels } from '../cloud-model-list.service';

describe('cloud-model-list.service', () => {
  let fetchSpy: jasmine.Spy;

  function mockFetchResponse(body: object, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  // ── OpenRouter ─────────────────────────────────────────────────────

  describe('OpenRouter', () => {
    it('should map input_modalities to supportsVision', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [
              {
                id: 'openai/gpt-4o',
                name: 'GPT-4o',
                architecture: { input_modalities: ['text', 'image'] },
                context_length: 128000,
              },
              {
                id: 'anthropic/claude-sonnet-4-20250514',
                name: 'Claude Sonnet',
                architecture: { input_modalities: ['text'] },
                context_length: 200000,
              },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENROUTER,
        '',
      );

      // Assert
      expect(models.length).toBe(2);
      const gpt4o = models.find((m) => m.id === 'openai/gpt-4o');
      const claude = models.find(
        (m) => m.id === 'anthropic/claude-sonnet-4-20250514',
      );
      expect(gpt4o.supportsVision).toBe(true);
      expect(gpt4o.contextLength).toBe(128000);
      expect(claude.supportsVision).toBe(false);
      expect(claude.contextLength).toBe(200000);
    });

    it('should handle missing architecture gracefully', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [{ id: 'some/model', name: 'Some Model' }],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENROUTER,
        '',
      );

      // Assert
      expect(models.length).toBe(1);
      expect(models[0].supportsVision).toBe(false);
    });

    it('should sort by name', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [
              { id: 'z-model', name: 'Zebra' },
              { id: 'a-model', name: 'Alpha' },
              { id: 'm-model', name: 'Middle' },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENROUTER,
        '',
      );

      // Assert
      expect(models.map((m) => m.name)).toEqual(['Alpha', 'Middle', 'Zebra']);
    });
  });

  // ── OpenAI ─────────────────────────────────────────────────────────

  describe('OpenAI', () => {
    it('should filter out non-chat models', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [
              { id: 'gpt-4o' },
              { id: 'gpt-4o-mini' },
              { id: 'text-embedding-3-large' },
              { id: 'text-embedding-ada-002' },
              { id: 'whisper-1' },
              { id: 'dall-e-3' },
              { id: 'tts-1' },
              { id: 'tts-1-hd' },
              { id: 'davinci-002' },
              { id: 'babbage-002' },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENAI,
        'test-key',
      );

      // Assert
      const ids = models.map((m) => m.id);
      expect(ids).toContain('gpt-4o');
      expect(ids).toContain('gpt-4o-mini');
      expect(ids).not.toContain('text-embedding-3-large');
      expect(ids).not.toContain('text-embedding-ada-002');
      expect(ids).not.toContain('whisper-1');
      expect(ids).not.toContain('dall-e-3');
      expect(ids).not.toContain('tts-1');
      expect(ids).not.toContain('tts-1-hd');
      expect(ids).not.toContain('davinci-002');
      expect(ids).not.toContain('babbage-002');
    });

    it('should use id as both id and name', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [{ id: 'gpt-4o' }],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENAI,
        'test-key',
      );

      // Assert
      expect(models[0].id).toBe('gpt-4o');
      expect(models[0].name).toBe('gpt-4o');
      expect(models[0].supportsVision).toBe(false);
    });

    it('should sort by id', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [
              { id: 'gpt-4o-mini' },
              { id: 'gpt-3.5-turbo' },
              { id: 'gpt-4o' },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENAI,
        'test-key',
      );

      // Assert
      expect(models.map((m) => m.id)).toEqual([
        'gpt-3.5-turbo',
        'gpt-4o',
        'gpt-4o-mini',
      ]);
    });

    it('should send correct authorization header', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(mockFetchResponse({ data: [] })),
      );

      // Act
      await fetchAvailableModels(CLOUD_AI_PROVIDER_ENUM.OPENAI, 'my-api-key');

      // Assert
      const [url, options] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe('https://api.openai.com/v1/models');
      expect(options.headers.Authorization).toBe('Bearer my-api-key');
    });
  });

  // ── Anthropic ──────────────────────────────────────────────────────

  describe('Anthropic', () => {
    it('should parse display_name and id', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [
              {
                id: 'claude-sonnet-4-20250514',
                display_name: 'Claude Sonnet 4',
              },
              { id: 'claude-haiku-3-20240307', display_name: 'Claude 3 Haiku' },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.ANTHROPIC,
        'test-key',
      );

      // Assert
      expect(models.length).toBe(2);
      const sonnet = models.find((m) => m.id === 'claude-sonnet-4-20250514');
      expect(sonnet.name).toBe('Claude Sonnet 4');
      expect(sonnet.supportsVision).toBe(false);
    });

    it('should fall back to id when display_name is missing', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [{ id: 'claude-unknown' }],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.ANTHROPIC,
        'test-key',
      );

      // Assert
      expect(models[0].name).toBe('claude-unknown');
    });

    it('should send correct headers', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(mockFetchResponse({ data: [] })),
      );

      // Act
      await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.ANTHROPIC,
        'my-anthropic-key',
      );

      // Assert
      const [url, options] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe('https://api.anthropic.com/v1/models');
      expect(options.headers['x-api-key']).toBe('my-anthropic-key');
      expect(options.headers['anthropic-version']).toBe('2023-06-01');
    });

    it('should sort by name', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [
              { id: 'c', display_name: 'Zebra' },
              { id: 'a', display_name: 'Alpha' },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.ANTHROPIC,
        'test-key',
      );

      // Assert
      expect(models[0].name).toBe('Alpha');
      expect(models[1].name).toBe('Zebra');
    });
  });

  // ── Google Gemini ──────────────────────────────────────────────────

  describe('Google Gemini', () => {
    it('should strip models/ prefix and filter by generateContent', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            models: [
              {
                name: 'models/gemini-2.0-flash',
                displayName: 'Gemini 2.0 Flash',
                supportedGenerationMethods: ['generateContent', 'countTokens'],
              },
              {
                name: 'models/embedding-001',
                displayName: 'Embedding 001',
                supportedGenerationMethods: ['embedContent'],
              },
              {
                name: 'models/gemini-1.5-pro',
                displayName: 'Gemini 1.5 Pro',
                supportedGenerationMethods: ['generateContent', 'countTokens'],
              },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.GOOGLE,
        'test-key',
      );

      // Assert
      expect(models.length).toBe(2);
      const ids = models.map((m) => m.id);
      expect(ids).toContain('gemini-2.0-flash');
      expect(ids).toContain('gemini-1.5-pro');
      expect(ids).not.toContain('embedding-001');
      expect(ids).not.toContain('models/gemini-2.0-flash');
    });

    it('should set all Gemini models as supportsVision', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            models: [
              {
                name: 'models/gemini-2.0-flash',
                displayName: 'Gemini 2.0 Flash',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.GOOGLE,
        'test-key',
      );

      // Assert
      expect(models[0].supportsVision).toBe(true);
    });

    it('should pass API key as query parameter', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(mockFetchResponse({ models: [] })),
      );

      // Act
      await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.GOOGLE,
        'my-gemini-key',
      );

      // Assert
      const [url] = fetchSpy.calls.mostRecent().args;
      expect(url).toContain('key=my-gemini-key');
    });

    it('should sort by name', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            models: [
              {
                name: 'models/gemini-2.0-flash',
                displayName: 'Gemini 2.0 Flash',
                supportedGenerationMethods: ['generateContent'],
              },
              {
                name: 'models/gemini-1.5-pro',
                displayName: 'Gemini 1.5 Pro',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.GOOGLE,
        'test-key',
      );

      // Assert
      expect(models[0].name).toBe('Gemini 1.5 Pro');
      expect(models[1].name).toBe('Gemini 2.0 Flash');
    });
  });

  // ── Custom ─────────────────────────────────────────────────────────

  describe('Custom', () => {
    it('should return empty array on failure', async () => {
      // Arrange
      fetchSpy.and.returnValue(Promise.reject(new Error('Connection refused')));

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.CUSTOM,
        'key',
        'https://my-server.example.com',
      );

      // Assert
      expect(models).toEqual([]);
    });

    it('should use baseUrl to fetch models', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.resolve(
          mockFetchResponse({
            data: [{ id: 'local-model' }],
          }),
        ),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.CUSTOM,
        'key',
        'https://my-server.example.com/v1',
      );

      // Assert
      const [url] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe('https://my-server.example.com/v1/models');
      expect(models.length).toBe(1);
      expect(models[0].id).toBe('local-model');
    });
  });

  // ── Error handling ─────────────────────────────────────────────────

  describe('error handling', () => {
    it('should return empty array on network error for OpenAI', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.reject(new TypeError('Failed to fetch')),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENAI,
        'key',
      );

      // Assert
      expect(models).toEqual([]);
    });

    it('should return empty array on network error for Anthropic', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.reject(new TypeError('Failed to fetch')),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.ANTHROPIC,
        'key',
      );

      // Assert
      expect(models).toEqual([]);
    });

    it('should return empty array on network error for Google', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.reject(new TypeError('Failed to fetch')),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.GOOGLE,
        'key',
      );

      // Assert
      expect(models).toEqual([]);
    });

    it('should return empty array on network error for OpenRouter', async () => {
      // Arrange
      fetchSpy.and.returnValue(
        Promise.reject(new TypeError('Failed to fetch')),
      );

      // Act
      const models = await fetchAvailableModels(
        CLOUD_AI_PROVIDER_ENUM.OPENROUTER,
        '',
      );

      // Assert
      expect(models).toEqual([]);
    });

    it('should return empty array for unknown provider', async () => {
      // Act
      const models = await fetchAvailableModels(
        'UNKNOWN' as CLOUD_AI_PROVIDER_ENUM,
        'key',
      );

      // Assert
      expect(models).toEqual([]);
    });
  });
});
