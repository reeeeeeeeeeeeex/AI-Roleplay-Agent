import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { FakeRuntime, type WriterRequest } from '@new-ai-chat/agent-runtime';
import { characterInputSchema, connectionInputSchema, conversationInputSchema, turnRequestSchema, blankState } from '@new-ai-chat/contracts';
import { settledStoryIds, applyProposal } from './records.js';
import { StoryContext } from './context.js';

class InspectRuntime extends FakeRuntime {
  requests: WriterRequest[]=[];
  failRoute=false; failWrite=false;
  override async route(request:Parameters<FakeRuntime['route']>[0]) { if(this.failRoute)throw new Error('Route failed');return super.route(request); }
  override async write(request:WriterRequest,onDelta:(s:string)=>void) {this.requests.push(request);if(this.failWrite)throw new Error('Write failed');return super.write(request,onDelta);}
}
let work:string; let server:Awaited<ReturnType<typeof createApp>>;let runtime:InspectRuntime;let chat:string;let character:string;let connection:string;
beforeEach(async()=>{
  work=mkdtempSync(join(tmpdir(),'new-ai-chat-test-'));runtime=new InspectRuntime();
  server=await createApp({host:'127.0.0.1',port:0,databasePath:join(work,'test.db'),assetDir:join(work,'assets'),webDist:join(work,'web'),pairingToken:null,defaultImportPath:work,fakeModel:false},runtime);
  character=server.repository.createCharacter(characterInputSchema.parse({name:'Sina'})).id;
  connection=server.repository.createConnection(connectionInputSchema.parse({name:'Test',protocol:'openai-responses',baseUrl:'https://example.invalid',model:'test',apiKey:'secret-do-not-return',headers:{Authorization:'header-secret'}})).id;
  chat=server.repository.createConversation(conversationInputSchema.parse({title:'Test story',kind:'solo',characterId:character,connectionId:connection})).id;
});
afterEach(async()=>{vi.unstubAllGlobals();await server.app.close();rmSync(work,{recursive:true,force:true});});
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
it('default connection: inherits globally for existing chats and preserves explicit overrides', async () => {
  const current = server.repository.getConversation(chat)!;
  server.repository.updateConversation(chat, { ...current, connectionId: null });
  const request = { conversationId: chat, input: { voice: 'protagonist', text: '保留这条消息。' } };
  expect((await server.app.inject({ method: 'POST', url: '/api/turns', payload: request })).statusCode).toBe(400);
  expect(server.repository.getActiveBranch(chat)).toHaveLength(0);
  const selected = await server.app.inject({ method: 'PUT', url: '/api/settings/default-connection', payload: { connectionId: connection } });
  expect(selected.statusCode).toBe(200);
  expect((await server.app.inject({ url: '/api/settings/default-connection' })).json()).toEqual({ connectionId: connection });
  expect((await normal()).status).toBe('completed');
  expect(runtime.requests[0]?.connection.id).toBe(connection);
  expect(server.repository.getConversation(chat)?.connectionId).toBeNull();
  const other = server.repository.createConnection(connectionInputSchema.parse({ name: 'Other', protocol: 'openai-responses', baseUrl: 'https://example.invalid', model: 'other', historyMessageLimit: 1 }));
  server.repository.setDefaultConnectionId(other.id);
  expect(new StoryContext(server.repository, chat).history).toHaveLength(1);
  expect((await server.turns.request(chat, 'manual', new AbortController().signal)).connection.id).toBe(other.id);
  server.repository.updateConversation(chat, current);
  expect(server.repository.resolveConnection(current.connectionId)?.id).toBe(connection);
  server.repository.deleteConnection(other.id);
  expect(server.repository.getDefaultConnectionId()).toBeNull();
  expect((await server.app.inject({ method: 'PUT', url: '/api/settings/default-connection', payload: { connectionId: null } })).statusCode).toBe(200);
});
describe('native turns and narrator',()=>{
  it('routes to narrator and character, and gives the second writer the first response',async()=>{
    const turn=await normal();expect(turn.status).toBe('completed');const branch=server.repository.getActiveBranch(chat);
    expect(branch.map((m)=>m.authorKind)).toEqual(['protagonist','narrator','character']);expect(new Set(branch.map((m)=>m.storyTurnId)).size).toBe(1);
    expect(runtime.requests[1]?.history.at(-1)?.authorKind).toBe('narrator');expect(settledStoryIds(server.repository,chat)).toHaveLength(1);
  });
  it('preserves user narration as user and AI narration as assistant',async()=>{await normal('narrator',{mode:'explicit',speaker:{kind:'narrator'}});const b=server.repository.getActiveBranch(chat);expect(b[0]?.role).toBe('user');expect(b[0]?.authorKind).toBe('user_narrator');expect(b[1]?.role).toBe('assistant');expect(b[1]?.authorKind).toBe('narrator');});
  it('bypasses routing for explicit characters',async()=>{runtime.failRoute=true;const t=await normal('protagonist',{mode:'explicit',speaker:{kind:'character',characterId:character}});expect(t.plan?.outputs).toHaveLength(1);expect(t.plan?.warnings).toEqual([]);});
  it('falls back after routing failure without losing user input',async()=>{runtime.failRoute=true;const t=await normal();expect(t.status).toBe('completed');expect(server.repository.getActiveBranch(chat)).toHaveLength(2);expect(t.plan?.outputs[0]?.speaker.kind).toBe('character');});
  it('preserves user input after writer failure and does not settle',async()=>{runtime.failWrite=true;expect((await normal()).status).toBe('failed');expect(server.repository.getActiveBranch(chat)).toHaveLength(1);expect(settledStoryIds(server.repository,chat)).toEqual([]);});
  it('prevents concurrent generation in the same chat',async()=>{const req=turnRequestSchema.parse({conversationId:chat,input:{text:'one',voice:'protagonist'}});const t=server.turns.start(req);expect(()=>server.turns.start(req)).toThrow(/active/);server.turns.cancel(t.id);await server.turns.idle(chat);});
  it('cancels before any generation commits',async()=>{const t=server.turns.start(turnRequestSchema.parse({conversationId:chat,input:{text:'hello',voice:'protagonist'}}));server.turns.cancel(t.id);await server.turns.idle(chat);expect(server.repository.getTurn(t.id)?.status).toBe('cancelled');expect(server.repository.getActiveBranch(chat)).toHaveLength(1);});
  it('discards a stale writer when the branch changes',async()=>{let entered!:()=>void;const ready=new Promise<void>((r)=>entered=r);let release!:()=>void;const gate=new Promise<void>((r)=>release=r);const original=runtime.write.bind(runtime);runtime.write=async(req,cb)=>{entered();await gate;return original(req,cb);};const t=server.turns.start(turnRequestSchema.parse({conversationId:chat,input:{text:'one',voice:'protagonist'},replyTarget:{mode:'explicit',speaker:{kind:'narrator'}}}));await ready;server.repository.setHead(chat,null);release();await server.turns.idle(chat);expect(server.repository.getTurn(t.id)?.status).toBe('failed');expect(server.repository.getConversation(chat)?.headMessageId).toBeNull();});
  it('auto turns do not re-anchor stale user input',async()=>{await normal();const t=server.turns.start(turnRequestSchema.parse({conversationId:chat,trigger:'auto'}));await server.turns.idle(chat);expect(server.repository.getTurn(t.id)?.status).toBe('completed');expect(runtime.requests.at(-1)?.latestUserText).toBe('');});
});
describe('branches and records',()=>{
  it('swiping the first output leaves the second output on the old branch',async()=>{await normal();const old=server.repository.getActiveBranch(chat);const first=old[1]!;const t=server.turns.start(turnRequestSchema.parse({conversationId:chat,trigger:'regenerate',targetMessageId:first.id}),true);await server.turns.idle(chat);expect(server.repository.getTurn(t.id)?.status).toBe('completed');const b=server.repository.getActiveBranch(chat);expect(b).toHaveLength(2);expect(b.some((m)=>m.id===old[2]!.id)).toBe(false);expect(server.repository.getMessage(old[2]!.id)).not.toBeNull();});
  it('regenerate replaces the whole logical turn and does not inflate counters',async()=>{await normal();const old=server.repository.getActiveBranch(chat);server.turns.start(turnRequestSchema.parse({conversationId:chat,trigger:'regenerate',targetMessageId:old[2]!.id}));await server.turns.idle(chat);const b=server.repository.getActiveBranch(chat);expect(b).toHaveLength(3);expect(b[0]?.id).toBe(old[0]?.id);expect(settledStoryIds(server.repository,chat)).toHaveLength(1);});
  it('continue retains speaker, creates an immutable alternative, and skips settlement',async()=>{await normal();const last=server.repository.getActiveBranch(chat).at(-1)!;server.turns.start(turnRequestSchema.parse({conversationId:chat,trigger:'continue',targetMessageId:last.id}));await server.turns.idle(chat);const next=server.repository.getActiveBranch(chat).at(-1)!;expect(next.id).not.toBe(last.id);expect(next.speaker).toEqual(last.speaker);expect(next.content.startsWith(last.content)).toBe(true);expect(server.repository.getMessage(last.id)?.content).toBe(last.content);});
  it('keeps state snapshots scoped to the chosen branch',async()=>{await normal();const b=server.repository.getActiveBranch(chat);const state=blankState();state.global_state[0]!.current_location='room';server.repository.createState(chat,b.at(-1)!.storyTurnId,state);expect(server.repository.latestState(chat)?.tables.global_state[0]?.current_location).toBe('room');server.repository.setHead(chat,b[0]!.id);expect(server.repository.latestState(chat)).toBeNull();});
  it('keeps memory scoped to the chosen branch',async()=>{await normal();const b=server.repository.getActiveBranch(chat);server.repository.createMemory({conversationId:chat,stage:1,storyTurnId:b.at(-1)!.storyTurnId,content:'one',source:'generated'});server.repository.setHead(chat,b[0]!.id);expect(server.repository.listMemories(chat)).toEqual([]);});
  it('rejects a head from a different conversation',async()=>{await normal();const other=server.repository.createConversation(conversationInputSchema.parse({title:'Other',kind:'solo',characterId:character}));expect(()=>server.repository.setHead(other.id,server.repository.getActiveBranch(chat)[0]!.id)).toThrow(/Invalid branch/);});
  it('counts a two-output group once',async()=>{const group=server.repository.createGroup({name:'Group',memberIds:[character],scenario:'group only'});const c=server.repository.getConversation(chat)!;server.repository.updateConversation(chat,{...c,kind:'group',characterId:null,groupId:group.id,plannerEnabled:true});await normal();expect(settledStoryIds(server.repository,chat)).toHaveLength(1);expect(runtime.requests[0]?.characters[0]?.scenario).toBe('');});
  it('records a manual memory update with its successful turn marker',async()=>{await normal();await server.records.generate(chat,'memory',new AbortController().signal);expect(server.repository.listMemories(chat)[0]?.content).toContain('chronicle');expect(server.repository.listMemories(chat)[0]?.storyTurnId).toBe(settledStoryIds(server.repository,chat)[0]);});
  it('does not checkpoint an empty state initialization',async()=>{await normal();await server.records.generate(chat,'state',new AbortController().signal);expect(server.repository.latestState(chat)).toBeNull();});
});
describe('HTTP boundary',()=>{
  it('does not return API keys or custom header values',async()=>{const response=await server.app.inject({method:'GET',url:'/api/connections'});expect(response.statusCode).toBe(200);expect(response.body).not.toContain('secret-do-not-return');expect(response.body).not.toContain('header-secret');});
  it.each(['https://evil.example','null','http://127.0.0.1.evil.example'])('rejects untrusted origin %s',async(origin)=>{const r=await server.app.inject({method:'POST',url:'/api/turns',headers:{origin},payload:{}});expect(r.statusCode).toBe(403);});
  it('rejects DNS rebinding hostnames',async()=>{expect((await server.app.inject({url:'/api/connections',headers:{host:'evil.example'}})).statusCode).toBe(403);});
  it('replays durable SSE events in increasing order',async()=>{const turn=await normal();const r=await server.app.inject({url:`/api/turns/${turn.id}/events`});expect(r.statusCode).toBe(200);const events=r.body.split('\n\n').filter((line)=>line.includes('data:')).map((line)=>JSON.parse(line.split('data: ')[1]!));expect(events.at(-1).type).toBe('turn.completed');expect(events.map((e:any)=>e.id)).toEqual([...events.map((e:any)=>e.id)].sort((a,b)=>a-b));const after=events[2].id;const resumed=await server.app.inject({url:`/api/turns/${turn.id}/events?after=${after}`});expect(resumed.body).not.toContain(`id: ${after}\n`);});
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
  it('counts ten double-output turns once each and appends a single automatic memory', async () => {
    for (let i = 0; i < 10; i++) await normal();
    expect(settledStoryIds(server.repository, chat)).toHaveLength(10);
    expect(server.repository.listMemories(chat)).toHaveLength(1);
    await normal(); expect(server.repository.listMemories(chat)).toHaveLength(1);
  });
  it('keeps failed automatic updates eligible for the next complete turn', async () => {
    server.repository.updateConversation(chat, { ...server.repository.getConversation(chat)!, memoryTurnInterval: 1 });
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
  it('keeps latest user anchor even when a small ceiling removes it for writer two', async () => {
    const input = server.repository.listConnections()[0]!;
    server.repository.updateConnection(connection, connectionInputSchema.parse({ ...input, historyMessageLimit: 1 }));
    await normal(); expect(runtime.requests[1]?.history).toHaveLength(1); expect(runtime.requests[1]?.latestUserText).toBe('推开门。');
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
  it('uses global narrator defaults only for new conversations', async () => {
    server.repository.setNarratorDefaults({ name: '记录者', avatarPath: null, style: 'restrained' });
    const response = await server.app.inject({ method: 'POST', url: '/api/conversations', payload: { title: 'New', kind: 'solo', characterId: character } });
    expect(response.json().narrator.name).toBe('记录者'); expect(server.repository.getConversation(chat)?.narrator.name).toBe('旁白');
    expect((await server.app.inject({ method: 'DELETE', url: '/api/narrator' })).statusCode).toBe(404);
  });
  it('serves only content-addressed image assets', async () => {
    const name = 'a'.repeat(64) + '.png'; writeFileSync(join(work, 'assets', name), Buffer.from([137, 80, 78, 71]));
    expect((await server.app.inject({ url: `/api/assets/${name}` })).statusCode).toBe(200);
    writeFileSync(join(work, 'assets', 'secret.txt'), 'secret'); expect((await server.app.inject({ url: '/api/assets/secret.txt' })).statusCode).toBe(404);
  });
});
