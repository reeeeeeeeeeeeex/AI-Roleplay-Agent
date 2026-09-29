import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { characterInputSchema, personaInputSchema, lorebookInputSchema, groupInputSchema, conversationInputSchema, speakerRefSchema, turnPlanSchema, generationModeSchema, normalizeState } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
import { conversations, messages, memories, stateSnapshots, proposals, sessionEvents } from '../db/schema.js';

const ref = z.string().min(1).max(200);
const maybeRef = ref.nullable();
const text = z.string();
const coverage = z.object({ startMessageId: ref, endMessageId: ref, storyTurnIds: z.array(ref) }).nullable();
const usage = z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheWrite: z.number(), totalTokens: z.number(), reasoning: z.number().optional() })
  .transform(({ reasoning, ...rest }) => reasoning === undefined ? rest : { ...rest, reasoning }).nullable();
const timing = z.object({ preparedAt: text, sentAt: text.nullable(), headersAt: text.nullable(), firstThinkingAt: text.nullable(), firstTextAt: text.nullable(), completedAt: text.nullable() }).nullable();
const generationInfo = z.object({ mode: generationModeSchema, model: text, streaming: z.boolean(), thinking: text.nullable(), usage, timing, requestCount: z.number().int().nonnegative() }).nullable().default(null);
const assetUrl = /^\/api\/assets\/([a-f0-9]{64}\.(?:png|jpe?g|webp))$/u;
const payloads: Record<string, z.ZodType> = {
  'checkpoint': z.object({ id: ref, head: maybeRef }),
  'memory.edited': z.object({ id: ref, head: maybeRef, content: text }),
  'story.settled': z.object({ storyTurnId: ref, head: ref, variant: z.boolean().optional() }),
  'fact.saved': z.object({ id: ref, content: text, sourceMessageId: maybeRef, head: maybeRef }),
  'fact.removed': z.object({ id: ref, head: maybeRef }),
  'bookmark.saved': z.object({ id: ref, name: z.string().min(1).max(100), messageId: ref }),
  'bookmark.removed': z.object({ id: ref }),
  'world.applied': z.object({ proposalId: ref, head: maybeRef, summary: text, evidence: text }),
  'world.undone': z.object({ proposalId: ref, head: maybeRef }),
  'planner.completed': z.object({ plan: turnPlanSchema }),
  'routing.completed': z.object({ plan: turnPlanSchema }),
  'planner.imported': z.object({ messageId: ref, record: z.unknown(), history: z.array(z.unknown()).default([]) }),
};

const archiveSchema = z.object({
  format: z.literal('ai-roleplay-story'), version: z.literal(1),
  conversation: conversationInputSchema.safeExtend({ id: ref, headMessageId: maybeRef, historyStartMessageId: maybeRef.default(null) }),
  characters: z.array(characterInputSchema.omit({ legacyPayload: true }).extend({ id: ref })),
  personas: z.array(personaInputSchema.omit({ legacyPayload: true }).extend({ id: ref })),
  lorebooks: z.array(lorebookInputSchema.omit({ legacyPayload: true }).extend({ id: ref })),
  group: groupInputSchema.extend({ id: ref }).nullable(),
  messages: z.array(z.object({ id: ref, parentId: maybeRef, storyTurnId: maybeRef, role: z.enum(['user', 'assistant', 'system']), authorKind: z.enum(['protagonist', 'user_narrator', 'character', 'narrator', 'system']), speaker: speakerRefSchema.nullable(), content: text, generationInfo, createdAt: text })).max(50_000),
  memories: z.array(z.object({ id: ref, stage: z.number().int(), storyTurnId: maybeRef, content: text, source: z.enum(['generated', 'imported', 'manual']), coverage: coverage.default(null), createdAt: text })),
  states: z.array(z.object({ id: ref, storyTurnId: maybeRef, tables: z.unknown().transform(normalizeState), createdAt: text })),
  proposals: z.array(z.object({ id: ref, storyTurnId: ref, originHead: maybeRef, kind: z.enum(['world', 'state']), payload: z.unknown(), status: z.enum(['pending', 'applied', 'rejected', 'undone']), committedSnapshot: z.object({ before: z.unknown().transform(normalizeState), afterId: maybeRef, worldEventId: z.number().int().nullable(), head: maybeRef }).nullable(), createdAt: text, updatedAt: text })),
  events: z.array(z.object({ id: z.number().int(), type: text.refine(value => Object.hasOwn(payloads, value), 'Unsupported story event.'), payload: z.unknown(), createdAt: text })),
  assets: z.record(z.string().regex(assetUrl), z.string().max(25_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/u)),
  warnings: z.array(text).default([]),
});
type StoryArchive = z.infer<typeof archiveSchema>;

