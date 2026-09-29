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
  replayReasoning?: boolean;
  tracePayload?: (payload: unknown) => void;
  traceResponse?: (response: unknown) => void;
  onSent?: () => void;
  onHeaders?: (response: Response) => void;
};

function captureResponseStream(response: Response, capture: (body: string) => void): Response {
  if (!response.body) { capture(''); return response; }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    chunks.push(decoder.decode());
    capture(chunks.join(''));
  };
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) { finish(); controller.close(); return; }
        chunks.push(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (error) { finish(); controller.error(error); }
    },
    async cancel(reason) { finish(); await reader.cancel(reason); },
  }), { status: response.status, statusText: response.statusText, headers: response.headers });
}

function estimateContextTokens(context: Context, replayReasoning: boolean): number {
  // Count model-facing content, not local contextReport, usage, timestamps, or tool details.
  const messages = context.messages.reduce((sum, message) => sum + 32 + (
    typeof message.content === 'string' ? estimateTokens(message.content) : message.content.reduce((total, part) => {
      if (part.type === 'text') return total + estimateTokens(part.text);
      if (part.type === 'thinking') return total + (replayReasoning ? estimateTokens(part.thinking) : 0);
      if (part.type === 'toolCall') return total + estimateTokens(part.name) + estimateTokens(JSON.stringify(part.arguments));
      return total;
    }, 0)
  ), 0);
  const tools = (context.tools ?? []).reduce((sum, tool) => sum + estimateTokens(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })), 0);
  return estimateTokens(context.systemPrompt ?? '') + messages + tools;
}

const apiNames = {
  'openai-chat-completions': 'openai-completions',
  'anthropic-messages': 'anthropic-messages',
  'openai-responses': 'openai-responses',
} as const;

let rawRequestSequence = 0;

function logRaw(direction: 'Input' | 'Output', sequence: number, body: string): void {
  process.stdout.write(`\n[AI Raw ${direction} #${sequence}]\n${body}\n`);
}

function normalizePayload(value: unknown, connection: RuntimeConnection, streaming: boolean): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...(value as Record<string, unknown>), stream: streaming };
  if (connection.protocol === 'openai-chat-completions' && /(^|\.)deepseek\.com$/iu.test(new URL(connection.baseUrl).hostname)) {
    payload.thinking = { type: connection.reasoning === 'off' ? 'disabled' : 'enabled' };
  }
  return payload;
}

function visibleHistoryItem(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const item = { ...(value as Record<string, unknown>) };
  delete item.reasoning_content;
  delete item.reasoning_text;
  delete item.reasoning;
  if (Array.isArray(item.content)) {
    item.content = item.content.filter((part) => !part || typeof part !== 'object' || !['thinking', 'redacted_thinking', 'reasoning'].includes(String((part as Record<string, unknown>).type)));
  }
  return item;
}

function stripReasoningHistory(payload: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...payload };
  if (Array.isArray(clean.messages)) clean.messages = clean.messages.map(visibleHistoryItem);
  if (Array.isArray(clean.input)) clean.input = clean.input
    .filter((item) => !item || typeof item !== 'object' || (item as Record<string, unknown>).type !== 'reasoning')
    .map(visibleHistoryItem);
  return clean;
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
    return this.openStream(connection, context, options, this.fetchOverride ?? globalThis.fetch, true);
  }

  async captureRequestBody(connection: RuntimeConnection, context: Context, options: GatewayStreamOptions = {}): Promise<string> {
    let body: string | null = null;
    const captureFetch: typeof fetch = async (_input, init) => {
      body = String(init?.body ?? '');
      throw new Error('Request preview captured.');
    };
    const stream = this.openStream(connection, context, options, captureFetch, false);
    for await (const _event of stream) { /* consume the expected capture error */ }
    if (body === null) throw new Error('Unable to capture the model request body.');
    return body;
  }

  private openStream(connection: RuntimeConnection, context: Context, options: GatewayStreamOptions, baseFetch: typeof fetch, terminalLog: boolean): AssistantMessageEventStream {
    const { streaming = true, replayReasoning = true, tracePayload, traceResponse, onSent, onHeaders, ...providerOptions } = options;
    const configuredOptions = Object.fromEntries(Object.entries(providerOptions).filter(([, value]) => value !== undefined));
    const inputTokens = estimateContextTokens(context, replayReasoning);
    const maxOutput = options.maxTokens ?? connection.maxTokens;
    const window = connection.contextWindow ?? 128_000;
    if (inputTokens + maxOutput > window) throw new Error(`上下文预算不足：输入估算 ${inputTokens} + 最大输出 ${maxOutput} > 配置窗口 ${window} token。请减少历史／工具返回内容，调低最大输出，或按模型实际支持的大小设置上下文窗口。输入为本地估算，不是供应商用量。`);
    const model = this.createModel(connection);
    const api = connection.protocol === 'openai-chat-completions'
      ? openAICompletionsApi()
      : connection.protocol === 'anthropic-messages'
        ? anthropicMessagesApi()
        : openAIResponsesApi();
    const reasoning = connection.reasoning === 'off' ? {} : { reasoning: connection.reasoning };
    const transportFetch: typeof fetch = async (input, init) => {
      const normalized = normalizePayload(JSON.parse(String(init?.body ?? '{}')), connection, streaming);
      const payload = replayReasoning ? normalized : stripReasoningHistory(normalized);
      const requestBody = JSON.stringify(payload);
      const sequence = !streaming && terminalLog ? ++rawRequestSequence : 0;
      if (sequence) logRaw('Input', sequence, requestBody);
      tracePayload?.(requestBody); onSent?.();
      const response = await baseFetch(input, { ...init, body: requestBody });
      onHeaders?.(response);
      if (streaming) return traceResponse ? captureResponseStream(response, traceResponse) : response;
      const responseBody = await response.text();
      if (sequence) logRaw('Output', sequence, responseBody);
      traceResponse?.(responseBody);
      if (!response.ok) return new Response(responseBody, { status: response.status, statusText: response.statusText, headers: response.headers });
      return new Response(convertNonStreamingResponse(connection.protocol, JSON.parse(responseBody)), {
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
        await providerOptions.onResponse?.(response as never, model);
      },
      // Pi's loop includes apiKey: undefined; it must not erase our scoped connection key.
      // A non-secret placeholder supports local OpenAI-compatible servers without auth.
      apiKey: connection.apiKey || 'local-no-key',
    });
  }
}
