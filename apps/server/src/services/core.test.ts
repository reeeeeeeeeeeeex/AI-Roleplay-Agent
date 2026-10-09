import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { FakeRuntime, PiAgentRuntime, buildWriterContext, type BaseAgentRequest, type WriterRequest } from '@new-ai-chat/agent-runtime';
import { characterInputSchema, connectionInputSchema, conversationInputSchema, turnRequestSchema, lorebookInputSchema, blankState, defaultAgencyPrompts, defaultPromptSettings, promptSettingsSchema } from '@new-ai-chat/contracts';
import { settledStoryIds, applyProposal } from './records.js';
import { StoryContext } from './context.js';
import { Repository } from '../db/repository.js';
import { createTraceSink } from './trace.js';

class InspectRuntime extends FakeRuntime {
  requests: BaseAgentRequest[]=[];
  failRoute=false; failWrite=false;
  override async writeTurn(request: BaseAgentRequest, options: Parameters<FakeRuntime['writeTurn']>[1]) { this.requests.push(request); if(this.failRoute && options.mode === 'writer-agent' && !options.forcedPlan) throw new Error('Writer Agent did not call select_output_voices with a valid selection.'); return super.writeTurn(request, options); }
  override async write(request:WriterRequest,onDelta:(s:string)=>void) {this.requests.push(request);if(this.failWrite)throw new Error('Write failed');return super.write(request,onDelta);}
}
let work:string; let server:Awaited<ReturnType<typeof createApp>>;let runtime:InspectRuntime;let chat:string;let character:string;let connection:string;
beforeEach(async()=>{
  work=mkdtempSync(join(tmpdir(),'new-ai-chat-test-'));runtime=new InspectRuntime();
  server=await createApp({host:'127.0.0.1',port:0,databasePath:join(work,'test.db'),assetDir:join(work,'assets'),webDist:join(work,'web'),pairingToken:null,defaultImportPath:work,fakeModel:false},runtime);
  character=server.repository.createCharacter(characterInputSchema.parse({name:'Sina'})).id;
  connection=server.repository.createConnection(connectionInputSchema.parse({name:'Test',protocol:'openai-responses',baseUrl:'https://example.invalid',model:'test',apiKey:'secret-do-not-return',headers:{Authorization:'header-secret'}})).id;
  // Keep the legacy service scenarios exercising the multi-output Agent path;
  // production defaults remain ordinary writing in the global settings.
  server.repository.setGeneralSettings({ ...server.repository.getGeneralSettings(), connectionId: connection, generationMode: 'writer-agent' });
  chat=server.repository.createConversation(conversationInputSchema.parse({title:'Test story',kind:'solo',characterId:character})).id;
});
afterEach(async()=>{vi.unstubAllGlobals();await server.app.close();rmSync(work,{recursive:true,force:true});});

it('duplicate startup leaves the active server generation and record updates intact', async () => {
  await server.listen();
  const port = (server.app.server.address() as { port: number }).port;
  const turn = server.repository.createTurn(chat, 'active-story-turn', 'normal');
  server.repository.updateTurn(turn.id, { status: 'running', recordsStatus: 'running' });
  const duplicate = await createApp({ ...server.config, port }, new InspectRuntime());
  await expect(duplicate.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  expect(server.repository.getTurn(turn.id)).toMatchObject({ status: 'running', recordsStatus: 'running', error: null });
  expect(server.repository.eventsForTurn(turn.id)).toEqual([]);
});

it('successful startup recovers interrupted generation after acquiring the port', async () => {
  const turn = server.repository.createTurn(chat, 'interrupted-story-turn', 'normal');
  server.repository.updateTurn(turn.id, { status: 'running', recordsStatus: 'running' });
  const config = server.config;
  await server.app.close();
  server = await createApp(config, new InspectRuntime());
  expect(server.repository.getTurn(turn.id)?.status).toBe('running');
  await server.listen();
  expect(server.repository.getTurn(turn.id)).toMatchObject({ status: 'failed', recordsStatus: 'cancelled', error: 'Server restarted during generation.' });
});

it('shutdown aborts active generation before waiting for its open SSE connection', async () => {
  let started!: () => void, aborted = false;
  const running = new Promise<void>(resolve => { started = resolve; });
  runtime.writeTurn = async request => {
    started();
    return new Promise<never>((_resolve, reject) => request.signal.addEventListener('abort', () => {
      aborted = true; reject(request.signal.reason);
    }, { once: true }));
  };
  const address = await server.listen();
  const turn = server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'normal', input: { voice: 'protagonist', text: 'Wait for shutdown.' } }));
  await running;
  const subscription = new AbortController();
  let closing: Promise<void> | undefined, transcript: Promise<string | null> | undefined;
  try {
    const response = await fetch(`${address}/api/turns/${turn.id}/events`, { signal: subscription.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    transcript = response.text().catch(() => null);
    closing = server.app.close();
    await vi.waitFor(() => expect(aborted).toBe(true), { timeout: 800 });
    expect(await transcript).toContain('turn.cancelled');
    await closing;
    expect(server.app.server.listening).toBe(false);
  } finally {
    subscription.abort(); server.turns.cancel(turn.id);
    await (closing ?? server.app.close());
    await transcript;
  }
});

it('shutdown cancels manual record requests and discards late model results', async () => {
  let started!: () => void, finish!: () => void, aborted = false;
  const running = new Promise<void>(resolve => { started = resolve; });
  runtime.maintain = async request => new Promise<string>(resolve => {
    finish = () => resolve(JSON.stringify([{ op: 'updateRow', table: 'global_state', rowId: 1, cells: { current_location: 'Late result' } }]));
    request.signal.addEventListener('abort', () => { aborted = true; finish(); }, { once: true });
    started();
  });
  const address = await server.listen();
  const response = fetch(`${address}/api/conversations/${chat}/state/generate`, { method: 'POST', headers: { connection: 'close' } });
  let closing: Promise<void> | undefined;
  try {
    await running;
    closing = server.app.close();
    await vi.waitFor(() => expect(aborted).toBe(true), { timeout: 800 });
    expect((await response).status).toBeGreaterThanOrEqual(400);
    await closing;
    expect(server.app.server.listening).toBe(false);
    server = await createApp(server.config, runtime);
    expect(server.repository.latestState(chat)).toBeNull();
  } finally {
    finish?.();
    await response;
    await (closing ?? server.app.close());
  }
});

it('local image caching keeps uploaded replacements at distinct URLs', async () => {
  const original = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('original-image-fixture')]);
  const upload = await server.app.inject({ method: 'POST', url: '/api/assets/upload', headers: { 'content-type': 'application/octet-stream' }, payload: original });
  expect(upload.statusCode).toBe(200);
  const firstUrl = upload.json().url;
  const first = await server.app.inject({ url: firstUrl });
  expect(first.headers['cache-control']).toBe('private, max-age=31536000, immutable');
  expect(first.rawPayload).toEqual(original);
  const replacement = Buffer.concat([original, Buffer.from('-replacement')]);
  const replaced = await server.app.inject({ method: 'POST', url: '/api/assets/upload', headers: { 'content-type': 'application/octet-stream' }, payload: replacement });
  expect(replaced.json().url).not.toBe(firstUrl);
  expect((await server.app.inject({ url: replaced.json().url })).rawPayload).toEqual(replacement);
  expect((await server.app.inject({ url: firstUrl })).rawPayload).toEqual(original);
});

it('local image caching preserves pairing and no-store responses for private APIs and errors', async () => {
  const config = server.config;
  await server.app.close();
  const token = 'offline-pairing-fixture-token';
  server = await createApp({ ...config, pairingToken: token }, runtime);
  const name = 'b'.repeat(64) + '.png';
  writeFileSync(join(work, 'assets', name), Buffer.from('image-fixture'));
  const denied = await server.app.inject({ url: `/api/assets/${name}` });
  expect(denied.statusCode).toBe(401);
  expect(denied.headers['cache-control']).toBe('no-store');
  const headers = { authorization: `Bearer ${token}` };
  expect((await server.app.inject({ url: `/api/assets/${name}`, headers })).headers['cache-control']).toContain('private');
  expect((await server.app.inject({ url: '/api/settings/general', headers })).headers['cache-control']).toBe('no-store');
  const missing = await server.app.inject({ url: `/api/assets/${'c'.repeat(64)}.png`, headers });
  expect(missing.statusCode).toBe(404);
  expect(missing.headers['cache-control']).toBe('no-store');
});

it('compact chat history reads once and keeps full active prose without duplicating version bodies', async () => {
  const repo = server.repository;
  const user = repo.createMessage({ conversationId: chat, parentId: null, storyTurnId: 'turn', role: 'user', authorKind: 'protagonist', speaker: null, content: 'Open the door.', providerState: null, legacyPayload: null });
  const original = repo.createMessage({ conversationId: chat, parentId: user.id, storyTurnId: 'turn', role: 'assistant', authorKind: 'character', speaker: { kind: 'character', characterId: character }, content: 'Original story. '.repeat(300), providerState: { private: 'provider-state' }, legacyPayload: { private: 'legacy-content' }, generationInfo: { mode: 'plain', model: 'offline', streaming: true, thinking: 'Visible thinking. '.repeat(300), usage: null, timing: null, requestCount: 1 } });
  const active = repo.createMessage({ ...original, content: 'Current story. '.repeat(300) });
  repo.setHead(chat, active.id);
  expect(repo.getActiveBranch(chat)).toEqual([user, active]);
  expect(repo.getActiveBranch(chat, original.id)).toEqual([user, original]);
  const reads = vi.spyOn(repo, 'listMessages');
  const full = await server.app.inject({ url: `/api/conversations/${chat}/messages` });
  expect(full.statusCode).toBe(200);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(full.json().nodes[1]).toMatchObject({ content: original.content, generationInfo: original.generationInfo, providerState: null, legacyPayload: null });
  reads.mockClear();
  const compact = await server.app.inject({ url: `/api/conversations/${chat}/messages?view=chat` });
  expect(compact.statusCode).toBe(200);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(compact.json().branch).toEqual(full.json().branch);
  expect(compact.json().nodes).toEqual([user, original, active].map(m => ({ id: m.id, parentId: m.parentId, role: m.role, speaker: m.speaker, content: m.content.slice(0, 100) })));
  expect(compact.body).not.toContain('provider-state');
  expect(compact.body).not.toContain('legacy-content');
  expect(compact.rawPayload.length).toBeLessThan(full.rawPayload.length / 2);
});

it('active history rejects cyclic message parents', () => {
  const repo = server.repository;
  const message = repo.createMessage({ conversationId: chat, parentId: null, storyTurnId: null, role: 'user', authorKind: 'protagonist', speaker: null, content: 'Offline cycle guard', providerState: null, legacyPayload: null });
  repo.database.sqlite.prepare('UPDATE messages SET parent_id = ? WHERE id = ?').run(message.id, message.id);
  expect(() => repo.getActiveBranch(chat, message.id)).toThrow('Cycle in message branch.');
});

