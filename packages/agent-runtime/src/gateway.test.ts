import { describe, expect, it } from 'vitest';
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
  it.each(['openai-chat-completions', 'anthropic-messages', 'openai-responses'] as const)('%s sends real stream values', async (protocol) => {
    const sent: boolean[] = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      const streaming = Boolean(JSON.parse(String(init?.body)).stream);
      sent.push(streaming);
      return response(protocol, streaming);
    };
    const connection: RuntimeConnection = { id: 'test', protocol, baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test', headers: {}, temperature: 0.5, maxTokens: 100, reasoning: 'high' };
    for (const streaming of [true, false]) {
      let text = '', thinking = '';
      for await (const event of new PiModelGateway(fetchMock).stream(connection, context, { streaming })) {
        if (event.type === 'text_delta') text += event.delta;
        if (event.type === 'thinking_delta') thinking += event.delta;
      }
      expect(text).toBe('OK'); expect(thinking).toBe('think');
    }
    expect(sent).toEqual([true, false]);
  });
});
