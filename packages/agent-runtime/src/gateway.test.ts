import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@earendil-works/pi-ai';
import { PiModelGateway } from './pi-gateway.js';
import type { RuntimeConnection } from './types.js';

const context: Context = { systemPrompt: 'Test', messages: [{ role: 'user', content: 'Go', timestamp: 1 }] };

function response(protocol: RuntimeConnection['protocol'], streaming: boolean): Response {
  if (!streaming) {
    const body = protocol === 'openai-chat-completions'
      ? { id: 'chat-1', model: 'test', choices: [{ message: { role: 'assistant', reasoning_content: 'think', content: 'OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, prompt_cache_hit_tokens: 4, completion_tokens: 3 } }
      : protocol === 'anthropic-messages'
        ? { id: 'msg-1', model: 'test', content: [{ type: 'thinking', thinking: 'think', signature: 'hidden' }, { type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_read_input_tokens: 4, output_tokens: 3 } }
        : { id: 'resp-1', model: 'test', status: 'completed', output: [{ id: 'r1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }] }, { id: 'm1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 4 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 1 }, total_tokens: 13 } };
    return Response.json(body);
  }
  if (protocol === 'openai-chat-completions') return new Response([
    'data: {"id":"chat-1","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"reasoning_content":"think"},"finish_reason":null}]}',
    'data: {"id":"chat-1","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
    'data: {"id":"chat-1","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"prompt_cache_hit_tokens":4,"completion_tokens":3}}',
    'data: [DONE]', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } });
  if (protocol === 'anthropic-messages') return new Response([
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","model":"test","content":[],"stop_reason":null,"usage":{"input_tokens":10,"cache_read_input_tokens":4}}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"think"}}',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"OK"}}',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
    'event: message_stop\ndata: {"type":"message_stop"}', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } });
  return new Response([
    'event: response.created\ndata: {"type":"response.created","response":{"id":"resp-1","status":"in_progress","output":[]}}',
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"id":"r1","type":"reasoning","summary":[],"content":[]}}',
    'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","output_index":0,"delta":"think"}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"id":"r1","type":"reasoning","summary":[{"type":"summary_text","text":"think"}]}}',
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":1,"item":{"id":"m1","type":"message","role":"assistant","status":"in_progress","content":[]}}',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":1,"delta":"OK"}',
    'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":1,"item":{"id":"m1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"OK","annotations":[]}]}}',
    'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1","status":"completed","output":[],"usage":{"input_tokens":10,"input_tokens_details":{"cached_tokens":4},"output_tokens":3,"total_tokens":13}}}', '',
  ].join('\n\n'), { headers: { 'content-type': 'text/event-stream' } });
}