it('web copy previews plain prose and saves one User at the expected head without generation', async () => {
  const network = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', network);
  const input = { voice: 'narrator', text: '网页写作本轮输入' };
  const response = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/prompt-preview`, payload: { trigger: 'normal', input, replyTarget: { mode: 'auto' } } });
  expect(response.statusCode).toBe(200);
  const preview = response.json();
  expect(preview.webPrompt).toContain(input.text);
  expect(preview.webPrompt).toContain('[Current Speaker]');
  expect(preview.webPrompt).not.toMatch(/select_output_voices|"tools"/u);
  expect(preview.webSpeaker).toEqual({ kind: 'character', characterId: character });
  const payload = { role: 'user', input, head: preview.headMessageId };
  const saved = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/manual-messages`, payload });
  expect(saved.statusCode).toBe(201);
  expect(saved.json().turn).toBeNull();
  expect(server.repository.getActiveBranch(chat)).toEqual([expect.objectContaining({ role: 'user', authorKind: 'user_narrator', content: input.text })]);
  expect((await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/manual-messages`, payload })).statusCode).toBe(409);
  expect(network).not.toHaveBeenCalled(); expect(runtime.requests).toEqual([]);
});

it('manual input setting persists without replacing other general settings', async () => {
  const original = server.repository.getGeneralSettings();
  expect(original.manualInput).toBe(false);
  const changed = await server.app.inject({ method: 'PATCH', url: '/api/settings/general', payload: { manualInput: true } });
  expect(changed.statusCode).toBe(200);
  expect(changed.json()).toEqual({ ...original, manualInput: true });
  expect(new Repository(server.repository.database).getGeneralSettings().manualInput).toBe(true);
  const invalid = await server.app.inject({ method: 'PATCH', url: '/api/settings/general', payload: { manualInput: false, connectionId: null } });
  expect(invalid.statusCode).toBe(400);
  expect(server.repository.getGeneralSettings()).toEqual({ ...original, manualInput: true });
});

it('manual input blocks ordinary generation but permits explicit continuation', async () => {
  const repo = server.repository;
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), manualInput: true });
  const rejected = await server.app.inject({ method: 'POST', url: '/api/turns', payload: { conversationId: chat, trigger: 'normal', input: { voice: 'protagonist', text: '旧页面不应生成' } } });
  expect(rejected.statusCode).toBe(409);
  expect((await server.app.inject({ method: 'POST', url: '/api/turns', payload: { conversationId: chat, trigger: 'auto' } })).statusCode).toBe(409);
  expect(repo.getActiveBranch(chat)).toEqual([]); expect(runtime.requests).toEqual([]);
  const saved = server.turns.appendManual(chat, { role: 'assistant', head: null, speaker: { kind: 'narrator' }, text: '等待主动续写的正文' });
  await server.turns.idle(chat);
  const continued = server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'continue', targetMessageId: saved.message.id }));
  await server.turns.idle(chat);
  expect(repo.getTurn(continued.id)?.status).toBe('completed');
  expect(runtime.requests.length).toBeGreaterThan(0);
  expect(repo.getActiveBranch(chat).at(-1)!.content).toContain(saved.message.content);
});

it('manual pending Users resume through the API in one complete turn', async () => {
  const repo = server.repository;
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), manualInput: true, memoryTurnInterval: 1 });
  const first = server.turns.appendManual(chat, { role: 'user', head: null, input: { voice: 'protagonist', text: '先推开门' } }).message;
  const second = server.turns.appendManual(chat, { role: 'user', head: first.id, input: { voice: 'narrator', text: '门外开始下雨' } }).message;
  await server.app.inject({ method: 'PATCH', url: '/api/settings/general', payload: { manualInput: false } });
  const turn = server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'normal', targetMessageId: second.id, replyTarget: { mode: 'explicit', speaker: { kind: 'narrator' } } }));
  await server.turns.idle(chat);
  const history = repo.getActiveBranch(chat);
  expect(history.map(message => message.role)).toEqual(['user', 'user', 'assistant']);
  expect(new Set(history.map(message => message.storyTurnId))).toEqual(new Set([first.storyTurnId]));
  expect(repo.getTurn(turn.id)?.status).toBe('completed');
  expect(repo.listMemories(chat)[0]!.coverage).toEqual({ startMessageId: first.id, endMessageId: history[2]!.id, storyTurnIds: [first.storyTurnId] });
});

it('manual Assistant replies keep complete turns and run records only at the configured interval', async () => {
  const repo = server.repository;
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), manualInput: true, memoryTurnInterval: 2, stateTurnInterval: 2, historyMessageLimit: 0, connectionId: null });
  const legacy = repo.createMessage({ conversationId: chat, parentId: null, storyTurnId: null, role: 'user', authorKind: 'protagonist', speaker: null, content: '旧 User 正文', providerState: null, legacyPayload: null });
  repo.setHead(chat, legacy.id);
  const maintain = vi.spyOn(runtime, 'maintain');
  const extra = server.turns.appendManual(chat, { role: 'user', head: legacy.id, input: { voice: 'narrator', text: '补充同一轮的旁白' } });
  expect(extra.turn).toBeNull(); expect(maintain).not.toHaveBeenCalled();
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), connectionId: connection });
  const first = server.turns.appendManual(chat, { role: 'assistant', head: extra.message.id, speaker: { kind: 'character', characterId: character }, text: '网页回复第一轮' });
  await server.turns.idle(chat);
  expect(repo.getMessage(legacy.id)!.storyTurnId).toBe(first.message.storyTurnId);
  expect(maintain).not.toHaveBeenCalled();
  const second = server.turns.appendManual(chat, { role: 'assistant', head: first.message.id, speaker: { kind: 'narrator' }, text: '手动续写第二轮' });
  await server.turns.idle(chat);
  expect(repo.getActiveBranch(chat).map(message => message.content)).toEqual(['旧 User 正文', '补充同一轮的旁白', '网页回复第一轮', '手动续写第二轮']);
  expect(extra.message.storyTurnId).toBe(first.message.storyTurnId);
  expect(settledStoryIds(repo, chat)).toEqual([first.message.storyTurnId, second.message.storyTurnId]);
  expect(maintain).toHaveBeenCalledTimes(2);
  expect(repo.listMemories(chat)[0]!.coverage).toEqual({ startMessageId: legacy.id, endMessageId: second.message.id, storyTurnIds: [first.message.storyTurnId, second.message.storyTurnId] });
  expect(repo.getTurn(second.turn!.id)).toMatchObject({ status: 'completed', recordsStatus: 'completed', trigger: 'manual' });
  expect(second.message.generationInfo).toMatchObject({ mode: 'manual', usage: null, requestCount: 0 });
  expect(runtime.requests).toEqual([]);
});

it('manual Assistant save survives record failure and rejects an invalid speaker without appending', async () => {
  const repo = server.repository;
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), memoryTurnInterval: 1, stateTurnInterval: 0 });
  vi.spyOn(runtime, 'maintain').mockRejectedValue(new Error('offline record failure'));
  const saved = server.turns.appendManual(chat, { role: 'assistant', head: null, speaker: { kind: 'narrator' }, text: '已经保存的手动正文' });
  await server.turns.idle(chat);
  expect(repo.getTurn(saved.turn!.id)).toMatchObject({ status: 'completed', recordsStatus: 'failed' });
  expect(() => server.turns.appendManual(chat, { role: 'assistant', head: saved.message.id, speaker: { kind: 'character', characterId: 'foreign-character' }, text: '不应保存' })).toThrow('Speaker is not in this conversation');
  expect(repo.getActiveBranch(chat)).toEqual([saved.message]);
  expect(runtime.requests).toEqual([]);
});

it('developer Trace exposes live model and tool events before a turn completes', async () => {
  const repo = server.repository;
  repo.updateConnection(connection, connectionInputSchema.parse({ ...repo.listConnections()[0]!, protocol: 'openai-chat-completions', reasoning: 'high' }));
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const encode = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'trace-test', object: 'chat.completion.chunk', model: 'test', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  const firstRaw = encode({ reasoning_content: '先读取记忆。', tool_calls: [{ index: 0, id: 'memory-call', type: 'function', function: { name: 'read_memory', arguments: '{}' } }] }) + encode({}, 'tool_calls') + 'data: [DONE]\n\n';
  const lastRaw = encode({ reasoning_content: '现在写正文。' }) + encode({ content: 'Trace 测试正文。' }) + encode({}, 'stop') + 'data: [DONE]\n\n';
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(firstRaw, { headers: { 'content-type': 'text/event-stream' } })).mockImplementationOnce(async () => new Response(new ReadableStream({
    async start(stream) {
      stream.enqueue(new TextEncoder().encode(encode({ reasoning_content: '现在写正文。' })));
      await waiting;
      stream.enqueue(new TextEncoder().encode(encode({ content: 'Trace 测试正文。' }) + encode({}, 'stop') + 'data: [DONE]\n\n'));
      stream.close();
    },
  }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'upstream-trace', authorization: 'not-a-trace-header' } }));
  vi.stubGlobal('fetch', fetchMock);
  const pi = new PiAgentRuntime(); runtime.writeTurn = pi.writeTurn.bind(pi);
  const turn = server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'normal', input: { text: '测试', voice: 'protagonist' }, replyTarget: { mode: 'explicit', speaker: { kind: 'character', characterId: character } } }));
  try {
    await vi.waitFor(() => {
      const live = repo.listTraces(turn.id)[1];
      expect(live?.events.some(event => event.type === 'message_update' && (event.data as any).delta === '现在写正文。')).toBe(true);
    });
    const traces = repo.listTraces(turn.id);
    expect(repo.getTurn(turn.id)?.status).toBe('running');
    expect(traces[0]?.tools[0]).toMatchObject({ name: 'read_memory', ok: true });
    expect(traces[0]?.response).toBe(firstRaw);
    const summary = (await server.app.inject({ method: 'GET', url: `/api/conversations/${chat}/traces?view=summary` })).json();
    expect(summary[0]).not.toHaveProperty('request'); expect(summary[0]).not.toHaveProperty('events');
    const live = (await server.app.inject({ method: 'GET', url: `/api/traces/${traces[1]!.id}?view=live` })).json();
    expect(live.status).toBe('running'); expect(live).not.toHaveProperty('request');
    expect(live.events.find((event: any) => event.type === 'http.response').data).toMatchObject({ status: 200, requestId: 'upstream-trace' });
    expect(JSON.stringify(live)).not.toContain('not-a-trace-header');
  } finally { release(); await server.turns.idle(chat); }
  const trace = repo.listTraces(turn.id)[1]!;
  expect(trace.status).toBe('completed'); expect(trace.response).toBe(lastRaw);
  expect(trace.events.find(event => event.type === 'message_end' && (event.data as any).message.role === 'assistant')?.data).toMatchObject({ message: { stopReason: 'stop', content: expect.arrayContaining([{ type: 'text', text: 'Trace 测试正文。' }]) } });
  expect(repo.getActiveBranch(chat).at(-1)?.content).toBe('Trace 测试正文。');
});

it('row edits repair incomplete records atomically and reject stale deletion', async () => {
  const tables = blankState();
  tables.inventory = [{ row_id: 1, item_name: '', quantity: '', category: '贵重品', description: '资金' }];
  server.repository.createState(chat, null, tables);
  const body = { head: server.repository.getConversation(chat)!.headMessageId, table: 'inventory', rowId: 1, previous: tables.inventory[0] };
  const url = `/api/conversations/${chat}/state/row`;
  const result = await server.app.inject({ method: 'PATCH', url, payload: { ...body, cells: { item_name: '资金', quantity: '1', category: '贵重品', description: '资金' } } });
  expect(result.statusCode).toBe(200);
  const previous = result.json().tables.inventory[0];
  expect(previous).toMatchObject({ item_name: '资金', quantity: '1' });
  expect((await server.app.inject({ method: 'DELETE', url, payload: body })).statusCode).not.toBe(200);
  expect((await server.app.inject({ method: 'DELETE', url, payload: { ...body, previous, head: 'obsolete-branch' } })).statusCode).not.toBe(200);
  const removed = await server.app.inject({ method: 'DELETE', url, payload: { ...body, previous } });
  expect(removed.statusCode).toBe(200); expect(removed.json().tables.inventory).toEqual([]);
});

it('developer Trace retains cancelled partial events and redacts structured secrets', async () => {
  const repo = server.repository;
  const turn = repo.createTurn(chat, 'trace-story', 'auto');
  const sink = createTraceSink(repo, server.events, turn);
  const id = sink.start('writing', 'test');
  const data = { type: 'thinking_delta', contentIndex: 0, delta: '已经返回的思考', signature: 'private-signature' };
  sink.event!(id, 'message_update', data);
  data.delta = 'later mutation';
  sink.event!(id, 'tool_execution_start', { toolCallId: 'call', toolName: 'read_memory', args: {} });
  sink.finish(id, 'cancelled', undefined, 'Cancelled');
  const restored = new Repository(server.repository.database).listTraces(turn.id)[0]!;
  expect(restored.events[0]?.data).toEqual({ type: 'thinking_delta', contentIndex: 0, delta: '已经返回的思考', signature: '[redacted]' });
  expect(restored.status).toBe('cancelled');
  expect((await server.app.inject({ method: 'GET', url: `/api/traces/${id}` })).json().events).toEqual(restored.events);
  sink.flush();
});

it('connection copy keeps credentials on the server and remains independent of its source', async () => {
  const source = server.repository.getRuntimeConnection(connection)!;
  const settings = server.repository.getGeneralSettings();
  const response = await server.app.inject({ method: 'POST', url: `/api/connections/${connection}/copy`, payload: { name: '  Copy  ' } });
  expect(response.statusCode).toBe(201);
  const copied = response.json();
  expect(copied).toMatchObject({ name: 'Copy', hasApiKey: true, headers: { Authorization: '[stored]' } });
  expect(response.body).not.toContain(source.apiKey);
  expect(response.body).not.toContain(source.headers.Authorization);
  expect(server.repository.getRuntimeConnection(copied.id)).toEqual({ ...source, id: copied.id });
  server.repository.updateConnection(copied.id, connectionInputSchema.parse({ ...source, name: 'Edited copy', model: 'another-model', apiKey: 'copy-only-fixture-key' }));
  expect(server.repository.getRuntimeConnection(connection)).toEqual(source);
  expect(server.repository.getGeneralSettings()).toEqual(settings);
});

it('model settings: discovers models with saved credentials without saving the draft', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] }));
  vi.stubGlobal('fetch', fetchMock);
  const payload = { connectionId: connection, protocol: 'openai-responses', baseUrl: 'https://example.invalid', headers: { Authorization: '[stored]' } };
  const response = await server.app.inject({ method: 'POST', url: '/api/connections/models', payload });
  expect(response.json()).toEqual({ models: ['model-a', 'model-b'] });
  const [url, options] = fetchMock.mock.calls[0]!;
  expect(String(url)).toBe('https://example.invalid/models');
  expect(options.headers.get('Authorization')).toBe('header-secret');
  expect(options.redirect).toBe('error');
  expect(server.repository.listConnections()).toHaveLength(1);
  const changed = await server.app.inject({ method: 'POST', url: '/api/connections/models', payload: { ...payload, baseUrl: 'https://other.invalid' } });
  expect(changed.statusCode).toBe(400);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
async function normal(voice='protagonist',replyTarget:any={mode:'auto'}) {
  const turn=server.turns.start(turnRequestSchema.parse({conversationId:chat,input:{text:'推开门。',voice},replyTarget}));await server.turns.idle(chat);return server.repository.getTurn(turn.id)!;
}
it('empty send replies to the edited user in the same complete turn and rejects stale targets', async () => {
  const repo = server.repository;
  const original = await normal();
  const old = repo.getActiveBranch(chat);
  const deletion = await server.app.inject({ method: 'DELETE', url: `/api/conversations/${chat}/messages/${old[1]!.id}`, payload: { head: old.at(-1)!.id } });
  expect(deletion.statusCode).toBe(200);
  const edited = (await server.app.inject({ method: 'POST', url: `/api/messages/${old[0]!.id}/edit`, payload: { content: '修改后，我敲了敲门。', previous: old[0]!.content, head: old[0]!.id } })).json();
  const stale = { conversationId: chat, trigger: 'normal', targetMessageId: old[0]!.id };
  expect((await server.app.inject({ method: 'POST', url: '/api/turns', payload: stale })).statusCode).toBe(409);
  expect((await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/prompt-preview`, payload: stale })).statusCode).toBe(409);
  const payload = { ...stale, targetMessageId: edited.id };
  expect(turnRequestSchema.safeParse({ ...payload, input: { voice: 'protagonist', text: '重复的输入' } }).success).toBe(false);
  const response = await server.app.inject({ method: 'POST', url: '/api/turns', payload });
  expect(response.statusCode).toBe(202); await server.turns.idle(chat);
  const branch = repo.getActiveBranch(chat);
  expect(repo.getTurn(response.json().id)?.status).toBe('completed');
  expect(branch).toHaveLength(3);
  expect(branch.filter(row => row.role === 'user').map(row => row.id)).toEqual([edited.id]);
  expect(branch.every(row => row.storyTurnId === original.storyTurnId)).toBe(true);
  expect(runtime.requests.at(-1)?.latestUserText).toBe(edited.content);
  expect(settledStoryIds(repo, chat)).toEqual([original.storyTurnId]);
  await server.records.generate(chat, 'memory', new AbortController().signal);
  expect(repo.listMemories(chat)[0]?.coverage).toEqual({ startMessageId: edited.id, endMessageId: branch.at(-1)!.id, storyTurnIds: [original.storyTurnId] });
});

