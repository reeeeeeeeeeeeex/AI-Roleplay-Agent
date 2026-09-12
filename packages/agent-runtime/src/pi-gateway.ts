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

export type GatewayStreamOptions = SimpleStreamOptions & {
  streaming?: boolean;
  tracePayload?: (payload: unknown) => void;
  traceResponse?: (response: unknown) => void;
  onSent?: () => void;
  onHeaders?: () => void;
};

const apiNames = {
  'openai-chat-completions': 'openai-completions',
  'anthropic-messages': 'anthropic-messages',
  'openai-responses': 'openai-responses',
} as const;

let rawRequestSequence = 0;

function logRaw(direction: 'Input' | 'Output', sequence: number, value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  process.stdout.write(`\n[AI Raw ${direction} #${sequence}]\n${text ?? ''}\n`);
}

function normalizePayload(value: unknown, connection: RuntimeConnection, streaming: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(value as Record<string, unknown>), stream: streaming };
  if (connection.protocol === 'openai-chat-completions' && /(^|\.)deepseek\.com$/iu.test(new URL(connection.baseUrl).hostname)) {
    payload.thinking = { type: connection.reasoning === 'off' ? 'disabled' : 'enabled' };
  }
  return payload;
}

function sse(events: unknown[], named = false): string {
  return events.map((event) => `${named ? `event: ${(event as { type?: string }).type ?? 'message'}\n` : ''}data: ${JSON.stringify(event)}\n\n`).join('');
}

function openAICompletionEvents(body: any): string {
  const choice = body.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const base = { id: body.id ?? 'nonstream', object: 'chat.completion.chunk', created: body.created ?? Math.floor(Date.now() / 1000), model: body.model ?? '' };
  const events: unknown[] = [];
  const thinking = message.reasoning_content ?? message.reasoning ?? message.reasoning_text;
  if (thinking) events.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: thinking }, finish_reason: null }] });
  if (message.content) events.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: message.content }, finish_reason: null }] });
  if (message.tool_calls?.length) events.push({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: message.tool_calls.map((tool: any, index: number) => ({ index, id: tool.id, type: tool.type, function: { name: tool.function?.name, arguments: tool.function?.arguments ?? '{}' } })) }, finish_reason: null }] });
  events.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason ?? (message.tool_calls?.length ? 'tool_calls' : 'stop') }] });
  if (body.usage) events.push({ ...base, choices: [], usage: body.usage });
  return sse(events) + 'data: [DONE]\n\n';
}

function anthropicEvents(body: any): string {
  const usage = body.usage ?? {};
  const events: unknown[] = [{ type: 'message_start', message: { id: body.id ?? 'nonstream', type: 'message', role: 'assistant', model: body.model ?? '', content: [], stop_reason: null, usage: { input_tokens: usage.input_tokens ?? 0, cache_read_input_tokens: usage.cache_read_input_tokens, cache_creation_input_tokens: usage.cache_creation_input_tokens } } }];
  for (const [index, block] of (body.content ?? []).entries()) {
    if (block.type === 'thinking') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      if (block.thinking) events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      if (block.signature) events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else if (block.type === 'tool_use') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      if (block.text) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    }
    events.push({ type: 'content_block_stop', index });
  }
  events.push({ type: 'message_delta', delta: { stop_reason: body.stop_reason ?? 'end_turn', stop_sequence: body.stop_sequence ?? null }, usage: { output_tokens: usage.output_tokens ?? 0, output_tokens_details: usage.output_tokens_details } });
  events.push({ type: 'message_stop' });
  return sse(events, true);
}