export function readStoryArchive(value: unknown): StoryArchive {
  const archive = archiveSchema.parse(value);
  const unique = (rows: Array<{ id: string | number }>) => { const ids = new Set(rows.map(row => row.id)); if (ids.size !== rows.length) throw new Error('故事包存在重复 ID。'); return ids; };
  const nodeIds = unique(archive.messages), characterIds = unique(archive.characters), personaIds = unique(archive.personas), loreIds = unique(archive.lorebooks);
  const recordIds = new Set([...unique(archive.memories), ...unique(archive.states)]), proposalIds = unique(archive.proposals);
  const eventIds = unique(archive.events);
  const requireRef = (ids: Set<string | number>, id: string | number | null | undefined) => { if (id != null && !ids.has(id)) throw new Error(`故事包缺少引用：${id}`); };
  const requireSpeaker = (speaker: { kind: string; characterId?: string } | null) => { if (speaker?.kind === 'character') requireRef(characterIds, speaker.characterId); };
  requireRef(nodeIds, archive.conversation.headMessageId);
  requireRef(nodeIds, archive.conversation.historyStartMessageId);
  requireRef(characterIds, archive.conversation.characterId); requireRef(personaIds, archive.conversation.personaId);
  for (const id of archive.conversation.lorebookIds) requireRef(loreIds, id);
  if (archive.conversation.groupId !== (archive.group?.id ?? null)) throw new Error('故事包群组引用不一致。');
  for (const id of archive.group?.memberIds ?? []) requireRef(characterIds, id);
  const nodes = new Map(archive.messages.map(message => [message.id, message]));
  const checked = new Set<string>();
  for (const message of archive.messages) {
    requireRef(nodeIds, message.parentId); requireSpeaker(message.speaker);
    const path = new Set<string>(); let current: string | null = message.id;
    while (current && !checked.has(current)) {
      if (path.has(current)) throw new Error('故事包消息分支存在循环。');
      path.add(current); current = nodes.get(current)?.parentId ?? null;
    }
    for (const id of path) checked.add(id);
  }
  for (const memory of archive.memories) if (memory.coverage) { requireRef(nodeIds, memory.coverage.startMessageId); requireRef(nodeIds, memory.coverage.endMessageId); }
  for (const proposal of archive.proposals) {
    requireRef(nodeIds, proposal.originHead);
    if (proposal.committedSnapshot) { requireRef(nodeIds, proposal.committedSnapshot.head); requireRef(recordIds, proposal.committedSnapshot.afterId); requireRef(eventIds, proposal.committedSnapshot.worldEventId); }
  }
  for (const event of archive.events) {
    const p = payloads[event.type]!.parse(event.payload) as Record<string, any>;
    event.payload = p;
    requireRef(nodeIds, p.head); requireRef(nodeIds, p.messageId); requireRef(nodeIds, p.sourceMessageId);
    if (event.type === 'checkpoint') requireRef(recordIds, p.id);
    if (event.type === 'memory.edited') requireRef(new Set(archive.memories.map(item => item.id)), p.id);
    if (p.proposalId) requireRef(proposalIds, p.proposalId);
    for (const output of p.plan?.outputs ?? []) requireSpeaker(output.speaker);
  }
  const avatarPaths = [...archive.characters, ...archive.personas, ...(archive.group?.avatarPath ? [{ avatarPath: archive.group.avatarPath }] : [])].map(item => item.avatarPath).filter((path): path is string => Boolean(path));
  for (const path of avatarPaths) if (path.startsWith('/api/assets/') && !archive.assets[path]) archive.warnings.push(`本地图片未打包，导入后留空：${path}`);
  return archive;
}