it('empty send preview matches the real gateway body for an edited legacy user message', async () => {
  const repo = server.repository;
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), generationMode: 'plain', streaming: false });
  repo.updateConnection(connection, connectionInputSchema.parse({ ...repo.listConnections()[0]!, protocol: 'openai-chat-completions' }));
  const user = repo.createMessage({ conversationId: chat, parentId: null, storyTurnId: null, role: 'user', authorKind: 'user_narrator', speaker: null, content: '旧输入', providerState: null, legacyPayload: null });
  repo.setHead(chat, user.id);
  const edited = (await server.app.inject({ method: 'POST', url: `/api/messages/${user.id}/edit`, payload: { content: '雨停了，窗边传来敲击声。', head: user.id } })).json();
  const payload = { conversationId: chat, trigger: 'normal', targetMessageId: edited.id };
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    id: 'offline-reply', object: 'chat.completion', created: 0, model: 'test',
    choices: [{ index: 0, message: { role: 'assistant', content: '她抬头望向窗户。' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const preview = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/prompt-preview`, payload });
  expect(preview.statusCode).toBe(200);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(repo.getMessage(edited.id)?.storyTurnId).toBeNull();
  const pi = new PiAgentRuntime(); runtime.writeTurn = pi.writeTurn.bind(pi);
  const response = await server.app.inject({ method: 'POST', url: '/api/turns', payload });
  expect(response.statusCode).toBe(202); await server.turns.idle(chat);
  expect(repo.getTurn(response.json().id)?.status).toBe('completed');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const actual = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
  expect(actual).toEqual(JSON.parse(preview.json().requestBody));
  expect(actual.messages.at(-1).content).toContain(`[User Narration]\n以下是用户本轮输入：\n“${edited.content}”`);
  expect(JSON.stringify(actual)).not.toContain('旧输入');
  const branch = repo.getActiveBranch(chat);
  expect(branch).toHaveLength(2);
  expect(branch[0]!.storyTurnId).toBe(response.json().storyTurnId);
  expect(branch[1]!.storyTurnId).toBe(branch[0]!.storyTurnId);
});

it('seeds the selected Persona once on the first real send and exposes bilingual state to the model', async () => {
  const repo = server.repository;
  const first = repo.createPersona({ name: 'First', description: 'free text', avatarPath: null });
  const selected = repo.createPersona({ name: 'Selected', description: 'free text', avatarPath: null, stateTemplate: { appearance: '银发', current_outfit: '蓝披风', past_experience_before_story: '故乡长大', skills: [{ skill_name: '剑术', skill_type: '战斗', skill_level: '2', effect_description: '快剑' }] } });
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), generationMode: 'plain', defaultPersonaId: first.id });
  const preview = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/prompt-preview`, payload: { trigger: 'normal', input: { text: '开始', voice: 'protagonist' } } });
  expect(preview.statusCode).toBe(200); expect(repo.latestState(chat)).toBeNull();
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), defaultPersonaId: selected.id });
  await normal();
  const seeded = repo.latestState(chat)!;
  expect(seeded.version).toBe(2);
  expect(seeded.tables.protagonist_info[0]).toMatchObject({ character_name: 'Selected', appearance: '银发', current_outfit: '蓝披风', past_experience_before_story: '故乡长大', past_experience_in_story: '' });
  expect(seeded.tables.protagonist_skills[0]).toMatchObject({ skill_name: '剑术', skill_type: '战斗', row_id: 1 });
  expect((await new StoryContext(repo, chat).readState())?.column_labels.protagonist_info?.occupation).toBe('Occupation / 身份与地位');
  expect((await new StoryContext(repo, chat).dynamic('')).find(item => item.source === 'state')?.content).toContain('故事前经历');
  repo.updatePersona(selected.id, { ...selected, stateTemplate: { ...selected.stateTemplate, current_outfit: '红披风' } });
  await normal();
  expect(repo.latestState(chat)?.id).toBe(seeded.id);
  expect(repo.latestState(chat)?.tables.protagonist_info[0]?.current_outfit).toBe('蓝披风');
});

it('seeds a group after its real User message and keeps an existing branch checkpoint', async () => {
  const repo = server.repository;
  const persona = repo.createPersona({ name: 'Group Hero', description: '', avatarPath: null, stateTemplate: { occupation: '领主' } });
  const group = repo.createGroup({ name: 'Group', memberIds: [character], scenario: '' });
  const groupChat = repo.createConversation(conversationInputSchema.parse({ title: 'Old group', kind: 'group', groupId: group.id, personaId: persona.id }));
  const start = () => server.turns.start(turnRequestSchema.parse({ conversationId: groupChat.id, trigger: 'normal', input: { text: '开始', voice: 'protagonist' }, replyTarget: { mode: 'explicit', speaker: { kind: 'character', characterId: character } } }));
  start(); await server.turns.idle(groupChat.id);
  expect(repo.latestState(groupChat.id)?.tables.protagonist_info[0]).toMatchObject({ character_name: 'Group Hero', occupation: '领主' });
  const existing = repo.latestState(groupChat.id)!;
  start(); await server.turns.idle(groupChat.id);
  expect(repo.latestState(groupChat.id)?.id).toBe(existing.id);
});

