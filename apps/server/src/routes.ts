import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { characterInputSchema, connectionInputSchema, conversationInputSchema, groupInputSchema, lorebookInputSchema, personaInputSchema, normalizeState, applyStateOperations, blankState, turnRequestSchema, promptSettingsSchema, speakerRefSchema } from '@new-ai-chat/contracts';
import type { Repository } from './db/repository.js';
import type { TurnService } from './services/turns.js';
import { RecordService, applyProposal, settledStoryIds } from './services/records.js';
import { scanImport } from './services/import-scan.js';
import { executeImport } from './services/importer.js';
import { buildWriterContext, expandStoryMacros, fitRequest } from '@new-ai-chat/agent-runtime';
import { generalSettingsSchema } from '@new-ai-chat/contracts';
import type { AppConfig } from './config.js';
import { listModels, modelListInputSchema } from './services/models.js';

export function registerRoutes(app: FastifyInstance, repo: Repository, turns: TurnService, records: RecordService, config: AppConfig) {
  const idOf = (request: { params: unknown }) => z.object({ id: z.string().min(1) }).parse(request.params).id;
  function idleAll() { for (const chat of repo.listConversations()) turns.assertIdle(chat.id); }
  const collections: Array<{ path: string; schema: z.ZodType; list: () => unknown; get: (id: string) => unknown; create: (v: any) => unknown; update: (id: string, v: any) => unknown; remove: (id: string) => unknown }> = [
    { path: 'characters', schema: characterInputSchema, list: () => repo.listCharacters(), get: (id) => repo.getCharacter(id), create: (v) => repo.createCharacter(v), update: (id,v) => repo.updateCharacter(id,v), remove: (id) => repo.deleteCharacter(id) },
    { path: 'personas', schema: personaInputSchema, list: () => repo.listPersonas(), get: (id) => repo.getPersona(id), create: (v) => repo.createPersona(v), update: (id,v) => repo.updatePersona(id,v), remove: (id) => repo.deletePersona(id) },
    { path: 'connections', schema: connectionInputSchema, list: () => repo.listConnections(), get: (id) => repo.listConnections().find((c) => c.id === id), create: (v) => repo.createConnection(v), update: (id,v) => repo.updateConnection(id,v), remove: (id) => repo.deleteConnection(id) },
    { path: 'lorebooks', schema: lorebookInputSchema, list: () => repo.listLorebooks(), get: (id) => repo.getLorebook(id), create: (v) => repo.createLorebook(v), update: (id,v) => repo.updateLorebook(id,v), remove: (id) => repo.deleteLorebook(id) },
    { path: 'groups', schema: groupInputSchema, list: () => repo.listGroups(), get: (id) => repo.getGroup(id), create: (v) => repo.createGroup(v), update: (id,v) => repo.updateGroup(id,v), remove: (id) => repo.deleteGroup(id) },
    { path: 'conversations', schema: conversationInputSchema, list: () => repo.listConversations(), get: (id) => repo.getConversation(id), create: (v) => repo.database.sqlite.transaction(() => {
      const chat = repo.createConversation(v);
      const character = chat.kind === 'solo' && chat.characterId ? repo.getCharacter(chat.characterId) : null;
      if (character?.firstMessage.trim()) {
        const persona = chat.personaId ? repo.getPersona(chat.personaId) : null;
        const message = repo.createMessage({ conversationId: chat.id, parentId: null, storyTurnId: null, role: 'assistant', authorKind: 'character', speaker: { kind: 'character', characterId: character.id }, content: expandStoryMacros(character.firstMessage, persona?.name ?? '主角', character.name), providerState: null, legacyPayload: null });
        repo.setHead(chat.id, message.id);
      }
      return repo.getConversation(chat.id);
    })(), update: (id,v) => repo.updateConversation(id,v), remove: (id) => repo.deleteConversation(id) },
  ];
  function refs(path: string, input: any) {
    if (path === 'groups' && (new Set(input.memberIds).size !== input.memberIds.length || input.memberIds.some((id: string) => !repo.getCharacter(id)))) throw new Error('Invalid or duplicate group member.');
    if (path !== 'conversations') return;
    if (input.characterId && !repo.getCharacter(input.characterId)) throw new Error('Character not found.');
    if (input.groupId && !repo.getGroup(input.groupId)) throw new Error('Group not found.');
    if (input.personaId && !repo.getPersona(input.personaId)) throw new Error('Persona not found.');
    if (input.lorebookIds.some((id: string) => !repo.getLorebook(id))) throw new Error('Lorebook not found.');
  }
  for (const collection of collections) {
    const base = `/api/${collection.path}`;
    app.get(base, async () => collection.list());
    app.get(`${base}/:id`, async (req, reply) => collection.get(idOf(req)) ?? reply.code(404).send({ error: 'Not found.' }));
    app.post(base, async (req, reply) => { const value = collection.schema.parse(req.body); refs(collection.path, value); return reply.code(201).send(collection.create(value)); });
    app.put(`${base}/:id`, async (req, reply) => { idleAll(); const value = collection.schema.parse(req.body); refs(collection.path, value); return collection.update(idOf(req), value) ?? reply.code(404).send({ error: 'Not found.' }); });
    app.delete(`${base}/:id`, async (req) => { idleAll(); return { deleted: Boolean(collection.remove(idOf(req))) }; });
  }
  app.get('/api/settings/general', async () => repo.getGeneralSettings());
  app.put('/api/settings/general', async req => {
    idleAll();
    return repo.setGeneralSettings(generalSettingsSchema.parse(req.body));
  });
  app.get('/api/settings/prompts', async () => repo.getPromptSettings());
  app.put('/api/settings/prompts', async req => { idleAll(); return repo.setPromptSettings(promptSettingsSchema.parse(req.body)); });
  app.post('/api/connections/:id/test', async (req) => {
    const connection = repo.getRuntimeConnection(idOf(req)); if (!connection) throw new Error('Connection not found.');
    return { ...await turns.runtime.testConnection(connection, AbortSignal.timeout(60_000)), streaming: true, tools: true };
  });
  app.post('/api/connections/models', async (req) => {
    const input = modelListInputSchema.parse(req.body);
    const saved = input.connectionId ? repo.getRuntimeConnection(input.connectionId) : null;
    if (input.connectionId && !saved) throw new Error('Connection not found.');
    const sameEndpoint = saved && saved.baseUrl.replace(/\/+$/u, '') === input.baseUrl.replace(/\/+$/u, '') && saved.protocol === input.protocol;
    if (saved && !sameEndpoint && ((!input.apiKey && saved.apiKey) || Object.values(input.headers).includes('[stored]'))) {
      throw new Error('连接地址或协议已改变，请重新填写 API Key 和自定义请求头后获取模型。');
    }
    return { models: await listModels({ ...input, apiKey: input.apiKey || (sameEndpoint ? saved.apiKey : ''),
      headers: Object.fromEntries(Object.entries(input.headers).map(([key, value]) => [key, value === '[stored]' && sameEndpoint ? saved.headers[key] ?? '' : value])) }) };
  });
  app.get('/api/conversations/:id/messages', async (req) => ({ branch: repo.getActiveBranch(idOf(req)).map((m) => ({ ...m, providerState: null, legacyPayload: null })), nodes: repo.listMessages(idOf(req)).map((m) => ({ ...m, providerState: null, legacyPayload: null })) }));
  app.post('/api/conversations/:id/head', async (req) => { const id = idOf(req); turns.assertIdle(id); const value = z.object({ messageId: z.string().nullable() }).parse(req.body); repo.setHead(id,value.messageId); repo.addEvent(id,null,'branch.selected', value); return repo.getConversation(id); });
  app.post('/api/messages/:id/edit', async (req) => {
    const target = repo.getMessage(idOf(req)); if (!target) throw new Error('Message not found.'); turns.assertIdle(target.conversationId);
    const { content } = z.object({ content: z.string().max(100_000) }).parse(req.body);
    const wasSettled = target.storyTurnId && settledStoryIds(repo, target.conversationId).includes(target.storyTurnId);
    return repo.database.sqlite.transaction(() => {
      const message = repo.createMessage({ ...target, content, providerState: null, legacyPayload: null }); repo.setHead(target.conversationId, message.id);
      if (wasSettled && target.role === 'assistant') repo.addEvent(target.conversationId, null, 'story.settled', { storyTurnId: target.storyTurnId, head: message.id, variant: true });
      return message;
    })();
  });
  app.get('/api/messages/:id/swipes', async (req) => repo.listSwipes(idOf(req)).map((m) => ({ ...m, providerState: null, legacyPayload: null })));
  app.post('/api/messages/:id/swipe', async (req,reply) => {
    const target = repo.getMessage(idOf(req)); if (!target) throw new Error('Message not found.');
    return reply.code(202).send(turns.start(turnRequestSchema.parse({ conversationId: target.conversationId, trigger: 'regenerate', targetMessageId: target.id }), true));
  });
  app.post('/api/turns', async (req, reply) => reply.code(202).send(turns.start(turnRequestSchema.parse(req.body))));
  app.get('/api/turns/:id', async (req,reply) => repo.getTurn(idOf(req)) ?? reply.code(404).send({ error: 'Turn not found.' }));
  app.get('/api/turns/:id/trace', async (req, reply) => {
    const turn = repo.getTurn(idOf(req)); if (!turn) return reply.code(404).send({ error: 'Turn not found.' });
    return repo.listTraces(turn.id);
  });
  app.get('/api/conversations/:id/traces', async req => repo.listConversationTraces(idOf(req)));
  app.post('/api/conversations/:id/prompt-preview', async (req) => {
    const chatId = idOf(req);
    const body = z.object({ speaker: speakerRefSchema.optional(), brief: z.string().max(4_000).default('待选择回复身份'), inputText: z.string().max(100_000).optional(), inputVoice: z.enum(['protagonist', 'narrator']).optional() }).parse(req.body ?? {});
    const request = await turns.request(chatId, `preview-${Date.now()}`, AbortSignal.timeout(5_000));
    const draftRequest = { ...request, latestUserText: body.inputText ?? request.latestUserText, latestUserIsNarration: body.inputVoice ? body.inputVoice === 'narrator' : request.latestUserIsNarration };
    const chat = repo.getConversation(chatId)!;
    const generationMode = repo.getGeneralSettings().generationMode;
    const pendingSelection = !body.speaker && (generationMode !== 'plain' || chat.kind === 'group');
    const speaker = body.speaker ?? (request.characters[0] ? { kind: 'character', characterId: request.characters[0].id } : { kind: 'narrator' });
    const context = fitRequest({ ...draftRequest, speaker, brief: body.brief } as any, body.brief);
    const writer = buildWriterContext({ ...context, speaker, pendingSpeaker: pendingSelection, brief: body.brief, outputIndex: 0 } as any);
    const prompts = repo.getPromptSettings();
    return {
      segments: [
        { source: 'system', role: 'system', title: '稳定提示词', content: writer.systemPrompt },
        ...(generationMode === 'writer-agent' ? [{ source: 'agent', role: 'system', title: 'Writer Agent 行为指令', content: prompts.writerInstruction }] : generationMode === 'planner' ? [{ source: 'planner', role: 'system', title: 'Planner 指令', content: prompts.plannerInstruction }] : []),
        ...writer.messages.map((message, index) => ({ source: index === writer.messages.length - 1 ? 'latest-anchor' : 'history-or-dynamic', role: message.role, title: `消息 ${index + 1}`, content: typeof message.content === 'string' ? message.content : message.content.map((part: any) => part.text ?? '').join('') })),
      ],
      generationMode,
      speaker: pendingSelection ? null : speaker,
      pendingSelection,
      clipped: context.history.length < request.history.length || context.dynamicContext.length < request.dynamicContext.length,
    };
  });
  app.post('/api/turns/:id/cancel', async (req) => ({ cancelled: turns.cancel(idOf(req)) }));
  app.get('/api/conversations/:id/memory', async (req) => repo.listMemories(idOf(req),1000));
  app.post('/api/conversations/:id/memory', async (req) => {
    const chat = idOf(req); turns.assertIdle(chat); const { content, mode } = z.object({ content: z.string().max(200_000), mode: z.enum(['append', 'replace']).default('append') }).parse(req.body);
    return repo.createMemory({ conversationId: chat, content, source: mode === 'replace' ? 'manual' : 'generated', stage: (repo.listMemories(chat,1)[0]?.stage ?? 0)+1, storyTurnId: settledStoryIds(repo,chat).at(-1) ?? null });
  });
  app.get('/api/conversations/:id/state', async (req) => repo.latestState(idOf(req)) ?? { tables: blankState(), version: 1 });
  app.get('/api/conversations/:id/state/history', async req => repo.listStateSnapshots(idOf(req)));
  app.post('/api/conversations/:id/state/restore', async req => {
    const chat = idOf(req); turns.assertIdle(chat);
    const { snapshotId } = z.object({ snapshotId: z.string() }).parse(req.body);
    const snapshot = repo.listStateSnapshots(chat).find((item) => item.id === snapshotId);
    if (!snapshot) throw new Error('Snapshot is not on the current branch.');
    return repo.createState(chat, settledStoryIds(repo, chat).at(-1) ?? null, snapshot.tables);
  });
  app.get('/api/conversations/:id/planner-history', async req => repo.events(idOf(req)).filter((e) => ['planner.completed', 'routing.completed', 'planner.imported'].includes(e.type)).map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt, payload: e.payload })));
  app.post('/api/conversations/:id/state', async (req) => {
    const chat = idOf(req); turns.assertIdle(chat); const { tables } = z.object({ tables: z.unknown() }).parse(req.body);
    return repo.createState(chat, settledStoryIds(repo,chat).at(-1) ?? null, normalizeState(tables));
  });
  app.post('/api/conversations/:id/state/patch', async (req) => {
    const chat=idOf(req); turns.assertIdle(chat); const result = applyStateOperations(repo.latestState(chat)?.tables ?? blankState(), req.body);
    return result.changed ? repo.createState(chat,settledStoryIds(repo,chat).at(-1) ?? null,result.tables) : { unchanged: true };
  });
  for (const kind of ['memory','state'] as const) app.post(`/api/conversations/:id/${kind}/generate`, async (req) => { const chat=idOf(req); turns.assertIdle(chat); return records.generate(chat,kind,AbortSignal.timeout(120_000)); });
  app.get('/api/conversations/:id/proposals', async (req) => repo.listProposals(idOf(req)));
  app.post('/api/proposals/:id/:action', async (req) => { const value = z.object({ id:z.string(), action:z.enum(['apply','reject','undo']) }).parse(req.params); const proposal=repo.getProposal(value.id); if (!proposal) throw new Error('Proposal not found.'); turns.assertIdle(proposal.conversationId); return applyProposal(repo,value.id,value.action); });
  app.get('/api/imports', async () => repo.listImports());
  app.post('/api/imports/preview', async (req) => { const input=z.object({ sourcePath:z.string().default(config.defaultImportPath) }).parse(req.body); return (await scanImport(input.sourcePath)).preview; });
  app.post('/api/imports/execute', async (req) => { idleAll(); const input=z.object({ sourcePath:z.string(), sourceHash:z.string().length(64) }).parse(req.body); return executeImport(repo,input.sourcePath,input.sourceHash,config.assetDir); });
}