export function previewStoryArchive(value: unknown) {
  const archive = readStoryArchive(value);
  return { title: archive.conversation.title, counts: { messages: archive.messages.length, memories: archive.memories.length, states: archive.states.length, characters: archive.characters.length, images: Object.keys(archive.assets).length }, warnings: [...new Set(archive.warnings)], note: '导入为新故事，不覆盖现有内容；绑定导出时的主角，不修改全局设置。' };
}

export function exportStory(repo: Repository, conversationId: string, assetDir: string, format: 'markdown' | 'native') {
  const chat = repo.getConversation(conversationId); if (!chat) throw new Error('Conversation not found.');
  const persona = repo.resolvePersona(chat.personaId);
  if (format === 'markdown') {
    return `# ${chat.title}\n\n` + repo.getActiveBranch(chat.id).map(message => {
      const name = message.role === 'user' ? `${persona?.name ?? 'Protagonist'}${message.authorKind === 'user_narrator' ? '（用户旁白）' : ''}` : message.speaker?.kind === 'narrator' ? repo.getGeneralSettings().narrator.name : message.speaker?.kind === 'character' ? repo.getCharacter(message.speaker.characterId)?.name ?? '角色' : '系统';
      return `## ${name}\n\n${message.content}\n`;
    }).join('\n');
  }
  const nodes = repo.listMessages(chat.id);
  const events = repo.events(chat.id).filter(event => Object.hasOwn(payloads, event.type));
  const group = chat.groupId ? repo.getGroup(chat.groupId) : null;
  const characterIds = new Set([...(group?.memberIds ?? []), ...(chat.characterId ? [chat.characterId] : [])]);
  for (const node of nodes) if (node.speaker?.kind === 'character') characterIds.add(node.speaker.characterId);
  for (const event of events) for (const output of (event.payload as any)?.plan?.outputs ?? []) if (output.speaker?.kind === 'character') characterIds.add(output.speaker.characterId);
  const characters = repo.getCharactersByIds([...characterIds]);
  const assets: Record<string, string> = {}; const warnings: string[] = [];
  for (const item of [...characters, ...(persona ? [persona] : []), ...(group?.avatarPath ? [{ avatarPath: group.avatarPath }] : [])]) {
    const match = item.avatarPath?.match(assetUrl); if (!match || assets[item.avatarPath!]) continue;
    const path = join(assetDir, match[1]!);
    if (existsSync(path)) assets[item.avatarPath!] = readFileSync(path).toString('base64');
    else warnings.push(`缺失本地图片：${item.avatarPath}`);
  }
  const db = repo.database.db;
  const archive = readStoryArchive({ format: 'ai-roleplay-story', version: 1, conversation: { ...chat, personaId: persona?.id ?? null }, characters, personas: persona ? [persona] : [], group,
    lorebooks: chat.lorebookIds.map(id => repo.getLorebook(id)).filter(Boolean), messages: nodes,
    memories: db.select().from(memories).where(eq(memories.conversationId, chat.id)).all(),
    states: db.select().from(stateSnapshots).where(eq(stateSnapshots.conversationId, chat.id)).all(),
    proposals: repo.listProposals(chat.id), events, assets, warnings });
  // Stored legacy fields and opaque provider state are not portable story data.
  for (const book of archive.lorebooks) for (const entry of book.entries) entry.legacyPayload = null;
  return archive;
}