function responsesEvents(body: any): string {
  const events: unknown[] = [{ type: 'response.created', response: { ...body, output: [] } }];
  for (const [index, item] of (body.output ?? []).entries()) {
    const empty = item.type === 'message' ? { ...item, content: [] } : item.type === 'reasoning' ? { ...item, summary: [], content: [] } : { ...item, arguments: '' };
    events.push({ type: 'response.output_item.added', output_index: index, item: empty });
    if (item.type === 'message') {
      const text = (item.content ?? []).map((part: any) => part.text ?? part.refusal ?? '').join('');
      if (text) events.push({ type: 'response.output_text.delta', output_index: index, content_index: 0, delta: text });
    } else if (item.type === 'reasoning') {
      const thinking = (item.summary?.length ? item.summary : item.content ?? []).map((part: any) => part.text ?? '').join('\n\n');
      if (thinking) events.push({ type: item.summary?.length ? 'response.reasoning_summary_text.delta' : 'response.reasoning_text.delta', output_index: index, summary_index: 0, content_index: 0, delta: thinking });
    } else if (item.type === 'function_call') {
      events.push({ type: 'response.function_call_arguments.done', output_index: index, arguments: item.arguments ?? '{}' });
    }
    events.push({ type: 'response.output_item.done', output_index: index, item });
  }
  events.push({ type: body.status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: body });
  return sse(events, true);
}

function convertNonStreamingResponse(protocol: RuntimeConnection['protocol'], body: unknown): string {
  if (protocol === 'openai-chat-completions') return openAICompletionEvents(body);
  if (protocol === 'anthropic-messages') return anthropicEvents(body);
  return responsesEvents(body);
}

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

  stream(connection: RuntimeConnection, context: Context, options: GatewayStreamOptions = {}): AssistantMessageEventStream {
    const { streaming = true, tracePayload, traceResponse, onSent, onHeaders, ...providerOptions } = options;
    const configuredOptions = Object.fromEntries(Object.entries(providerOptions).filter(([, value]) => value !== undefined));
    if (estimateTokens(JSON.stringify(context)) + (options.maxTokens ?? connection.maxTokens) > (connection.contextWindow ?? 128_000)) throw new Error('Agent context exceeds the configured window after tool results. Reduce history or tool context, or increase the context window.');
    const model = this.createModel(connection);
    const api = connection.protocol === 'openai-chat-completions'
      ? openAICompletionsApi()
      : connection.protocol === 'anthropic-messages'
        ? anthropicMessagesApi()
        : openAIResponsesApi();
    const reasoning = connection.reasoning === 'off' ? {} : { reasoning: connection.reasoning };
    const baseFetch = this.fetchOverride ?? globalThis.fetch;
    const transportFetch: typeof fetch = async (input, init) => {
      const payload = normalizePayload(JSON.parse(String(init?.body ?? '{}')), connection, streaming);
      const sequence = ++rawRequestSequence;
      logRaw('Input', sequence, payload);
      tracePayload?.(payload); onSent?.();
      const response = await baseFetch(input, { ...init, body: JSON.stringify(payload) });
      onHeaders?.();
      try {
        void response.clone().text().then((text) => logRaw('Output', sequence, text)).catch((error) => logRaw('Output', sequence, `[unavailable: ${String(error)}]`));
      } catch (error) {
        logRaw('Output', sequence, `[unavailable: ${String(error)}]`);
      }
      if (streaming || !response.ok) return response;
      const body = await response.json();
      return new Response(convertNonStreamingResponse(connection.protocol, body), {
        status: response.status,
        statusText: response.statusText,
        headers: { ...Object.fromEntries(response.headers.entries()), 'content-type': 'text/event-stream; charset=utf-8' },
      });
    };
    return api.streamSimple(model, context, {
      ...reasoning,
      headers: connection.headers,
      temperature: connection.temperature,
      maxTokens: connection.maxTokens,
      cacheRetention: 'short',
      timeoutMs: 120_000,
      maxRetries: 0,
      fetch: transportFetch,
      ...configuredOptions,
      onPayload: async (payload: unknown, model: Model<Api>) => {
        const adjusted = normalizePayload(payload, connection, true);
        return (await providerOptions.onPayload?.(adjusted, model)) ?? adjusted;
      },
      onResponse: async (response: unknown, model: Model<Api>) => {
        traceResponse?.(response);
        await providerOptions.onResponse?.(response as never, model);
      },
      // Pi's loop includes apiKey: undefined; it must not erase our scoped connection key.
      // A non-secret placeholder supports local OpenAI-compatible servers without auth.
      apiKey: connection.apiKey || 'local-no-key',
    });
  }
}