describe('gateway transport contract', () => {
  it('context budget excludes internal reports from a plain rewrite request', async () => {
    const connection: RuntimeConnection = { id: 'budget', protocol: 'openai-chat-completions', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test', headers: {}, temperature: 1, maxTokens: 1000, contextWindow: 8000, reasoning: 'off' };
    const rewritten: Context & { contextReport: unknown } = {
      systemPrompt: 'Write the assigned character.',
      messages: [{ role: 'user', content: `[Rewrite Source]\n${'原来的回复。'.repeat(200)}\n[Rewrite Instruction]\n多用对白。\n[Current Speaker]\nSina`, timestamp: 1 }],
      contextReport: { items: [{ reason: '本地上下文说明，不发送给模型。'.repeat(4000) }] },
    };
    const sent: string[] = [];
    const network = vi.fn<typeof fetch>(async (_url, init) => { sent.push(String(init?.body)); return response(connection.protocol, true); });
    const gateway = new PiModelGateway(network);
    const preview = await gateway.captureRequestBody(connection, rewritten, { replayReasoning: false });
    expect(network).not.toHaveBeenCalled();
    let text = '';
    for await (const event of gateway.stream(connection, rewritten, { replayReasoning: false })) if (event.type === 'text_delta') text += event.delta;
    expect(text).toBe('OK');
    expect(sent).toEqual([preview]);
    expect(preview).toContain('[Rewrite Instruction]');
    expect(preview).not.toContain('contextReport');
  });

  it('context budget still rejects oversized tool text with numeric estimates', () => {
    const connection: RuntimeConnection = { id: 'budget', protocol: 'openai-chat-completions', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test', headers: {}, temperature: 1, maxTokens: 1000, contextWindow: 8000, reasoning: 'off' };
    const network = vi.fn<typeof fetch>();
    const gateway = new PiModelGateway(network);
    const oversized: Context = { ...context, messages: [{ role: 'toolResult', toolCallId: 'read-1', toolName: 'read_memory', content: [{ type: 'text', text: '旧记忆'.repeat(2000) }], isError: false, timestamp: 1 }] };
    expect(() => gateway.stream(connection, oversized)).toThrow(/输入估算 \d+ \+ 最大输出 1000 > 配置窗口 8000/);
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['openai-chat-completions', 'anthropic-messages', 'openai-responses'] as const)('%s sends real stream values', async (protocol) => {
    const note = { role: 'user' as const, content: "[Author's Note]\nKeep the scene quiet.", timestamp: 1, authorNote: true };
    const noteContext: Context = { ...context, messages: [...context.messages, note, { role: 'user', content: 'Final writing control.', timestamp: 2 }] };
    const sent: boolean[] = [], sentBodies: string[] = [], rawResponses: string[] = [], writes: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const body = String(init?.body), streaming = Boolean(JSON.parse(body).stream);
      sent.push(streaming); sentBodies.push(body);
      const value = response(protocol, streaming); rawResponses.push(await value.clone().text()); return value;
    });
    const connection: RuntimeConnection = { id: 'test', protocol, baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test', headers: {}, temperature: 0.5, maxTokens: 100, reasoning: 'high' };
    const gateway = new PiModelGateway(fetchMock);
    const captured = await gateway.captureRequestBody(connection, noteContext, { streaming: true });
    const changed = JSON.parse(await gateway.captureRequestBody(connection, { ...noteContext, messages: [context.messages[0]!, { ...note, content: "[Author's Note]\nLet the rain stop." }, noteContext.messages.at(-1)!] }));
    const body = JSON.parse(captured);
    expect(captured).not.toMatch(/author-note:|"authorNote"/u);
    if (protocol === 'anthropic-messages') {
      expect(body.system[0]).toMatchObject({ type: 'text', text: note.content });
      expect(body.messages).toEqual(changed.messages);
      expect(body.system.slice(1)).toEqual(changed.system.slice(1));
      expect(JSON.stringify(body.messages)).not.toContain("Author's Note");
    } else {
      const items = body[protocol === 'openai-responses' ? 'input' : 'messages'];
      const changedItems = changed[protocol === 'openai-responses' ? 'input' : 'messages'];
      const index = items.findIndex((item: any) => JSON.stringify(item.content).includes("Author's Note"));
      expect(index).toBe(0);
      expect(items[index].role).toBe('system');
      const firstText = typeof items[0].content === 'string' ? items[0].content : items[0].content.map((part: any) => part.text).join('');
      expect(firstText.startsWith(note.content)).toBe(true);
      expect(items.slice(1)).toEqual(changedItems.slice(1));
      expect(JSON.stringify(items.slice(1))).not.toContain("Author's Note");
      expect(JSON.stringify(items.at(-1).content)).toContain('Final writing control.');
    }
    const visibleOnly = await gateway.captureRequestBody(connection, noteContext, { streaming: true, replayReasoning: false, onPayload: (value: any) => {
      if (protocol === 'openai-responses') return { ...value, input: [...value.input, { type: 'reasoning', encrypted_content: 'private-reasoning' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'visible history' }] }] };
      if (protocol === 'anthropic-messages') return { ...value, messages: [...value.messages, { role: 'assistant', content: [{ type: 'thinking', thinking: 'private-reasoning', signature: 'signature' }, { type: 'text', text: 'visible history' }] }] };
      return { ...value, messages: [...value.messages, { role: 'assistant', reasoning_content: 'private-reasoning', content: 'visible history' }] };
    } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(visibleOnly).toContain('visible history');
    expect(visibleOnly).not.toContain('private-reasoning');
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => { writes.push(String(chunk)); return true; }) as typeof process.stdout.write);
    for (const streaming of [true, false]) {
      let text = '', thinking = '';
      const requests: unknown[] = [], responses: unknown[] = [];
      writes.length = 0;
      for await (const event of gateway.stream(connection, noteContext, { streaming, tracePayload: value => requests.push(value), traceResponse: value => responses.push(value) })) {
        if (event.type === 'text_delta') text += event.delta;
        if (event.type === 'thinking_delta') thinking += event.delta;
      }
      expect(text).toBe('OK'); expect(thinking).toBe('think');
      expect(requests).toEqual([sentBodies.at(-1)]);
      if (streaming) { expect(writes).toEqual([]); expect(responses).toEqual([rawResponses.at(-1)]); }
      else { expect(writes.join('')).toContain(sentBodies.at(-1)); expect(writes.join('')).toContain(rawResponses.at(-1)); expect(responses).toEqual([rawResponses.at(-1)]); }
    }
    write.mockRestore();
    expect(captured).toBe(sentBodies[0]);
    expect(sent).toEqual([true, false]);
    expect(noteContext.systemPrompt).toBe('Test');
    expect(noteContext.messages).toContain(note);
  });

  it('retains the exact partial SSE when a stream is aborted', async () => {
    const controller = new AbortController();
    const raw = 'data: {"id":"partial","object":"chat.completion.chunk","model":"test","choices":[{"index":0,"delta":{"reasoning_content":"正在检查"},"finish_reason":null}]}\n\n';
    const gateway = new PiModelGateway(async () => new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(raw));
        controller.signal.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')), { once: true });
      },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const connection: RuntimeConnection = { id: 'test', protocol: 'openai-chat-completions', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test', headers: {}, temperature: 1, maxTokens: 100, reasoning: 'high' };
    const captured: unknown[] = [];
    for await (const event of gateway.stream(connection, context, { signal: controller.signal, traceResponse: value => captured.push(value) })) {
      if (event.type === 'thinking_delta') controller.abort();
    }
    expect(captured).toEqual([raw]);
  });
});