it('allows manual pre-story correction after the seed but rejects model patch operations', async () => {
  const repo = server.repository;
  const persona = repo.createPersona({ name: 'Hero', description: '', avatarPath: null });
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), defaultPersonaId: persona.id });
  await normal();
  const head = repo.getConversation(chat)!.headMessageId;
  const response = await server.app.inject({ method: 'PATCH', url: `/api/conversations/${chat}/state/cell`, payload: { head, table: 'protagonist_info', rowId: 1, column: 'past_experience_before_story', previous: '', content: '自己填写' } });
  expect(response.statusCode).toBe(200);
  expect(repo.latestState(chat)?.tables.protagonist_info[0]?.past_experience_before_story).toBe('自己填写');
  const blocked = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/state/patch`, payload: [{ op: 'updateRow', table: 'protagonist_info', rowId: 1, cells: { past_experience_before_story: '模型改写' } }] });
  expect(blocked.statusCode).not.toBe(200);
  expect(repo.latestState(chat)?.tables.protagonist_info[0]?.past_experience_before_story).toBe('自己填写');
});
it('record send switches gate injected context and tool reads while keeping fixed facts', async () => {
  const repo = server.repository;
  repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: null, source: 'generated', content: '灯塔记忆' });
  repo.createState(chat, null, blankState());
  repo.savePinnedFact(chat, '不可丢弃的事实', null);
  const enabled = new StoryContext(repo, chat);
  expect(await enabled.readMemory(5)).toHaveLength(1);
  expect(await enabled.readState()).not.toBeNull();
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), sendMemory: false, sendProtagonistState: false });
  const request = await server.turns.request(chat, 'test', new AbortController().signal);
  expect(request.dynamicContext.map(item => item.content)).toEqual(['不可丢弃的事实']);
  expect(await request.source.readMemory(5)).toEqual([]);
  expect(await request.source.searchMemory('灯塔', 5)).toEqual([]);
  expect(await request.source.readState()).toBeNull();
});

it('record model: manual maintenance shares its connection and retains its own records', async () => {
  await normal();
  const repo = server.repository;
  const selected = repo.createConnection(connectionInputSchema.parse({ name: 'Records', protocol: 'openai-chat-completions', baseUrl: 'https://example.invalid', model: 'record-model', temperature: 0.3, maxTokens: 2048, contextWindow: 32000, reasoning: 'low', historyMessageLimit: 1 }));
  repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: null, source: 'generated', content: '已有记忆' });
  repo.createState(chat, null, blankState());
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), recordConnectionId: selected.id, sendMemory: false, sendProtagonistState: false, streaming: false });
  const maintain = vi.spyOn(runtime, 'maintain').mockResolvedValueOnce('[]').mockResolvedValueOnce(JSON.stringify({ timeSpan: '今日', location: '门口', chronicle: '主角推开了门。', dialogue: [], overview: '进门' }));
  await server.records.generate(chat, 'state', new AbortController().signal);
  await server.records.generate(chat, 'memory', new AbortController().signal);
  expect(maintain.mock.calls[0]![0].dynamicContext.map(item => item.source)).toEqual(['state']);
  expect(maintain.mock.calls[1]![0].dynamicContext.map(item => item.content)).toEqual(['已有记忆']);
  expect(maintain.mock.calls.map(([request]) => ({ connection: request.connection, streaming: request.streaming }))).toEqual([
    { connection: expect.objectContaining({ id: selected.id, model: 'record-model', temperature: 0.3, maxTokens: 2048, contextWindow: 32000, reasoning: 'low', historyMessageLimit: 0 }), streaming: false },
    { connection: expect.objectContaining({ id: selected.id, model: 'record-model', temperature: 0.3, maxTokens: 2048, contextWindow: 32000, reasoning: 'low', historyMessageLimit: 0 }), streaming: false },
  ]);
  expect(runtime.requests[0]!.connection.id).toBe(connection);
});

it('record model: automatic maintenance uses the shared selection for both updates', async () => {
  await normal();
  const repo = server.repository;
  const selected = repo.createConnection(connectionInputSchema.parse({ name: 'Records', protocol: 'openai-responses', baseUrl: 'https://example.invalid', model: 'automatic-records' }));
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), recordConnectionId: selected.id, memoryTurnInterval: 1, stateTurnInterval: 1 });
  const maintain = vi.spyOn(runtime, 'maintain');
  await server.records.automatic(chat, new AbortController().signal);
  expect(maintain.mock.calls.map(([request]) => request.connection.id)).toEqual([selected.id, selected.id]);
});

it('record model: validates selection and restores the default when its connection is deleted', async () => {
  const repo = server.repository;
  expect(repo.getGeneralSettings().recordConnectionId).toBeNull();
  const invalid = await server.app.inject({ method: 'PUT', url: '/api/settings/general', payload: { ...repo.getGeneralSettings(), recordConnectionId: 'missing' } });
  expect(invalid.statusCode).toBe(400);
  const selected = repo.createConnection(connectionInputSchema.parse({ name: 'Records', protocol: 'openai-responses', baseUrl: 'https://example.invalid', model: 'records' }));
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), recordConnectionId: selected.id });
  repo.deleteConnection(selected.id);
  expect(new Repository(repo.database).getGeneralSettings().recordConnectionId).toBeNull();
  const request = await server.turns.request(chat, 'manual', new AbortController().signal, false, undefined, 'state');
  expect(request.connection.id).toBe(connection);
});

it('prompt presets: persist create rename update and delete independently of active prompts', async () => {
  const active = server.repository.getPromptSettings();
  const prompts = { ...active, mainInstruction: 'Preset writing rules.', additionalInstruction: 'Preset additional rules.' };
  const created = await server.app.inject({ method: 'POST', url: '/api/settings/prompt-presets', payload: { name: '  故事预设  ', prompts } });
  expect(created.statusCode).toBe(201);
  const preset = created.json();
  expect(preset).toEqual({ id: expect.any(String), name: '故事预设', prompts });
  const renamed = await server.app.inject({ method: 'PATCH', url: `/api/settings/prompt-presets/${preset.id}`, payload: { name: '新版预设' } });
  expect(renamed.json()).toEqual({ ...preset, name: '新版预设' });
  const updated = { ...prompts, plannerInstruction: 'New planning rules.' };
  await server.app.inject({ method: 'PATCH', url: `/api/settings/prompt-presets/${preset.id}`, payload: { prompts: updated } });
  expect(new Repository(server.repository.database).listPromptPresets()).toEqual([{ id: preset.id, name: '新版预设', prompts: updated }]);
  const removed = await server.app.inject({ method: 'DELETE', url: `/api/settings/prompt-presets/${preset.id}` });
  expect(removed.json()).toEqual({ deleted: true });
  expect((await server.app.inject({ method: 'GET', url: '/api/settings/prompt-presets' })).json()).toEqual([]);
  expect(server.repository.getPromptSettings()).toEqual(active);
});

it('prompt presets: reject blank or duplicate names without overwriting saved content', async () => {
  const first = server.repository.createPromptPreset({ name: '已有预设', prompts: defaultPromptSettings });
  const blank = await server.app.inject({ method: 'POST', url: '/api/settings/prompt-presets', payload: { name: '  ', prompts: defaultPromptSettings } });
  expect(blank.statusCode).toBe(400);
  const duplicate = await server.app.inject({ method: 'POST', url: '/api/settings/prompt-presets', payload: { name: ' 已有预设 ', prompts: { ...defaultPromptSettings, mainInstruction: 'Do not overwrite.' } } });
  expect(duplicate.statusCode).toBe(400);
  expect(duplicate.json().error).toBe('预设名称已存在。');
  const second = server.repository.createPromptPreset({ name: '另一预设', prompts: defaultPromptSettings });
  const rename = await server.app.inject({ method: 'PATCH', url: `/api/settings/prompt-presets/${second.id}`, payload: { name: first.name } });
  expect(rename.statusCode).toBe(400);
  expect(server.repository.listPromptPresets()).toEqual([first, second]);
});

it('action choices use independent settings and history, persist edited groups and never become story context', async () => {
  const repo = server.repository;
  let parent: string | null = null;
  for (let index = 0; index < 25; index++) parent = repo.createMessage({ conversationId: chat, parentId: parent, storyTurnId: null, role: 'user', authorKind: 'protagonist', speaker: null, content: `history-${index}`, providerState: null, legacyPayload: null }).id;
  repo.setHead(chat, parent);
  const branch = repo.getActiveBranch(chat);
  repo.setHistoryStart(chat, branch[10]!.id);
  const alternate = repo.createConnection(connectionInputSchema.parse({ name: 'Choices', protocol: 'openai-chat-completions', baseUrl: 'https://example.invalid', model: 'choices-model', temperature: 0.4 })).id;
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), historyMessageLimit: 1, sendMemory: false, actionChoices: { ...repo.getGeneralSettings().actionChoices, connectionId: alternate, count: 1, temperature: 0.2, streaming: false } });
  repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: null, source: 'generated', content: 'excluded-memory' });
  const generate = vi.spyOn(runtime, 'choices');
  const path = `/api/conversations/${chat}/action-choices`;
  const first = (await server.app.inject({ method: 'POST', url: path, payload: { head: parent } })).json();
  expect(first.groups[0].choices).toHaveLength(1);
  expect(generate.mock.calls[0]![0].history.map(message => message.id)).toEqual(branch.slice(10).map(message => message.id));
  expect(generate.mock.calls[0]![0]).toMatchObject({ streaming: false, connection: { id: alternate, temperature: 0.2 } });
  expect(generate.mock.calls[0]![0].dynamicContext).toEqual([]);
  const edited = await server.app.inject({ method: 'PATCH', url: path, payload: { head: parent, groupId: first.selectedGroupId, index: 0, previous: first.groups[0].choices[0], text: '唯一的候选行动' } });
  expect(edited.statusCode).toBe(200);
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), actionChoices: { ...repo.getGeneralSettings().actionChoices, count: 4, historyMessageLimit: 2 } });
  const second = (await server.app.inject({ method: 'POST', url: path, payload: { head: parent } })).json();
  expect(second.groups.map((group: any) => group.choices.length)).toEqual([1, 4]);
  expect(generate.mock.calls[1]![0].history).toHaveLength(2);
  expect(JSON.stringify(generate.mock.calls[1])).not.toContain('唯一的候选行动');
  await server.app.inject({ method: 'PUT', url: `${path}/selection`, payload: { head: parent, groupId: first.selectedGroupId } });
  const restored = (await server.app.inject({ method: 'GET', url: `${path}?head=${parent}` })).json();
  expect(restored.selectedGroupId).toBe(first.selectedGroupId);
  expect(restored.groups[0].choices).toEqual(['唯一的候选行动']);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(repo.getActiveBranch(chat)).toHaveLength(25);
  expect(repo.listMemories(chat)).toHaveLength(1);
  expect(settledStoryIds(repo, chat)).toEqual([]);
});

it('action choices reject duplicate generation and discard results after a branch change', async () => {
  const repo = server.repository;
  const message = repo.createMessage({ conversationId: chat, parentId: null, storyTurnId: null, role: 'user', authorKind: 'protagonist', speaker: null, content: 'start', providerState: null, legacyPayload: null });
  repo.setHead(chat, message.id);
  let release!: (choices: string[]) => void;
  vi.spyOn(runtime, 'choices').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = server.choices.generate(chat, message.id, new AbortController().signal);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  await expect(server.choices.generate(chat, message.id, new AbortController().signal)).rejects.toThrow('正在生成');
  repo.setHead(chat, null);
  release(['一', '二', '三', '四']);
  await expect(pending).rejects.toThrow('故事已改变');
  expect(server.choices.get(chat, message.id).groups).toEqual([]);
});
it('general settings: migrates old global values and persists updates', async () => {
  const db = server.repository.database;
  server.repository.updateConnection(connection, connectionInputSchema.parse({ ...server.repository.listConnections()[0]!, historyMessageLimit: 7 }));
  db.sqlite.prepare("DELETE FROM app_settings WHERE key = 'general'").run();
  const put = db.sqlite.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
  put.run('defaultConnection', JSON.stringify(connection));
  put.run('narrator', JSON.stringify({ name: '记录者', avatarPath: null, style: 'restrained' }));
  const migrated = new Repository(db).getGeneralSettings();
  expect(migrated).toMatchObject({ connectionId: connection, generationMode: 'plain', streaming: true, agencyMode: 'protected', agencyPrompts: defaultAgencyPrompts, narrator: { name: '记录者' }, memoryTurnInterval: 10, stateTurnInterval: 0, historyMessageLimit: 7 });
  const changed = { ...migrated, generationMode: 'plain', agencyMode: 'coauthor', memoryTurnInterval: 3 };
  expect((await server.app.inject({ method: 'PUT', url: '/api/settings/general', payload: changed })).statusCode).toBe(200);
  expect((await server.app.inject({ url: '/api/settings/general' })).json()).toEqual(changed);
  expect(new Repository(db).getGeneralSettings()).toEqual(changed);
  const invalid = await server.app.inject({ method: 'PUT', url: '/api/settings/general', payload: { ...changed, agencyPrompts: { ...changed.agencyPrompts, protected: '   ' } } });
  expect(invalid.statusCode).toBe(400);
  expect(server.repository.getGeneralSettings()).toEqual(changed);
  const legacyMainInstruction = "Continue the current fictional roleplay as {{char}} and the scene narrator, faithfully preserving established characterization, relationships, world rules, and scene continuity while responding directly to {{user}}'s latest input without deciding {{user}}'s thoughts, dialogue, or choices.";
  expect(promptSettingsSchema.parse({ mainInstruction: legacyMainInstruction }).mainInstruction).toBe(defaultPromptSettings.mainInstruction);
  expect(promptSettingsSchema.parse({ mainInstruction: 'Custom writing rules.' }).mainInstruction).toBe('Custom writing rules.');
});

it('fixed history start overrides the rolling count and appends without changing the history prefix', async () => {
  const repo = server.repository;
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), historyMessageLimit: 2, generationMode: 'plain' });
  let parent: string | null = null;
  for (let index = 0; index < 6; index++) {
    const node = repo.createMessage({ conversationId: chat, parentId: parent, storyTurnId: null, role: index % 2 ? 'assistant' : 'user', authorKind: index % 2 ? 'character' : 'protagonist', speaker: index % 2 ? { kind: 'character', characterId: character } : null, content: `history-${index}`, providerState: null, legacyPayload: null });
    parent = node.id;
  }
  repo.setHead(chat, parent);
  const branch = repo.getActiveBranch(chat);
  expect(new StoryContext(repo, chat).history.map(node => node.id)).toEqual(branch.slice(-2).map(node => node.id));
  const selected = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/history-start`, payload: { messageId: branch[2]!.id } });
  expect(selected.statusCode).toBe(200);
  const request = await server.turns.request(chat, 'preview', new AbortController().signal);
  expect(request.fixedHistory).toBe(true);
  expect(request.history.map(node => node.id)).toEqual(branch.slice(2).map(node => node.id));
  expect((await request.source.readRecentStory(100)).map(node => node.id)).toEqual(branch.slice(2).map(node => node.id));
  const pi = new PiAgentRuntime();
  const first = await pi.previewFirstRequest(request, 'plain');
  expect(first.requestBody).not.toContain('history-0');
  expect(first.requestBody).not.toContain('history-1');
  expect(first.contextReport.items.find(item => item.id === branch[0]!.id)).toMatchObject({ included: false, reason: '固定发送起点之前' });
  const next = await server.turns.request(chat, 'preview-next', new AbortController().signal, false, { voice: 'protagonist', text: 'history-6' });
  const appended = await pi.previewFirstRequest(next, 'plain');
  const input = JSON.parse(first.requestBody).input;
  expect(JSON.parse(appended.requestBody).input.slice(0, 1 + request.history.length)).toEqual(input.slice(0, 1 + request.history.length));
  expect(next.history).toHaveLength(5);
  repo.setHistoryStart(chat, null);
  expect(new StoryContext(repo, chat).history).toHaveLength(2);
});

it('fixed history start follows sibling replies and survives archive ID remapping', async () => {
  const repo = server.repository;
  await normal();
  const original = repo.getActiveBranch(chat);
  repo.setHistoryStart(chat, original[1]!.id);
  const sibling = repo.createMessage({ ...original[1]!, content: '另一个版本' });
  repo.setHead(chat, sibling.id);
  expect(new StoryContext(repo, chat).history.map(node => node.id)).toEqual([sibling.id]);
  repo.setHead(chat, original[0]!.id);
  expect(new StoryContext(repo, chat).history).toEqual([]);
  const before = await server.turns.request(chat, 'preview', new AbortController().signal);
  expect(before.latestUserText).toBe('');
  repo.setHead(chat, null);
  expect(() => new StoryContext(repo, chat)).toThrow('固定发送起点不在当前分支');
  repo.setHead(chat, sibling.id);
  const archive = (await server.app.inject({ url: `/api/conversations/${chat}/export?format=native` })).json();
  const restored = await server.app.inject({ method: 'POST', url: '/api/imports/story/execute', payload: archive });
  expect(restored.statusCode, restored.body).toBe(201);
  const copy = restored.json();
  expect(copy.historyStartMessageId).not.toBe(original[1]!.id);
  expect(repo.getMessage(copy.historyStartMessageId)?.conversationId).toBe(copy.id);
  expect(new StoryContext(repo, copy.id).history.map(node => node.content)).toEqual(['另一个版本']);
});