export function importStory(repo: Repository, value: unknown, assetDir: string) {
  const archive = readStoryArchive(value);
  const ids = new Map<string, string>();
  const mapped = (id: string) => { if (!ids.has(id)) ids.set(id, randomUUID()); return ids.get(id)!; };
  const nullable = (id: string | null) => id ? mapped(id) : null;
  const speaker = (value: z.infer<typeof speakerRefSchema> | null) => value?.kind === 'character' ? { ...value, characterId: mapped(value.characterId) } : value;
  const createdAssets: string[] = [];
  const assetPaths = new Map<string, string>();
  const avatar = (path: string | null) => path?.startsWith('/api/assets/') ? assetPaths.get(path) ?? null : path;
  try {
    return repo.database.sqlite.transaction(() => {
      for (const [oldPath, base64] of Object.entries(archive.assets)) {
        const bytes = Buffer.from(base64, 'base64');
        // Same content-addressed naming as image upload, not an integrity scan.
        const name = `${createHash('sha256').update(bytes).digest('hex')}.${oldPath.split('.').at(-1)}`;
        const path = join(assetDir, name);
        try { writeFileSync(path, bytes, { flag: 'wx' }); createdAssets.push(path); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        assetPaths.set(oldPath, `/api/assets/${name}`);
      }
      for (const { id, ...item } of archive.characters) ids.set(id, repo.createCharacter({ ...item, avatarPath: avatar(item.avatarPath), legacyPayload: null }).id);
      for (const { id, ...item } of archive.personas) ids.set(id, repo.createPersona({ ...item, avatarPath: avatar(item.avatarPath), legacyPayload: null }).id);
      for (const item of archive.lorebooks) ids.set(item.id, repo.createLorebook({ ...item, legacyPayload: null, entries: item.entries.map(entry => ({ ...entry, legacyPayload: null })) }).id);
      if (archive.group) { const { id, ...group } = archive.group; ids.set(id, repo.createGroup({ ...group, avatarPath: avatar(group.avatarPath), memberIds: group.memberIds.map(mapped) }).id); }
      const chat = repo.createConversation({ ...archive.conversation, title: archive.conversation.title, characterId: nullable(archive.conversation.characterId), groupId: nullable(archive.conversation.groupId), personaId: nullable(archive.conversation.personaId), lorebookIds: archive.conversation.lorebookIds.map(mapped) });
      ids.set(archive.conversation.id, chat.id);
      const db = repo.database.db;
      for (const item of archive.messages) db.insert(messages).values({ ...item, id: mapped(item.id), conversationId: chat.id, parentId: nullable(item.parentId), storyTurnId: nullable(item.storyTurnId), speaker: speaker(item.speaker), providerState: null, legacyPayload: null }).run();
      for (const item of archive.memories) db.insert(memories).values({ ...item, id: mapped(item.id), conversationId: chat.id, storyTurnId: nullable(item.storyTurnId), coverage: item.coverage ? { startMessageId: mapped(item.coverage.startMessageId), endMessageId: mapped(item.coverage.endMessageId), storyTurnIds: item.coverage.storyTurnIds.map(mapped) } : null }).run();
      for (const item of archive.states) db.insert(stateSnapshots).values({ ...item, id: mapped(item.id), conversationId: chat.id, storyTurnId: nullable(item.storyTurnId), version: 1 }).run();
      const eventIds = new Map<number, number>();
      for (const event of archive.events) {
        const p = { ...event.payload as Record<string, any> };
        for (const key of ['id', 'head', 'messageId', 'sourceMessageId', 'storyTurnId', 'proposalId']) if (typeof p[key] === 'string') p[key] = mapped(p[key]);
        if (p.plan) p.plan = { ...p.plan, storyTurnId: mapped(p.plan.storyTurnId), outputs: p.plan.outputs.map((output: any) => ({ ...output, speaker: speaker(output.speaker) })) };
        const row = db.insert(sessionEvents).values({ conversationId: chat.id, turnId: null, type: event.type, payload: p, createdAt: event.createdAt }).run();
        eventIds.set(event.id, Number(row.lastInsertRowid));
      }
      for (const item of archive.proposals) db.insert(proposals).values({ ...item, id: mapped(item.id), conversationId: chat.id, storyTurnId: mapped(item.storyTurnId), originHead: nullable(item.originHead), committedSnapshot: item.committedSnapshot ? { ...item.committedSnapshot, head: nullable(item.committedSnapshot.head), afterId: nullable(item.committedSnapshot.afterId), worldEventId: item.committedSnapshot.worldEventId === null ? null : eventIds.get(item.committedSnapshot.worldEventId) ?? null } : null }).run();
      repo.setHead(chat.id, nullable(archive.conversation.headMessageId));
      db.update(conversations).set({ historyStartMessageId: nullable(archive.conversation.historyStartMessageId) }).where(eq(conversations.id, chat.id)).run();
      return repo.getConversation(chat.id)!;
    })();
  } catch (error) {
    for (const path of createdAssets) unlinkSync(path);
    throw error;
  }
}
