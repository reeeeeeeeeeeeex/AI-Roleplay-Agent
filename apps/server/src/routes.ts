import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { characterInputSchema, connectionInputSchema, conversationInputSchema, groupInputSchema, lorebookInputSchema, personaInputSchema, normalizeState, applyStateOperations, blankState, stateColumns, turnRequestSchema, promptSettingsSchema } from '@new-ai-chat/contracts';
import type { Repository } from './db/repository.js';
import type { TurnService } from './services/turns.js';
import { RecordService, applyProposal, settledStoryIds } from './services/records.js';
import { scanImport } from './services/import-scan.js';
import { executeImport } from './services/importer.js';
import { expandStoryMacros } from '@new-ai-chat/agent-runtime';
import { generalSettingsSchema } from '@new-ai-chat/contracts';
import type { AppConfig } from './config.js';
import { listModels, modelListInputSchema } from './services/models.js';
import { exportStory, importStory, previewStoryArchive } from './services/story-archive.js';
import type { ActionChoiceService } from './services/action-choices.js';

export function registerRoutes(app: FastifyInstance, repo: Repository, turns: TurnService, records: RecordService, config: AppConfig, choices: ActionChoiceService) {
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
        const persona = repo.resolvePersona(chat.personaId);
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
    app.put(`${base}/:id`, async (req, reply) => {
      idleAll();
      const { expectedUpdatedAt: expected, expectedScenario } = z.object({ expectedUpdatedAt: z.string().optional(), expectedScenario: z.string().optional() }).parse(req.body);
      const existing = collection.get(idOf(req)) as { updatedAt?: string } | null;
      if (expected && existing?.updatedAt !== expected) throw new Error('内容已在别处修改，草稿已保留，请重新打开后核对。');
      if (collection.path === 'conversations' && expectedScenario !== undefined && repo.navigation(idOf(req)).scene.scenario !== expectedScenario) throw new Error('场景已在别处修改，未覆盖现有内容。');
      const value = collection.schema.parse(req.body); refs(collection.path, value);
      return collection.update(idOf(req), value) ?? reply.code(404).send({ error: 'Not found.' });
    });
    app.delete(`${base}/:id`, async (req) => { idleAll(); return { deleted: Boolean(collection.remove(idOf(req))) }; });
  }
  app.get('/api/settings/general', async () => repo.getGeneralSettings());
  const choicePosition = z.object({ head: z.string().min(1).nullable() });
  app.get('/api/conversations/:id/action-choices', async req => {
    const query = z.object({ head: z.string().optional() }).parse(req.query);
    return choices.get(idOf(req), query.head || null);
  });
  app.post('/api/conversations/:id/action-choices', async (req, reply) => {
    const { head } = choicePosition.parse(req.body);
    const controller = new AbortController();
    const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.on('close', abort);
    try { return await choices.generate(idOf(req), head, controller.signal); }
    finally { reply.raw.off('close', abort); }
  });
  app.patch('/api/conversations/:id/action-choices', async req => {
    const input = choicePosition.extend({ groupId: z.string(), index: z.number().int().min(0).max(3), previous: z.string(), text: z.string().trim().min(1).max(4000) }).parse(req.body);
    return choices.edit(idOf(req), input.head, input.groupId, input.index, input.previous, input.text);
  });
  app.put('/api/conversations/:id/action-choices/selection', async req => {
    const input = choicePosition.extend({ groupId: z.string() }).parse(req.body);
    return choices.select(idOf(req), input.head, input.groupId);
  });
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
  app.post('/api/conversations/:id/history-start', async req => {
    const chat = idOf(req); turns.assertIdle(chat);
    const { messageId } = z.object({ messageId: z.string().nullable() }).parse(req.body);
    return repo.setHistoryStart(chat, messageId);
  });
  app.post('/api/conversations/:id/head', async (req) => { const id = idOf(req); turns.assertIdle(id); const value = z.object({ messageId: z.string().nullable() }).parse(req.body); repo.setHead(id,value.messageId); repo.addEvent(id,null,'branch.selected', value); return repo.getConversation(id); });
  app.post('/api/messages/:id/edit', async (req) => {
    const target = repo.getMessage(idOf(req)); if (!target) throw new Error('Message not found.'); turns.assertIdle(target.conversationId);
    const { content, previous, head } = z.object({ content: z.string().max(100_000), previous: z.string().optional(), head: z.string().nullable().optional() }).parse(req.body);
    if (head !== undefined && repo.getConversation(target.conversationId)?.headMessageId !== head) throw new Error('分支已变化，未覆盖当前故事。请重新打开后核对草稿。');
    if (previous !== undefined && target.content !== previous) throw new Error('消息已变化，未覆盖现有内容。');
    if (target.content === content) return target;
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
    const { instruction } = z.object({ instruction: z.string().trim().min(1).max(4_000).optional() }).parse(req.body ?? {});
    return reply.code(202).send(turns.start(turnRequestSchema.parse({ conversationId: target.conversationId, trigger: 'regenerate', targetMessageId: target.id, rewriteInstruction: instruction }), true));
  });
  app.post('/api/turns', async (req, reply) => reply.code(202).send(turns.start(turnRequestSchema.parse(req.body))));
  app.get('/api/turns/:id', async (req,reply) => repo.getTurn(idOf(req)) ?? reply.code(404).send({ error: 'Turn not found.' }));
  app.get('/api/turns/:id/trace', async (req, reply) => {
    const turn = repo.getTurn(idOf(req)); if (!turn) return reply.code(404).send({ error: 'Turn not found.' });
    return repo.listTraces(turn.id);
  });
  app.get('/api/conversations/:id/traces', async req => (req.query as { view?: string }).view === 'summary' ? repo.listTraceSummaries(idOf(req)) : repo.listConversationTraces(idOf(req)));
  app.get('/api/traces/:id', async (req, reply) => repo.getTrace(idOf(req), (req.query as { view?: string }).view === 'live') ?? reply.code(404).send({ error: 'Trace not found.' }));
  app.post('/api/conversations/:id/prompt-preview', async (req) => {
    const chatId = idOf(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    return turns.preview(turnRequestSchema.parse({ ...body, conversationId: chatId }), AbortSignal.timeout(5_000));
  });
  app.post('/api/turns/:id/cancel', async (req) => ({ cancelled: turns.cancel(idOf(req)) }));
  app.post('/api/turns/:id/retry', async (req, reply) => reply.code(202).send(turns.retry(idOf(req))));
  app.get('/api/conversations/:id/last-turn', async req => {
    const row = repo.database.sqlite.prepare('SELECT id FROM turns WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 1').get(idOf(req)) as { id: string } | undefined;
    return row ? repo.getTurn(row.id) : null;
  });
  app.get('/api/conversations/:id/memory', async (req) => repo.listMemories(idOf(req),1000));
  app.patch('/api/conversations/:id/memory/:memoryId', async (req) => {
    const { id: chat, memoryId } = z.object({ id: z.string(), memoryId: z.string() }).parse(req.params);
    turns.assertIdle(chat);
    const value = z.object({ content: z.string().max(200_000), previous: z.string(), head: z.string().nullable() }).parse(req.body);
    const entry = repo.listMemories(chat, 1000).find(item => item.id === memoryId);
    if (!entry || repo.getConversation(chat)?.headMessageId !== value.head || entry.content !== value.previous) throw new Error('记忆或分支已变化，请刷新后重试。未覆盖现有内容。');
    if (entry.content !== value.content) repo.addEvent(chat, null, 'memory.edited', { id: memoryId, head: value.head, content: value.content });
    return { ...entry, content: value.content };
  });
  app.get('/api/conversations/:id/facts', async req => repo.listPinnedFacts(idOf(req)));
  app.get('/api/conversations/:id/navigation', async req => repo.navigation(idOf(req)));
  app.post('/api/conversations/:id/bookmarks', async req => {
    const chat = idOf(req); turns.assertIdle(chat);
    const value = z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(100), messageId: z.string(), previous: z.string().optional() }).parse(req.body);
    if (value.id && value.previous !== undefined && repo.listBookmarks(chat).find(item => item.id === value.id)?.name !== value.previous) throw new Error('书签已在别处修改，未覆盖现有内容。');
    return repo.saveBookmark(chat, value.name, value.messageId, value.id);
  });
  app.delete('/api/conversations/:id/bookmarks/:bookmarkId', async req => {
    const { id, bookmarkId } = z.object({ id: z.string(), bookmarkId: z.string() }).parse(req.params); turns.assertIdle(id);
    repo.removeBookmark(id, bookmarkId); return { removed: true };
  });
  app.post('/api/conversations/:id/facts', async req => {
    const chat = idOf(req); turns.assertIdle(chat);
    const value = z.object({ id: z.string().optional(), content: z.string().trim().min(1).max(10_000), sourceMessageId: z.string().nullable().default(null), head: z.string().nullable().optional(), previous: z.string().optional() }).parse(req.body);
    if (value.head !== undefined && repo.getConversation(chat)?.headMessageId !== value.head) throw new Error('分支已变化，未覆盖固定事实。');
    if (value.id && value.previous !== undefined && repo.listPinnedFacts(chat).find(item => item.id === value.id)?.content !== value.previous) throw new Error('固定事实已在别处修改，未覆盖现有内容。');
    return repo.savePinnedFact(chat, value.content, value.sourceMessageId, value.id);
  });
  app.delete('/api/conversations/:id/facts/:factId', async req => {
    const { id, factId } = z.object({ id: z.string(), factId: z.string() }).parse(req.params); turns.assertIdle(id);
    repo.removePinnedFact(id, factId); return { removed: true };
  });
  app.post('/api/conversations/:id/memory', async (req) => {
    const chat = idOf(req); turns.assertIdle(chat); const { content, mode, head } = z.object({ content: z.string().max(200_000), mode: z.enum(['append', 'replace']).default('append'), head: z.string().nullable().optional() }).parse(req.body);
    if (head !== undefined && repo.getConversation(chat)?.headMessageId !== head) throw new Error('分支已变化，未写入其他分支。');
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
  app.patch('/api/conversations/:id/state/cell', async (req) => {
    const chat = idOf(req); turns.assertIdle(chat);
    const value = z.object({ head: z.string().nullable(), table: z.string(), rowId: z.number().int(), column: z.string(), content: z.string(), previous: z.string() }).parse(req.body);
    const tables = repo.latestState(chat)?.tables ?? blankState();
    const row = tables[value.table as keyof typeof tables]?.find(item => item.row_id === value.rowId);
    if (repo.getConversation(chat)?.headMessageId !== value.head || !row || String(row[value.column] ?? '') !== value.previous) throw new Error('状态或分支已变化，请刷新后重试。未覆盖现有内容。');
    const result = applyStateOperations(tables, [{ op: 'updateRow', table: value.table, rowId: value.rowId, cells: { [value.column]: value.content } }]);
    return result.changed ? repo.createState(chat, settledStoryIds(repo, chat).at(-1) ?? null, result.tables) : { tables };
  });
  app.route({ method: ['PATCH', 'DELETE'], url: '/api/conversations/:id/state/row', handler: async req => {
    const chat = idOf(req); turns.assertIdle(chat);
    const value = z.object({
      head: z.string().nullable(), table: z.enum(['important_characters', 'protagonist_skills', 'inventory', 'quests_events']),
      rowId: z.number().int().positive(), previous: z.record(z.string(), z.unknown()), cells: z.record(z.string(), z.unknown()).optional(),
    }).parse(req.body);
    const tables = repo.latestState(chat)?.tables ?? blankState();
    const row = tables[value.table].find(item => item.row_id === value.rowId);
    if (repo.getConversation(chat)?.headMessageId !== value.head || !row || row.row_id !== value.previous.row_id || stateColumns[value.table].some(column => (row[column] ?? '') !== (value.previous[column] ?? ''))) throw new Error('这条记录或分支已变化，未覆盖现有内容。请重新打开后核对。');
    const operation = req.method === 'DELETE'
      ? { op: 'deleteRow', table: value.table, rowId: value.rowId }
      : { op: 'updateRow', table: value.table, rowId: value.rowId, cells: value.cells };
    const result = applyStateOperations(tables, [operation], { allowImportantCharacterDeletion: true });
    return result.changed ? repo.createState(chat, settledStoryIds(repo, chat).at(-1) ?? null, result.tables) : { tables };
  } });
  for (const kind of ['memory','state'] as const) app.post(`/api/conversations/:id/${kind}/generate`, async (req) => { const chat=idOf(req); turns.assertIdle(chat); return records.generate(chat,kind,AbortSignal.timeout(120_000)); });
  app.get('/api/conversations/:id/proposals', async (req) => repo.listProposals(idOf(req)));
  app.post('/api/proposals/:id/:action', async (req) => { const value = z.object({ id:z.string(), action:z.enum(['apply','reject','undo']) }).parse(req.params); const proposal=repo.getProposal(value.id); if (!proposal) throw new Error('Proposal not found.'); turns.assertIdle(proposal.conversationId); return applyProposal(repo,value.id,value.action); });
  app.get('/api/imports', async () => repo.listImports());
  app.get('/api/conversations/:id/export', async (req, reply) => {
    const id = idOf(req); turns.assertIdle(id);
    const { format } = z.object({ format: z.enum(['markdown', 'native']).default('native') }).parse(req.query);
    const result = exportStory(repo, id, config.assetDir, format);
    return format === 'markdown' ? reply.type('text/markdown; charset=utf-8').send(result) : result;
  });
  app.post('/api/imports/story/preview', { bodyLimit: 50 * 1024 * 1024 }, async req => previewStoryArchive(req.body));
  app.post('/api/imports/story/execute', { bodyLimit: 50 * 1024 * 1024 }, async (req, reply) => {
    idleAll(); return reply.code(201).send(importStory(repo, req.body, config.assetDir));
  });
  app.post('/api/imports/preview', async (req) => { const input=z.object({ sourcePath:z.string().default(config.defaultImportPath) }).parse(req.body); return (await scanImport(input.sourcePath)).preview; });
  app.post('/api/imports/execute', async (req) => { idleAll(); const input=z.object({ sourcePath:z.string(), sourceHash:z.string().length(64) }).parse(req.body); return executeImport(repo,input.sourcePath,input.sourceHash,config.assetDir); });
  app.post('/api/assets/upload', async (req, reply) => {
    const { dataUrl } = z.object({
      filename: z.string().min(1).max(255).optional(),
      dataUrl: z.string().min(1).max(25_000_000),
    }).parse(req.body);
    const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/u.exec(dataUrl);
    if (!match) return reply.code(400).send({ error: '仅支持 PNG、JPEG 或 WebP 格式的图片。' });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1]!;
    const buffer = Buffer.from(match[2]!, 'base64');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const targetName = `${hash}.${ext}`;
    await mkdir(config.assetDir, { recursive: true });
    await writeFile(join(config.assetDir, targetName), buffer);
    return { url: `/api/assets/${targetName}` };
  });
}