it('general settings: old and new stories share preview and generation settings', async () => {
  const repo = server.repository;
  repo.database.sqlite.prepare("UPDATE conversations SET connection_id = ?, generation_mode = 'planner', planner_enabled = 1, narrator_name = '旧旁白', agency_mode = 'protected' WHERE id = ?").run(connection, chat);
  const selected = repo.createConnection(connectionInputSchema.parse({ name: 'Shared', protocol: 'openai-responses', baseUrl: 'https://example.invalid', model: 'shared-model' }));
  const settings = { ...repo.getGeneralSettings(), connectionId: selected.id, generationMode: 'plain', agencyMode: 'coauthor', agencyPrompts: { protected: '保护 User：等待决定。', coauthor: '共同创作 User：描写行动与内心。' }, narrator: { name: '全局旁白', avatarPath: null, style: '简短叙述' } };
  await server.app.inject({ method: 'PUT', url: '/api/settings/general', payload: settings });
  expect(new Repository(repo.database).getGeneralSettings().agencyPrompts).toEqual(settings.agencyPrompts);
  const group = repo.createGroup({ name: 'Group', memberIds: [character], scenario: 'group scene' });
  const created = await server.app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'New', kind: 'group', groupId: group.id, connectionId: connection, generationMode: 'planner' } });
  const writeTurn = vi.spyOn(runtime, 'writeTurn');
  for (const id of [chat, created.json().id]) {
    const story = (await server.app.inject({ url: `/api/conversations/${id}` })).json();
    expect(story).not.toHaveProperty('connectionId');
    expect(story).not.toHaveProperty('generationMode');
    const preview = (await server.app.inject({ method: 'POST', url: `/api/conversations/${id}/prompt-preview`, payload: { trigger: 'normal', input: { text: '开门。', voice: 'protagonist' }, replyTarget: { mode: 'explicit', speaker: { kind: 'narrator' } } } })).json();
    expect(preview.generationMode).toBe('plain');
    expect(preview.protocol).toBe('openai-responses');
    expect(preview.requestBody).toContain('[Main Instruction]');
    expect(preview.requestBody).toContain('全局旁白');
    expect(preview.requestBody).toContain(settings.agencyPrompts.coauthor);
    expect(preview.requestBody).not.toContain(settings.agencyPrompts.protected);
    const turn = server.turns.start(turnRequestSchema.parse({ conversationId: id, input: { text: '开门。', voice: 'protagonist' }, replyTarget: { mode: 'explicit', speaker: { kind: 'narrator' } } }));
    await server.turns.idle(id);
    expect(repo.getTurn(turn.id)?.status).toBe('completed');
    expect(runtime.requests.at(-1)).toMatchObject({ connection: { id: selected.id }, agencyMode: 'coauthor', agencyPrompts: settings.agencyPrompts, narrator: settings.narrator });
  }
  expect(writeTurn.mock.calls.map(([, options]) => options.mode)).toEqual(['plain', 'plain']);
  const network = vi.fn(() => { throw new Error('preview must not use the network'); });
  vi.stubGlobal('fetch', network);
  const messageCount = repo.listMessages(chat).length;
  for (const [generationMode, phase, tool] of [['plain', 'plain', null], ['writer-agent', 'selection', 'select_output_voices'], ['planner', 'planning', 'submit_turn_plan']] as const) {
    repo.setGeneralSettings({ ...repo.getGeneralSettings(), generationMode });
    const response = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/prompt-preview`, payload: { trigger: 'normal', input: { text: '推开门。', voice: 'protagonist' }, replyTarget: { mode: 'auto' } } });
    expect(response.statusCode).toBe(200);
    const preview = response.json();
    expect(preview).toMatchObject({ action: 'normal', generationMode, phase, protocol: 'openai-responses', personaName: null });
    expect(preview.requestBody).toContain('推开门。');
    expect(preview.requestBody).toContain(settings.agencyPrompts.coauthor);
    if (tool) expect(preview.requestBody).toContain(tool);
  }
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), generationMode: 'plain' });
  const auto = (await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/prompt-preview`, payload: { trigger: 'auto', replyTarget: { mode: 'auto' } } })).json();
  expect(auto.action).toBe('auto');
  expect(auto.requestBody).not.toContain('[Latest User Input]');
  expect(repo.listMessages(chat)).toHaveLength(messageCount);
  expect(network).not.toHaveBeenCalled();
});
it('default persona and story binding keep previews, generation and the latest input consistent', async () => {
  const repo = server.repository;
  const first = repo.createPersona({ name: 'tree', description: 'first persona', avatarPath: null });
  const second = repo.createPersona({ name: 'River', description: 'second persona', avatarPath: null });
  const settings = { ...repo.getGeneralSettings(), generationMode: 'plain', defaultPersonaId: first.id };
  expect((await server.app.inject({ method: 'PUT', url: '/api/settings/general', payload: settings })).statusCode).toBe(200);
  expect(new Repository(repo.database).getGeneralSettings().defaultPersonaId).toBe(first.id);
  const newChat = repo.createConversation(conversationInputSchema.parse({ title: 'New', kind: 'solo', characterId: character }));
  expect(repo.resolvePersona(newChat.personaId)?.id).toBe(first.id);
  repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: null, source: 'generated', content: 'old memory' });
  repo.createState(chat, null, blankState());
  const response = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/prompt-preview`, payload: { trigger: 'normal', input: { text: '打开窗户。', voice: 'protagonist' } } });
  expect(response.statusCode).toBe(200);
  expect(response.json().personaName).toBe('tree');
  const body = JSON.parse(response.json().requestBody);
  const payload = JSON.stringify(body);
  const last = JSON.stringify(body.input.at(-1));
  expect(last).toContain('以下是用户本轮输入：');
  expect(last).toContain('打开窗户。');
  expect(payload.indexOf('[Memory:')).toBeLessThan(payload.lastIndexOf('以下是用户本轮输入：'));
  expect(payload).toContain('[User State]');
  expect(payload.indexOf('[User State]')).toBeLessThan(payload.lastIndexOf('以下是用户本轮输入：'));
  expect(repo.listMessages(chat)).toHaveLength(0);
  await normal();
  expect(runtime.requests[0]?.persona?.name).toBe('tree');
  const saved = repo.getConversation(chat)!;
  expect((await server.app.inject({ method: 'PUT', url: `/api/conversations/${chat}`, payload: { ...saved, personaId: first.id } })).statusCode).toBe(200);
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), defaultPersonaId: second.id });
  expect(repo.resolvePersona(repo.getConversation(chat)!.personaId)?.id).toBe(first.id);
  expect(repo.resolvePersona(newChat.personaId)?.id).toBe(second.id);
  repo.setGeneralSettings({ ...repo.getGeneralSettings(), historyMessageLimit: 1 });
  const request = await server.turns.request(chat, 'preview', new AbortController().signal);
  expect(request.history).toHaveLength(1);
  expect(request.history[0]?.role).toBe('assistant');
  expect(request.latestUserText).toBe('推开门。');
  expect((await server.turns.request(chat, 'auto', new AbortController().signal, true)).latestUserText).toBe('');
  repo.deletePersona(second.id);
  expect(repo.getGeneralSettings().defaultPersonaId).toBeNull();
});

describe('native turns and narrator',()=>{
  it('v0.2 retains the first output and retries only the interrupted second voice', async () => {
    const group = server.repository.createGroup({ name: 'Recovery', memberIds: [character], scenario: '' });
    server.repository.updateConversation(chat, { ...server.repository.getConversation(chat)!, kind: 'group', characterId: null, groupId: group.id });
    const original = runtime.write.bind(runtime);
    runtime.write = async (request, delta) => {
      if (request.outputIndex === 1) { delta('unfinished'); throw new Error('second voice failed'); }
      return original(request, delta);
    };
    const route = vi.spyOn(runtime, 'route');
    const turn = await normal();
    expect(turn.status).toBe('partial');
    const first = server.repository.getActiveBranch(chat);
    expect(first.map(m => m.authorKind)).toEqual(['protagonist', 'narrator']);
    expect(turn.progress?.interruptedOutputs[0]?.text).toBe('unfinished');
    expect(settledStoryIds(server.repository, chat)).toEqual([]);
    server.repository.setHead(chat, first[0]!.id);
    expect(() => server.turns.retry(turn.id)).toThrow(/分支/);
    server.repository.setHead(chat, first[1]!.id);
    server.repository.updateTurn(turn.id, { status: 'running' });
    server.repository.recoverInterruptedTurns();
    expect(server.repository.getTurn(turn.id)?.status).toBe('partial');
    server.repository.setGeneralSettings({ ...server.repository.getGeneralSettings(), generationMode: 'plain' });
    runtime.write = original;
    const retry = server.turns.retry(turn.id); await server.turns.idle(chat);
    const branch = server.repository.getActiveBranch(chat);
    expect(server.repository.getTurn(retry.id)?.status).toBe('completed');
    expect(branch.map(m => m.authorKind)).toEqual(['protagonist', 'narrator', 'character']);
    expect(branch.slice(0, 2)).toEqual(first);
    expect(branch.at(-1)?.storyTurnId).toBe(turn.storyTurnId);
    expect(route).toHaveBeenCalledTimes(1);
    expect(settledStoryIds(server.repository, chat)).toEqual([turn.storyTurnId]);
  });
  it('preserves user narration as user and AI narration as assistant',async()=>{await normal('narrator',{mode:'explicit',speaker:{kind:'narrator'}});const b=server.repository.getActiveBranch(chat);expect(b[0]?.role).toBe('user');expect(b[0]?.authorKind).toBe('user_narrator');expect(b[1]?.role).toBe('assistant');expect(b[1]?.authorKind).toBe('narrator');});
  it('bypasses routing for explicit characters',async()=>{runtime.failRoute=true;const t=await normal('protagonist',{mode:'explicit',speaker:{kind:'character',characterId:character}});expect(t.plan?.outputs).toHaveLength(1);expect(t.plan?.warnings).toEqual([]);});
  it('falls back after routing failure without losing user input',async()=>{runtime.failRoute=true;const t=await normal();expect(t.status).toBe('completed');expect(server.repository.getActiveBranch(chat)).toHaveLength(2);expect(t.plan?.outputs[0]?.speaker.kind).toBe('character');});
  it('preserves user input after writer failure and does not settle',async()=>{runtime.failWrite=true;expect((await normal()).status).toBe('failed');expect(server.repository.getActiveBranch(chat)).toHaveLength(1);expect(settledStoryIds(server.repository,chat)).toEqual([]);});
  it('prevents concurrent generation in the same chat',async()=>{const req=turnRequestSchema.parse({conversationId:chat,input:{text:'one',voice:'protagonist'}});const t=server.turns.start(req);expect(()=>server.turns.start(req)).toThrow(/active/);server.turns.cancel(t.id);await server.turns.idle(chat);});
  it('v0.2 cancellation during records preserves completed prose and settlement', async () => {
    server.repository.setGeneralSettings({ ...server.repository.getGeneralSettings(), memoryTurnInterval: 1 });
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    runtime.maintain = async request => { entered(); await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true })); request.signal.throwIfAborted(); return ''; };
    const turn = server.turns.start(turnRequestSchema.parse({ conversationId: chat, input: { text: 'hello', voice: 'protagonist' } }));
    await ready; server.turns.cancel(turn.id); await server.turns.idle(chat);
    expect(server.repository.getTurn(turn.id)).toMatchObject({ status: 'completed', recordsStatus: 'cancelled' });
    expect(server.repository.getActiveBranch(chat).filter(m => m.role === 'assistant')).toHaveLength(2);
    expect(settledStoryIds(server.repository, chat)).toEqual([turn.storyTurnId]);
    expect(server.repository.listMemories(chat)).toEqual([]);
    server.repository.database.sqlite.prepare("DELETE FROM session_events WHERE turn_id = ? AND type = 'turn.completed'").run(turn.id);
    const replay = await server.app.inject({ method: 'GET', url: `/api/turns/${turn.id}/events` });
    expect(replay.body).toContain('"type":"turn.completed"');
  });
  it('discards a stale writer when the branch changes',async()=>{let entered!:()=>void;const ready=new Promise<void>((r)=>entered=r);let release!:()=>void;const gate=new Promise<void>((r)=>release=r);const original=runtime.write.bind(runtime);runtime.write=async(req,cb)=>{entered();await gate;return original(req,cb);};const t=server.turns.start(turnRequestSchema.parse({conversationId:chat,input:{text:'one',voice:'protagonist'},replyTarget:{mode:'explicit',speaker:{kind:'narrator'}}}));await ready;server.repository.setHead(chat,null);release();await server.turns.idle(chat);expect(server.repository.getTurn(t.id)?.status).toBe('failed');expect(server.repository.getConversation(chat)?.headMessageId).toBeNull();});
  it('auto turns do not re-anchor stale user input',async()=>{await normal();const t=server.turns.start(turnRequestSchema.parse({conversationId:chat,trigger:'auto'}));await server.turns.idle(chat);expect(server.repository.getTurn(t.id)?.status).toBe('completed');expect(runtime.requests.at(-1)?.latestUserText).toBe('');});
});
describe('branches and records',()=>{
  it('delete story tail restores earlier records and leaves independent chats intact', async () => {
    const repo = server.repository;
    const first = await normal(); const before = repo.getActiveBranch(chat);
    const state = blankState(); state.global_state[0]!.current_location = '旧地点'; repo.createState(chat, first.storyTurnId, state);
    const memory = repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: first.storyTurnId, content: '旧记忆', source: 'manual' });
    repo.savePinnedFact(chat, '仍然有效的事实', before[0]!.id);
    const second = await normal(); const full = repo.getActiveBranch(chat); const head = full.at(-1)!.id;
    state.global_state[0]!.current_location = '后来的地点'; repo.createState(chat, second.storyTurnId, state);
    repo.addEvent(chat, null, 'memory.edited', { id: memory.id, head, content: '后来的记忆修改' });
    repo.createMemory({ conversationId: chat, stage: 2, storyTurnId: second.storyTurnId, content: '后来的阶段', source: 'generated', coverage: { startMessageId: full[3]!.id, endMessageId: head, storyTurnIds: [second.storyTurnId] } });
    repo.saveBookmark(chat, '将删除的书签', head); repo.savePinnedFact(chat, '后来的事实', head);
    repo.createProposals(chat, { ...second.plan!, worldEventProposals: [{ summary: '城门关闭', evidence: '第二回合' }] });
    applyProposal(repo, repo.listProposals(chat)[0]!.id, 'apply');
    repo.setHistoryStart(chat, full[3]!.id);
    repo.database.sqlite.prepare('INSERT INTO action_choice_caches (conversation_id, head_key) VALUES (?, ?)').run(chat, head);
    const fork = (await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/branches`, payload: { messageId: head, head } })).json();
    const removed = await server.app.inject({ method: 'DELETE', url: `/api/conversations/${chat}/messages/${full[3]!.id}`, payload: { head } });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(repo.getActiveBranch(chat).map(row => row.id)).toEqual(before.map(row => row.id));
    expect(repo.listMessages(chat)).toHaveLength(before.length);
    expect(repo.latestState(chat)?.tables.global_state[0]!.current_location).toBe('旧地点');
    expect(repo.listMemories(chat).map(row => row.content)).toEqual(['旧记忆']);
    expect(repo.listPinnedFacts(chat).map(row => row.content)).toEqual(['仍然有效的事实']);
    expect(repo.listBookmarks(chat)).toEqual([]); expect(repo.currentWorld(chat)).toEqual([]);
    expect(repo.getConversation(chat)?.historyStartMessageId).toBeNull(); expect(repo.getTurn(second.id)).toBeNull();
    expect(repo.database.sqlite.prepare('SELECT 1 FROM action_choice_caches WHERE conversation_id = ? AND head_key = ?').get(chat, head)).toBeUndefined();
    expect(repo.getActiveBranch(fork.id)).toHaveLength(full.length);
    expect(repo.latestState(fork.id)?.tables.global_state[0]!.current_location).toBe('后来的地点');
    expect(repo.currentWorld(fork.id)[0]?.summary).toBe('城门关闭');
    expect((await server.app.inject({ url: `/api/conversations/${chat}/export?format=native` })).statusCode).toBe(200);
  });

  it('delete story tail permanently removes later nodes on paths that diverged before the cutoff', async () => {
    await normal(); const repo = server.repository; const full = repo.getActiveBranch(chat);
    const state = blankState(); state.global_state[0]!.current_location = '旧走向的未来';
    repo.createState(chat, full[0]!.storyTurnId, state);
    repo.createMemory({ conversationId: chat, storyTurnId: full[0]!.storyTurnId, stage: 1, source: 'generated', content: '旧走向的未来记忆' });
    const edited = await server.app.inject({ method: 'POST', url: `/api/messages/${full[0]!.id}/edit`, payload: { content: '修改后的 User 消息', head: full.at(-1)!.id } });
    const variant = edited.json();
    server.turns.start(turnRequestSchema.parse({ conversationId: chat, targetMessageId: variant.id }));
    await server.turns.idle(chat);
    const current = repo.getActiveBranch(chat);
    const removed = await server.app.inject({ method: 'DELETE', url: `/api/conversations/${chat}/messages/${current[1]!.id}`, payload: { head: current.at(-1)!.id } });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(repo.listMessages(chat).map(row => row.id).sort()).toEqual([full[0]!.id, variant.id].sort());
    expect(repo.getActiveBranch(chat).map(row => row.id)).toEqual([variant.id]);
    expect(repo.database.sqlite.prepare('SELECT count(*) AS count FROM state_snapshots WHERE conversation_id = ?').get(chat)).toEqual({ count: 0 });
    expect(repo.database.sqlite.prepare('SELECT count(*) AS count FROM memories WHERE conversation_id = ?').get(chat)).toEqual({ count: 0 });
    expect(settledStoryIds(repo, chat)).toEqual([]);
    const restore = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/head`, payload: { messageId: full.at(-1)!.id } });
    expect(restore.statusCode).toBe(400);
    const empty = await server.app.inject({ method: 'DELETE', url: `/api/conversations/${chat}/messages/${variant.id}`, payload: { head: variant.id } });
    expect(empty.statusCode, empty.body).toBe(200);
    expect(repo.getConversation(chat)?.headMessageId).toBeNull(); expect(repo.listMessages(chat)).toEqual([]);
  });

  it('delete story tail rejects stale heads and messages outside the active history', async () => {
    await normal(); const repo = server.repository; const full = repo.getActiveBranch(chat); const head = full.at(-1)!.id;
    const other = repo.createConversation(conversationInputSchema.parse({ title: 'Other', kind: 'solo', characterId: character }));
    const foreign = await server.app.inject({ method: 'DELETE', url: `/api/conversations/${other.id}/messages/${head}`, payload: { head: null } });
    const stale = await server.app.inject({ method: 'DELETE', url: `/api/conversations/${chat}/messages/${head}`, payload: { head: null } });
    expect(foreign.statusCode).toBe(400); expect(stale.statusCode).toBe(400);
    repo.setHead(chat, full[0]!.id);
    const inactive = await server.app.inject({ method: 'DELETE', url: `/api/conversations/${chat}/messages/${head}`, payload: { head: full[0]!.id } });
    expect(inactive.statusCode).toBe(400); expect(repo.listMessages(chat)).toHaveLength(full.length);
  });

  it('independent branches copy the selected checkpoint and keep later record changes isolated', async () => {
    const repo = server.repository;
    const first = await normal(); const prefix = repo.getActiveBranch(chat); const forkPoint = prefix.at(-1)!;
    const state = blankState(); state.global_state[0]!.current_location = '过去的房间';
    repo.createState(chat, first.storyTurnId, state);
    const memory = repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: first.storyTurnId, content: '过去的记忆', source: 'manual', coverage: { startMessageId: prefix[0]!.id, endMessageId: forkPoint.id, storyTurnIds: [first.storyTurnId] } });
    repo.savePinnedFact(chat, '过去的事实', prefix[0]!.id); repo.saveBookmark(chat, '分岔点', forkPoint.id);
    repo.setHistoryStart(chat, prefix[0]!.id);
    await normal(); const originalHead = repo.getConversation(chat)!.headMessageId;
    state.global_state[0]!.current_location = '后来的街道'; repo.createState(chat, null, state);
    repo.addEvent(chat, null, 'memory.edited', { id: memory.id, head: originalHead, content: '后来的修改' });
    const result = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/branches`, payload: { messageId: forkPoint.id, head: originalHead } });
    expect(result.statusCode, result.body).toBe(201);
    const copy = result.json(); const copied = repo.getActiveBranch(copy.id);
    expect(copied.map(message => message.content)).toEqual(prefix.map(message => message.content));
    expect(copied.every(message => !prefix.some(old => old.id === message.id))).toBe(true);
    expect(repo.getConversation(chat)?.headMessageId).toBe(originalHead);
    expect(copy.branchGroupId).toBe(repo.getConversation(chat)?.branchGroupId);
    expect(copy.historyStartMessageId).toBe(copied[0]!.id);
    expect(repo.listMemories(copy.id)[0]).toMatchObject({ content: '过去的记忆', coverage: { startMessageId: copied[0]!.id, endMessageId: copied.at(-1)!.id } });
    expect(repo.latestState(copy.id)?.tables.global_state[0]!.current_location).toBe('过去的房间');
    expect(repo.listPinnedFacts(copy.id)[0]?.sourceMessageId).toBe(copied[0]!.id);
    expect(repo.listBookmarks(copy.id)[0]?.messageId).toBe(copied.at(-1)!.id);
    const copiedMemory = repo.listMemories(copy.id)[0]!;
    repo.addEvent(copy.id, null, 'memory.edited', { id: copiedMemory.id, head: copy.headMessageId, content: '分支里的修改' });
    expect(repo.listMemories(chat)[0]?.content).toBe('后来的修改');
    expect((await server.app.inject({ url: `/api/conversations/${copy.id}/export?format=native` })).statusCode).toBe(200);
  });

  it('independent branches recover an old message path without moving the original chat', async () => {
    await normal(); const repo = server.repository; const old = repo.getActiveBranch(chat);
    const edited = await server.app.inject({ method: 'POST', url: `/api/messages/${old[1]!.id}/edit`, payload: { content: '另一版本', head: old.at(-1)!.id } });
    const currentHead = edited.json().id;
    repo.setHistoryStart(chat, currentHead);
    const result = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/branches`, payload: { messageId: old.at(-1)!.id, head: currentHead } });
    expect(result.statusCode, result.body).toBe(201);
    const copy = result.json();
    expect(repo.getActiveBranch(copy.id).map(row => row.content)).toEqual(old.map(row => row.content));
    expect(repo.getConversation(chat)?.headMessageId).toBe(currentHead);
    expect(copy.historyStartMessageId).toBe(repo.getActiveBranch(copy.id)[1]!.id);
    expect(settledStoryIds(repo, copy.id)).toHaveLength(1);
  });

  it('independent branches reject stale heads and messages from another chat', async () => {
    await normal(); const repo = server.repository; const head = repo.getConversation(chat)!.headMessageId;
    const other = repo.createConversation(conversationInputSchema.parse({ title: 'Other', kind: 'solo', characterId: character }));
    const stale = await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/branches`, payload: { messageId: head, head: null } });
    const foreign = await server.app.inject({ method: 'POST', url: `/api/conversations/${other.id}/branches`, payload: { messageId: head, head: null } });
    expect(stale.statusCode).toBe(400); expect(foreign.statusCode).toBe(400);
    expect(repo.listConversations()).toHaveLength(2);
    expect(repo.getConversation(chat)?.branchGroupId).toBeNull();
  });

  it('v0.2 directed rewrite preserves the old branch and keeps editing directions out of story records', async () => {
    await normal(); const repo = server.repository; const old = repo.getActiveBranch(chat);
    repo.setGeneralSettings({ ...repo.getGeneralSettings(), generationMode: 'planner', memoryTurnInterval: 1 });
    const plan = vi.spyOn(runtime, 'plan'); const route = vi.spyOn(runtime, 'route'); const maintain = vi.spyOn(runtime, 'maintain');
    const instruction = '保留剧情，改成非常简短的对白';
    const response = await server.app.inject({ method: 'POST', url: `/api/messages/${old[1]!.id}/swipe`, payload: { instruction } });
    expect(response.statusCode).toBe(202); await server.turns.idle(chat);
    const branch = repo.getActiveBranch(chat);
    expect(branch).toHaveLength(2); expect(branch[1]?.speaker).toEqual(old[1]?.speaker);
    expect(repo.getMessage(old[2]!.id)).toEqual(old[2]);
    expect(settledStoryIds(repo, chat)).toHaveLength(1);
    expect(plan).not.toHaveBeenCalled(); expect(route).not.toHaveBeenCalled(); expect(maintain).not.toHaveBeenCalled();
    const request = runtime.requests.at(-1)!;
    const context = buildWriterContext({ ...request, mode: 'plain', speaker: old[1]!.speaker!, outputIndex: 0, brief: '' });
    expect(String(context.messages.at(-1)?.content)).toContain(instruction);
    expect(String(context.messages.at(-1)?.content)).toContain('[Rewrite Source]');
    expect(JSON.stringify(branch)).not.toContain(instruction);
    await server.records.generate(chat, 'memory', new AbortController().signal);
    expect(maintain.mock.calls[0]![0].rewrite).toBeUndefined();
    expect(JSON.stringify(maintain.mock.calls[0]![0].history)).not.toContain(instruction);
  });
  it('regenerate replaces the whole logical turn and does not inflate counters',async()=>{await normal();const old=server.repository.getActiveBranch(chat);server.turns.start(turnRequestSchema.parse({conversationId:chat,trigger:'regenerate',targetMessageId:old[2]!.id}));await server.turns.idle(chat);const b=server.repository.getActiveBranch(chat);expect(b).toHaveLength(3);expect(b[0]?.id).toBe(old[0]?.id);expect(settledStoryIds(server.repository,chat)).toHaveLength(1);});
  it('v0.2 plain Continue explicitly continues the selected immutable reply without an old input anchor', async () => {
    await normal();
    const last = server.repository.getActiveBranch(chat).at(-1)!;
    server.repository.setGeneralSettings({ ...server.repository.getGeneralSettings(), generationMode: 'plain' });
    let context: any;
    const plain = new PiAgentRuntime({ stream: (_connection: unknown, next: unknown) => {
      context = next;
      return (async function* () { yield { type: 'done', message: { content: [{ type: 'text', text: '接着她打开了信。' }], usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20 } } }; })();
    } } as never);
    runtime.writeTurn = plain.writeTurn.bind(plain);
    const turn = server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'continue', targetMessageId: last.id })); await server.turns.idle(chat);
    expect(server.repository.getTurn(turn.id)?.status).toBe('completed');
    expect(context.messages.at(-1).content).toContain('[Continue Writing]');
    expect(context.messages.at(-1).content).not.toContain('以下是用户本轮输入');
    const next = server.repository.getActiveBranch(chat).at(-1)!;
    expect(next.speaker).toEqual(last.speaker);
    expect(next.content).toBe(last.content + '接着她打开了信。');
    expect(server.repository.getMessage(last.id)?.content).toBe(last.content);
    expect(settledStoryIds(server.repository, chat)).toHaveLength(1);
  });
  it('keeps the newest applicable state snapshot scoped to the chosen branch', async () => {
    const repo = server.repository;
    await normal();
    const branch = repo.getActiveBranch(chat);
    const state = blankState(); state.global_state[0]!.current_location = 'room';
    const later = repo.createState(chat, branch.at(-1)!.storyTurnId, state);
    repo.setHead(chat, branch[0]!.id);
    expect(repo.latestState(chat)).toBeNull();
    state.global_state[0]!.current_location = 'entrance';
    const earlier = repo.createState(chat, branch[0]!.storyTurnId, state);
    repo.setHead(chat, branch.at(-1)!.id);
    expect(repo.latestState(chat)).toEqual(earlier);
    const restored = repo.createState(chat, later.storyTurnId, later.tables);
    expect(repo.latestState(chat)).toEqual(restored);
    repo.setHead(chat, branch[0]!.id);
    expect((await server.app.inject({ url: `/api/conversations/${chat}/state` })).json()).toEqual(earlier);
  });
  it('autosaves record edits only on their originating branch and preserves memory edits in archives', async () => {
    const repo = server.repository;
    await normal();
    const firstHead = repo.getConversation(chat)!.headMessageId;
    const memory = repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: null, source: 'generated', content: '原来的记忆' });
    await normal();
    const head = repo.getConversation(chat)!.headMessageId;
    const edit = { content: '修订的记忆', previous: memory.content, head };
    expect((await server.app.inject({ method: 'PATCH', url: `/api/conversations/${chat}/memory/${memory.id}`, payload: edit })).statusCode).toBe(200);
    expect(repo.listMemories(chat, 1)[0]).toMatchObject({ ...memory, content: edit.content });
    const cell = { head, table: 'global_state', rowId: 1, column: 'current_location', previous: '', content: '书店' };
    expect((await server.app.inject({ method: 'PATCH', url: `/api/conversations/${chat}/state/cell`, payload: cell })).statusCode).toBe(200);
    const stale = await server.app.inject({ method: 'PATCH', url: `/api/conversations/${chat}/state/cell`, payload: { ...cell, content: '旧输入' } });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
    expect(repo.latestState(chat)?.tables.global_state[0]?.current_location).toBe('书店');
    const archive = (await server.app.inject({ url: `/api/conversations/${chat}/export?format=native` })).json();
    const imported = await server.app.inject({ method: 'POST', url: '/api/imports/story/execute', payload: archive });
    expect(imported.statusCode, imported.body).toBe(201);
    expect(repo.listMemories(imported.json().id)[0]?.content).toBe(edit.content);
    repo.setHead(chat, firstHead);
    expect(repo.listMemories(chat)[0]?.content).toBe(memory.content);
    expect(repo.latestState(chat)).toBeNull();
    expect((await server.app.inject({ method: 'PATCH', url: `/api/conversations/${chat}/memory/${memory.id}`, payload: edit })).statusCode).toBeGreaterThanOrEqual(400);
  });
  it('loads state checkpoint summaries and details only from the current branch', async () => {
    const repo = server.repository;
    await normal();
    const head = repo.getConversation(chat)!.headMessageId;
    const earlier = repo.createState(chat, null, blankState());
    await normal();
    const later = repo.createState(chat, null, blankState());
    repo.setHead(chat, head);
    const base = `/api/conversations/${chat}/state/history`;
    expect((await server.app.inject({ url: `${base}?view=summary` })).json()).toEqual([{ id: earlier.id, createdAt: earlier.createdAt }]);
    expect((await server.app.inject({ url: base })).json()).toEqual([earlier]);
    expect((await server.app.inject({ url: `${base}/${earlier.id}` })).json()).toEqual(earlier);
    expect((await server.app.inject({ url: `${base}/${later.id}` })).statusCode).toBe(404);
    const other = repo.createConversation(conversationInputSchema.parse({ title: 'Other checkpoint story', kind: 'solo', characterId: character }));
    expect((await server.app.inject({ url: `/api/conversations/${other.id}/state/history/${earlier.id}` })).statusCode).toBe(404);
    expect((await server.app.inject({ method: 'POST', url: `/api/conversations/${chat}/state/restore`, payload: { snapshotId: later.id } })).statusCode).toBeGreaterThanOrEqual(400);
  });
  it('v0.2 memory coverage and pinned facts follow the branch without resummarizing covered turns', async () => {
    const repo = server.repository;
    const first = await normal(); const firstBranch = repo.getActiveBranch(chat);
    const fact = repo.savePinnedFact(chat, '路易斯不知道灯塔的位置', firstBranch[0]!.id);
    const maintain = vi.spyOn(runtime, 'maintain').mockResolvedValue(JSON.stringify({ timeSpan: '今日', location: '灯塔', chronicle: '两人讨论灯塔。', dialogue: [], overview: '谈论灯塔' }));
    await server.records.generate(chat, 'memory', new AbortController().signal);
    expect(repo.listMemories(chat)[0]?.coverage).toEqual({ startMessageId: firstBranch[0]!.id, endMessageId: firstBranch.at(-1)!.id, storyTurnIds: [first.storyTurnId] });
    const second = await normal();
    repo.savePinnedFact(chat, '路易斯已经知道灯塔的位置', null, fact.id);
    await server.records.generate(chat, 'memory', new AbortController().signal);
    expect(maintain.mock.calls[1]![0].history.every(message => message.storyTurnId === second.storyTurnId)).toBe(true);
    expect(repo.listMemories(chat)[0]?.coverage?.storyTurnIds).toEqual([second.storyTurnId]);
    const stages = repo.listMemories(chat);
    expect(stages).toHaveLength(2);
    expect(repo.listMemories(chat, 1)).toEqual(stages.slice(0, 1));
    repo.removePinnedFact(chat, fact.id);
    repo.setHead(chat, firstBranch.at(-1)!.id);
    expect(repo.listPinnedFacts(chat)).toEqual([fact]);
    expect(repo.listMemories(chat)).toHaveLength(1);
    expect(repo.listMemories(chat, 1)[0]?.coverage?.storyTurnIds).toEqual([first.storyTurnId]);
    const context = new StoryContext(repo, chat);
    const match = await context.searchMemory('灯塔', 3);
    expect(match[0]?.sourceId).toBe(repo.listMemories(chat)[0]?.id);
    expect(match[0]?.messageIds).toContain(firstBranch[0]!.id);
    expect((await context.dynamic('灯塔')).filter(item => item.required).map(item => item.content)).toEqual([fact.content]);
    repo.setHead(chat, firstBranch[0]!.id);
    expect(repo.listPinnedFacts(chat)).toEqual([]);
    expect(repo.listMemories(chat)).toEqual([]);
  });
  it('rejects a head from a different conversation',async()=>{await normal();const other=server.repository.createConversation(conversationInputSchema.parse({title:'Other',kind:'solo',characterId:character}));expect(()=>server.repository.setHead(other.id,server.repository.getActiveBranch(chat)[0]!.id)).toThrow(/Invalid branch/);});
  it('counts a two-output group once',async()=>{const group=server.repository.createGroup({name:'Group',memberIds:[character],scenario:'group only'});const c=server.repository.getConversation(chat)!;server.repository.updateConversation(chat,{...c,kind:'group',characterId:null,groupId:group.id});await normal();expect(settledStoryIds(server.repository,chat)).toHaveLength(1);expect(runtime.requests[0]?.characters[0]?.scenario).toBe('');});
  it('records a manual memory update with its successful turn marker',async()=>{await normal();await server.records.generate(chat,'memory',new AbortController().signal);expect(server.repository.listMemories(chat)[0]?.content).toContain('chronicle');expect(server.repository.listMemories(chat)[0]?.storyTurnId).toBe(settledStoryIds(server.repository,chat)[0]);});
  it('does not checkpoint an empty state initialization',async()=>{await normal();await server.records.generate(chat,'state',new AbortController().signal);expect(server.repository.latestState(chat)).toBeNull();});
});
describe('HTTP boundary',()=>{
  it('content autosave rejects stale resource versions and obsolete message branches', async () => {
    const repo = server.repository;
    const original = repo.getCharacter(character)!;
    const saved = await server.app.inject({ method: 'PUT', url: `/api/characters/${character}`, payload: { ...original, description: '已保存的描述', expectedUpdatedAt: original.updatedAt } });
    expect(saved.statusCode).toBe(200);
    const stale = await server.app.inject({ method: 'PUT', url: `/api/characters/${character}`, payload: { ...original, description: '过期编辑', expectedUpdatedAt: 'old-version' } });
    expect(stale.statusCode).toBeGreaterThanOrEqual(400);
    expect(repo.getCharacter(character)?.description).toBe('已保存的描述');
    await normal();
    const target = repo.getActiveBranch(chat).at(-1)!;
    const body = { previous: target.content, content: '自动保存后的正文', head: target.id };
    const edited = await server.app.inject({ method: 'POST', url: `/api/messages/${target.id}/edit`, payload: body });
    expect(edited.statusCode).toBe(200);
    expect(repo.getMessage(target.id)?.content).toBe(target.content);
    expect((await server.app.inject({ method: 'POST', url: `/api/messages/${target.id}/edit`, payload: { ...body, content: '迟到的编辑' } })).statusCode).toBeGreaterThanOrEqual(400);
    expect(repo.getActiveBranch(chat).at(-1)?.content).toBe(body.content);
    expect(settledStoryIds(repo, chat)).toHaveLength(1);
  });
  it('does not return API keys or custom header values',async()=>{const response=await server.app.inject({method:'GET',url:'/api/connections'});expect(response.statusCode).toBe(200);expect(response.body).not.toContain('secret-do-not-return');expect(response.body).not.toContain('header-secret');});
  it.each(['https://evil.example','null','http://127.0.0.1.evil.example'])('rejects untrusted origin %s',async(origin)=>{const r=await server.app.inject({method:'POST',url:'/api/turns',headers:{origin},payload:{}});expect(r.statusCode).toBe(403);});
  it('rejects DNS rebinding hostnames',async()=>{expect((await server.app.inject({url:'/api/connections',headers:{host:'evil.example'}})).statusCode).toBe(403);});
  it('replays only SSE events after the cursor and closes completed streams', async () => {
    const turn = await normal();
    const url = `/api/turns/${turn.id}/events`;
    const parse = (body: string) => [...body.matchAll(/^data: (.+)$/gm)].map(match => JSON.parse(match[1]!));
    const response = await server.app.inject({ url });
    expect(response.statusCode).toBe(200);
    const events = parse(response.body);
    expect(events.at(-1).type).toBe('turn.completed');
    expect(events.map(event => event.id)).toEqual(events.map(event => event.id).sort((a, b) => a - b));
    const resumed = await server.app.inject({ url: `${url}?after=${events[2].id}` });
    expect(resumed.statusCode).toBe(200);
    expect(parse(resumed.body)).toEqual(events.slice(3));
    const completed = await server.app.inject({ url, headers: { 'last-event-id': String(events.at(-1).id) } });
    expect(completed.statusCode).toBe(200);
    expect(completed.body).toBe('');
  });
  it('does not expose provider reasoning as chat prose',async()=>{await normal();const r=await server.app.inject({url:`/api/conversations/${chat}/messages`});expect(r.json().branch.every((m:any)=>m.providerState===null)).toBe(true);});
  it('validates explicit narrator identity',async()=>{const r=await server.app.inject({method:'POST',url:'/api/turns',payload:{conversationId:chat,input:{text:'hi',voice:'narrator'},replyTarget:{mode:'explicit',speaker:{kind:'narrator'}}}});expect(r.statusCode).toBe(202);await server.turns.idle(chat);});
});

