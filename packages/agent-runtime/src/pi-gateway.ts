import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import type { RuntimeConnection } from './types.js';
import { estimateTokens } from './prompt.js';

const apiNames = {
  'openai-chat-completions': 'openai-completions',
  'anthropic-messages': 'anthropic-messages',
  'openai-responses': 'openai-responses',
} as const;

export class PiModelGateway {
  constructor(private readonly fetchOverride?: typeof fetch) {}
  createModel(connection: RuntimeConnection): Model<Api> {
    const api = apiNames[connection.protocol];
    return {
      id: connection.model,
      name: connection.model,
      api,
      provider: `connection:${connection.id}`,
      baseUrl: connection.baseUrl.replace(/\/$/, ''),
      reasoning: connection.reasoning !== 'off',
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: connection.contextWindow ?? 128_000,
      maxTokens: connection.maxTokens,
      headers: connection.headers,
    };
  }

  stream(connection: RuntimeConnection, context: Context, options: SimpleStreamOptions = {}): AssistantMessageEventStream {
    const configuredOptions = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    if (estimateTokens(JSON.stringify(context)) + (options.maxTokens ?? connection.maxTokens) > (connection.contextWindow ?? 128_000)) throw new Error('Agent context exceeds the configured window after tool results. Reduce history or tool context, or increase the context window.');
    const model = this.createModel(connection);
    const api = connection.protocol === 'openai-chat-completions'
      ? openAICompletionsApi()
      : connection.protocol === 'anthropic-messages'
        ? anthropicMessagesApi()
        : openAIResponsesApi();
    const reasoning = connection.reasoning === 'off' ? {} : { reasoning: connection.reasoning };
    return api.streamSimple(model, context, {
      ...reasoning,
      headers: connection.headers,
      temperature: connection.temperature,
      maxTokens: connection.maxTokens,
      cacheRetention: 'short',
      timeoutMs: 120_000,
      maxRetries: 1,
      ...(this.fetchOverride ? { fetch: this.fetchOverride } : {}),
      ...configuredOptions,
      // Pi's loop includes apiKey: undefined; it must not erase our scoped connection key.
      // A non-secret placeholder supports local OpenAI-compatible servers without auth.
      apiKey: connection.apiKey || 'local-no-key',
    });
  }
}