describe('record truth and logical-turn safeguards', () => {
  it('does not apply a proposal from an obsolete regenerated branch with the same storyTurnId', async () => {
    const turn = await normal(); const repo = server.repository;
    repo.createProposals(chat, { ...turn.plan!, worldEventProposals: [{ summary: 'obsolete event', evidence: 'old version' }] });
    const old = repo.listProposals(chat)[0]!;
    server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'regenerate', targetMessageId: repo.getActiveBranch(chat).at(-1)!.id })); await server.turns.idle(chat);
    expect(repo.getActiveBranch(chat).at(-1)?.storyTurnId).toBe(turn.storyTurnId);
    expect(() => applyProposal(repo, old.id, 'apply')).toThrow(/obsolete branch/); expect(repo.currentWorld(chat)).toEqual([]);
  });
  it('editing a completed assistant response preserves its logical-turn count', async () => {
    await normal(); const target = server.repository.getActiveBranch(chat).at(-1)!;
    const response = await server.app.inject({ method: 'POST', url: `/api/messages/${target.id}/edit`, payload: { content: 'Edited prose.' } });
    expect(response.statusCode).toBe(200); expect(settledStoryIds(server.repository, chat)).toHaveLength(1); expect(server.repository.getMessage(target.id)?.content).toBe(target.content);
  });
  it('general settings: record intervals are global but progress belongs to each story', async () => {
    const repo = server.repository;
    repo.setGeneralSettings({ ...repo.getGeneralSettings(), memoryTurnInterval: 2, stateTurnInterval: 2 });
    repo.database.sqlite.prepare('UPDATE conversations SET memory_turn_interval = 1, state_turn_interval = 1 WHERE id = ?').run(chat);
    const other = repo.createConversation(conversationInputSchema.parse({ title: 'Other', kind: 'solo', characterId: character }));
    const maintain = runtime.maintain.bind(runtime);
    runtime.maintain = async (request, instruction) => instruction.includes('state operations')
      ? JSON.stringify([{ op: 'updateRow', table: 'global_state', rowId: 1, cells: { current_location: request.conversationId } }])
      : maintain(request, instruction);
    const advance = async (id: string) => {
      const turn = server.turns.start(turnRequestSchema.parse({ conversationId: id, input: { text: '继续故事。', voice: 'protagonist' } }));
      await server.turns.idle(id);
      expect(repo.getTurn(turn.id)?.status).toBe('completed');
    };
    await advance(chat); await advance(other.id);
    expect(repo.listMemories(chat)).toHaveLength(0);
    expect(repo.latestState(chat)).toBeNull();
    await advance(chat);
    expect(repo.listMemories(chat)).toHaveLength(1);
    expect(repo.latestState(chat)?.tables.global_state[0]?.current_location).toBe(chat);
    expect(repo.listMemories(other.id)).toHaveLength(0);
    expect(repo.latestState(other.id)).toBeNull();
    await advance(other.id);
    expect(repo.listMemories(other.id)).toHaveLength(1);
    expect(repo.latestState(other.id)?.tables.global_state[0]?.current_location).toBe(other.id);
    expect(repo.listMemories(chat)).toHaveLength(1);
  });
  it('keeps failed automatic updates eligible for the next complete turn', async () => {
    server.repository.setGeneralSettings({ ...server.repository.getGeneralSettings(), memoryTurnInterval: 1 });
    const original = runtime.maintain.bind(runtime); let attempts = 0;
    runtime.maintain = async (...args) => { if (++attempts === 1) throw new Error('temporary record failure'); return original(...args); };
    await normal(); expect(server.repository.listMemories(chat)).toHaveLength(0);
    await normal(); expect(server.repository.listMemories(chat)).toHaveLength(1); expect(attempts).toBe(2);
  });
  it('does not recount a Swipe or Continue as a new story turn', async () => {
    await normal(); const first = server.repository.getActiveBranch(chat)[1]!;
    server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'regenerate', targetMessageId: first.id }), true); await server.turns.idle(chat);
    expect(settledStoryIds(server.repository, chat)).toHaveLength(1);
    const last = server.repository.getActiveBranch(chat).at(-1)!;
    server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'continue', targetMessageId: last.id })); await server.turns.idle(chat);
    expect(settledStoryIds(server.repository, chat)).toHaveLength(1);
  });
  it('treats cumulative imported memories and empty manual baselines correctly', () => {
    for (const [stage, source, content] of [[1,'imported','old'],[2,'imported','cumulative'],[3,'generated','new']] as const) server.repository.createMemory({ conversationId: chat, stage, source, content, storyTurnId: null });
    expect(new StoryContext(server.repository, chat).memory.map(m => m.content)).toEqual(['cumulative', 'new']);
    server.repository.createMemory({ conversationId: chat, stage: 4, source: 'manual', content: '', storyTurnId: null });
    expect(new StoryContext(server.repository, chat).memory).toEqual([]); expect(server.repository.listMemories(chat)).toHaveLength(4);
  });
  it('keeps pending world proposals out of truth, applies them, then supports safe undo', async () => {
    const turn = await normal(); const repo = server.repository;
    repo.createProposals(chat, { ...turn.plan!, worldEventProposals: [{ summary: 'The bridge is closed.', evidence: 'An official notice.' }] });
    const proposal = repo.listProposals(chat)[0]!;
    expect(repo.currentWorld(chat)).toEqual([]);
    applyProposal(repo, proposal.id, 'apply');
    expect((await new StoryContext(repo, chat).dynamic('')).some(m => m.content.includes('The bridge is closed.'))).toBe(true);
    applyProposal(repo, proposal.id, 'undo'); expect(repo.currentWorld(chat)).toEqual([]);
  });
  it('applies a state proposal as one atomic ordered batch', async () => {
    const turn = await normal(); const repo = server.repository;
    repo.createProposals(chat, { ...turn.plan!, protagonistStateProposals: [{ op: 'updateRow', table: 'global_state', rowId: 1, cells: { current_location: 'room' } }, { op: 'updateRow', table: 'missing', rowId: 1, cells: {} }] });
    expect(repo.listProposals(chat)).toHaveLength(1);
    expect(() => applyProposal(repo, repo.listProposals(chat)[0]!.id, 'apply')).toThrow(); expect(repo.latestState(chat)).toBeNull();
  });
  it('refuses to undo over a newer state snapshot', async () => {
    const turn = await normal(); const repo = server.repository;
    repo.createProposals(chat, { ...turn.plan!, protagonistStateProposals: [{ op: 'updateRow', table: 'global_state', rowId: 1, cells: { current_location: 'room' } }] });
    const proposal = repo.listProposals(chat)[0]!; applyProposal(repo, proposal.id, 'apply'); repo.createState(chat, turn.storyTurnId, blankState());
    expect(() => applyProposal(repo, proposal.id, 'undo')).toThrow(/changed/);
  });
  it('reads only current-branch world applications', async () => {
    const turn = await normal(); const repo = server.repository;
    repo.createProposals(chat, { ...turn.plan!, worldEventProposals: [{ summary: 'bridge closed', evidence: 'notice' }] });
    applyProposal(repo, repo.listProposals(chat)[0]!.id, 'apply'); repo.setHead(chat, repo.getActiveBranch(chat)[0]!.id);
    expect(new StoryContext(repo, chat).world).toEqual([]);
  });
  it('blocks preview and model requests when selected Memory exceeds the budget', async () => {
    await normal(); const repo = server.repository;
    repo.setGeneralSettings({ ...repo.getGeneralSettings(), generationMode: 'plain', streaming: false });
    repo.setGeneralSettings({ ...repo.getGeneralSettings(), historyMessageLimit: 1 });
    repo.savePinnedFact(chat, '灯塔属于路易斯'); repo.createState(chat, null, blankState());
    repo.createMemory({ conversationId: chat, stage: 1, storyTurnId: null, source: 'generated', content: 'oversized-memory '.repeat(20_000) });
    repo.createMemory({ conversationId: chat, stage: 2, storyTurnId: null, source: 'generated', content: '昨夜拜访灯塔' });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const input = turnRequestSchema.parse({ conversationId: chat, input: { voice: 'protagonist', text: '走向灯塔。' } });
    await expect(server.turns.preview(input, new AbortController().signal)).rejects.toThrow('Memory 上下文预算不足');
    const pi = new PiAgentRuntime(); runtime.writeTurn = pi.writeTurn.bind(pi);
    const turn = server.turns.start(input); await server.turns.idle(chat);
    expect(repo.getTurn(turn.id)?.status).toBe('failed');
    expect(repo.getTurn(turn.id)?.error).toContain('请增大上下文窗口、调低最大输出，或关闭 Memory 发送后重试');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('never exposes legacy cast metadata to native tools', async () => {
    server.repository.updateCharacter(character, characterInputSchema.parse({ name: 'Sina', legacyPayload: { script: 'not-runtime' } }));
    expect(JSON.stringify(await new StoryContext(server.repository, chat).readCast())).not.toContain('not-runtime');
  });
  it('redacts connection credentials from terminal errors and SSE', async () => {
    runtime.write = async () => { throw new Error('secret-do-not-return header-secret'); };
    const turn = await normal(); expect(turn.error).toContain('[redacted]');
    const sse = await server.app.inject({ url: `/api/turns/${turn.id}/events` }); expect(sse.body).not.toMatch(/secret-do-not-return|header-secret/);
  });
  it('creates character greetings without settling a logical story turn', async () => {
    server.repository.updateCharacter(character, characterInputSchema.parse({ name: 'Sina', firstMessage: '{{char}} waves to {{user}}.' }));
    const response = await server.app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'Greeting', kind: 'solo', characterId: character } });
    const id = response.json().id; expect(response.statusCode).toBe(201); expect(server.repository.getActiveBranch(id)[0]?.content).toBe('Sina waves to 主角.'); expect(settledStoryIds(server.repository, id)).toEqual([]);
  });
  it('v0.2 story archive restores branches, records, bookmarks and local images into a new story', async () => {
    const repo = server.repository; const turn = await normal(); const old = repo.getActiveBranch(chat);
    const image = Buffer.from([137, 80, 78, 71]); const name = 'a'.repeat(64) + '.png';
    writeFileSync(join(work, 'assets', name), image);
    repo.updateCharacter(character, characterInputSchema.parse({ ...repo.getCharacter(character), avatarPath: `/api/assets/${name}` }));
    const persona = repo.createPersona({ name: 'tree', description: '主角', avatarPath: `/api/assets/${name}`, stateTemplate: { current_outfit: '旅行斗篷', past_experience_before_story: '来自山谷' } });
    repo.setGeneralSettings({ ...repo.getGeneralSettings(), defaultPersonaId: persona.id });
    const book = repo.createLorebook(lorebookInputSchema.parse({ name: '灯塔世界', entries: [{ keys: ['灯塔'], content: '灯塔临海' }] }));
    const group = repo.createGroup({ name: '旅途', memberIds: [character], scenario: '海边' });
    repo.updateConversation(chat, { ...repo.getConversation(chat)!, kind: 'group', characterId: null, groupId: group.id, lorebookIds: [book.id], authorNote: '让海边场景保持安静。' });
    const state = blankState(); state.global_state[0]!.current_location = '灯塔'; state.global_state[0]!.current_time = '夜间';
    state.important_characters.push({ row_id: 1, name: 'Sina', is_dead: '否' }); repo.createState(chat, turn.storyTurnId, state);
    await server.records.generate(chat, 'memory', new AbortController().signal);
    repo.savePinnedFact(chat, '灯塔临海', old[0]!.id); repo.saveBookmark(chat, '发现信件', old.at(-1)!.id);
    repo.createProposals(chat, { ...turn.plan!, worldEventProposals: [{ summary: '桥已封闭', evidence: '公告' }] });
    applyProposal(repo, repo.listProposals(chat)[0]!.id, 'apply');
    server.turns.start(turnRequestSchema.parse({ conversationId: chat, trigger: 'regenerate', targetMessageId: old[1]!.id }), true); await server.turns.idle(chat);
    const archive = (await server.app.inject({ url: `/api/conversations/${chat}/export?format=native` })).json();
    expect(archive.format).toBe('ai-roleplay-story');
    expect(archive.personas[0].stateTemplate).toMatchObject({ current_outfit: '旅行斗篷', past_experience_before_story: '来自山谷' });
    expect(archive.conversation.authorNote).toBe('让海边场景保持安静。');
    expect(JSON.stringify(archive)).not.toMatch(/secret-do-not-return|header-secret|providerState|turn_traces/);
    const count = repo.listConversations().length;
    expect((await server.app.inject({ method: 'POST', url: '/api/imports/story/preview', payload: archive })).statusCode).toBe(200);
    expect(repo.listConversations()).toHaveLength(count);
    const restored = await server.app.inject({ method: 'POST', url: '/api/imports/story/execute', payload: archive });
    expect(restored.statusCode, restored.body).toBe(201);
    const copy = restored.json(); expect(copy.id).not.toBe(chat); expect(copy.personaId).not.toBe(persona.id);
    expect(repo.getPersona(copy.personaId)?.stateTemplate.current_outfit).toBe('旅行斗篷');
    expect(copy.authorNote).toBe('让海边场景保持安静。');
    expect(repo.getActiveBranch(copy.id)).toHaveLength(2); expect(repo.listMessages(copy.id)).toHaveLength(4);
    expect(repo.listMemories(copy.id)).toEqual([]);
    const bookmark = repo.listBookmarks(copy.id)[0]!;
    repo.setHead(copy.id, bookmark.messageId);
    expect(repo.getActiveBranch(copy.id)).toHaveLength(3);
    expect(repo.listMemories(copy.id)[0]?.coverage?.endMessageId).toBe(bookmark.messageId);
    expect(repo.listPinnedFacts(copy.id)[0]?.sourceMessageId).toBe(repo.getActiveBranch(copy.id)[0]?.id);
    expect(repo.navigation(copy.id).scene).toMatchObject({ location: '灯塔', time: '夜间', importantCharacters: ['Sina'] });
    expect(repo.currentWorld(copy.id)[0]?.summary).toBe('桥已封闭');
    applyProposal(repo, repo.listProposals(copy.id)[0]!.id, 'undo'); expect(repo.currentWorld(copy.id)).toEqual([]);
    const copiedCharacter = repo.getCharacter(repo.getGroup(copy.groupId)!.memberIds[0]!)!;
    expect((await server.app.inject({ url: copiedCharacter.avatarPath! })).rawPayload).toEqual(image);
    expect((await server.app.inject({ url: `/api/conversations/${copy.id}/export?format=markdown` })).body).toContain('## tree');
    expect(repo.listMessages(chat)).toHaveLength(4); expect(repo.listConnections()).toHaveLength(1);
    const before = repo.listCharacters().length;
    const failure = vi.spyOn(repo, 'createPersona').mockImplementationOnce(() => { throw new Error('restore interrupted'); });
    expect((await server.app.inject({ method: 'POST', url: '/api/imports/story/execute', payload: archive })).statusCode).toBe(400);
    expect(repo.listCharacters()).toHaveLength(before); expect(repo.listConversations()).toHaveLength(count + 1);
    failure.mockRestore();
  });
});
