import { AppError } from '@new-ai-chat/contracts';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { historyStartIndex } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
import { conversations, memories, messages, proposals, sessionEvents, stateSnapshots, turns } from '../db/schema.js';
import { portableStoryEventTypes } from './story-archive.js';

// Records follow their message checkpoint, including edits made after the original snapshot.
function recordsAt(repo: Repository, chatId: string, retained: Set<string>) {
  const db = repo.database.db;
  const allEvents = repo.events(chatId);
  const visible = (head: string | null | undefined) => !head || retained.has(head);
  const checkpoints = new Map(allEvents.filter(event => event.type === 'checkpoint').map(event => {
    const value = event.payload as { id: string; head: string | null };
    return [value.id, value.head];
  }));
  const memory = db.select().from(memories).where(eq(memories.conversationId, chatId)).orderBy(sql`rowid`).all()
    .filter(row => visible(checkpoints.get(row.id)) && (!row.coverage || (retained.has(row.coverage.startMessageId) && retained.has(row.coverage.endMessageId))));
  const states = db.select().from(stateSnapshots).where(eq(stateSnapshots.conversationId, chatId)).orderBy(sql`rowid`).all()
    .filter(row => visible(checkpoints.get(row.id)));
  const recordIds = new Set([...memory, ...states].map(row => row.id));
  const plans = repo.listProposals(chatId).filter(row => {
    const snapshot = row.committedSnapshot as { head: string | null; afterId: string | null } | null;
    return visible(row.originHead) && (!snapshot || (visible(snapshot.head) && (!snapshot.afterId || recordIds.has(snapshot.afterId))));
  });
  const proposalIds = new Set(plans.map(row => row.id));
  const storyTurnIds = new Set(repo.listMessages(chatId).filter(row => retained.has(row.id)).map(row => row.storyTurnId));
  const events = allEvents.filter(event => {
    if (!portableStoryEventTypes.has(event.type)) return false;
    const value = event.payload as Record<string, any>;
    if (!visible(value.head) || !visible(value.messageId) || !visible(value.sourceMessageId)) return false;
    if (['checkpoint', 'memory.edited'].includes(event.type) && !recordIds.has(value.id)) return false;
    if (value.proposalId && !proposalIds.has(value.proposalId)) return false;
    return !value.plan || storyTurnIds.has(value.plan.storyTurnId);
  });
  return { memory, states, plans, events };
}

function sourceMessage(repo: Repository, chatId: string, messageId: string, head: string | null) {
  const chat = repo.getConversation(chatId);
  if (!chat) throw new AppError("故事不存在。");
  if (chat.headMessageId !== head) throw new AppError("故事已变化，请刷新后重试。");
  const message = repo.getMessage(messageId);
  if (!message || message.conversationId !== chatId) throw new AppError("消息不属于当前故事。");
  return { chat, message };
}

export function forkStory(repo: Repository, chatId: string, messageId: string, head: string | null) {
  return repo.database.sqlite.transaction(() => {
    const { chat } = sourceMessage(repo, chatId, messageId, head);
    const path = repo.getActiveBranch(chatId, messageId);
    const retained = new Set(path.map(row => row.id));
    const records = recordsAt(repo, chatId, retained);
    const groupId = chat.branchGroupId ?? randomUUID();
    const siblingCount = repo.listConversations().filter(item => item.id === chatId || item.branchGroupId === groupId).length;
    const copy = repo.createConversation({ ...chat, title: `${chat.title.slice(0, 270)} · 分支 ${siblingCount + 1}` });
    const db = repo.database.db;
    db.update(conversations).set({ branchGroupId: groupId }).where(eq(conversations.id, chatId)).run();
    const ids = new Map<string, string>();
    const mapped = (value: string) => {
      if (!ids.has(value)) ids.set(value, randomUUID());
      return ids.get(value)!;
    };
    const nullable = (value: string | null) => value ? mapped(value) : null;
    for (const row of path) db.insert(messages).values({ ...row, id: mapped(row.id), conversationId: copy.id,
      parentId: nullable(row.parentId), storyTurnId: nullable(row.storyTurnId), providerState: null, legacyPayload: null }).run();
    for (const row of records.memory) db.insert(memories).values({ ...row, id: mapped(row.id), conversationId: copy.id,
      storyTurnId: nullable(row.storyTurnId), coverage: row.coverage ? { startMessageId: mapped(row.coverage.startMessageId), endMessageId: mapped(row.coverage.endMessageId), storyTurnIds: row.coverage.storyTurnIds.map(mapped) } : null }).run();
    for (const row of records.states) db.insert(stateSnapshots).values({ ...row, id: mapped(row.id), conversationId: copy.id, storyTurnId: nullable(row.storyTurnId) }).run();
    const eventIds = new Map<number, number>();
    for (const event of records.events) {
      const value = { ...event.payload as Record<string, any> };
      for (const key of ['id', 'head', 'messageId', 'sourceMessageId', 'storyTurnId', 'proposalId']) if (typeof value[key] === 'string') value[key] = mapped(value[key]);
      if (value.plan) value.plan = { ...value.plan, storyTurnId: mapped(value.plan.storyTurnId) };
      const inserted = db.insert(sessionEvents).values({ conversationId: copy.id, turnId: null, type: event.type, payload: value, createdAt: event.createdAt }).run();
      eventIds.set(event.id, Number(inserted.lastInsertRowid));
    }
    for (const row of records.plans) {
      const snapshot = row.committedSnapshot as { before: unknown; head: string | null; afterId: string | null; worldEventId: number | null } | null;
      db.insert(proposals).values({ ...row, id: mapped(row.id), conversationId: copy.id, storyTurnId: mapped(row.storyTurnId), originHead: nullable(row.originHead),
        committedSnapshot: snapshot ? { ...snapshot, head: nullable(snapshot.head), afterId: nullable(snapshot.afterId), worldEventId: snapshot.worldEventId === null ? null : eventIds.get(snapshot.worldEventId) ?? null } : null }).run();
    }
    const start = chat.historyStartMessageId ? repo.getMessage(chat.historyStartMessageId) : null;
    const startIndex = start ? historyStartIndex(path, start) : -1;
    db.update(conversations).set({ branchGroupId: groupId, headMessageId: mapped(messageId),
      historyStartMessageId: startIndex >= 0 ? mapped(path[startIndex]!.id) : null }).where(eq(conversations.id, copy.id)).run();
    return repo.getConversation(copy.id)!;
  })();
}

export function deleteStoryFrom(repo: Repository, chatId: string, messageId: string, head: string | null) {
  return repo.database.sqlite.transaction(() => {
    const { chat, message } = sourceMessage(repo, chatId, messageId, head);
    const position = repo.getActiveBranch(chatId).findIndex(row => row.id === messageId);
    if (position < 0) throw new AppError("只能删除当前历史中的消息。");
    const all = repo.listMessages(chatId);
    const children = new Map<string | null, string[]>();
    for (const row of all) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
    // The cutoff applies to every old path in this chat, including paths that diverged earlier.
    let level = children.get(null) ?? [];
    for (let index = 0; index < position; index++) level = level.flatMap(id => children.get(id) ?? []);
    const pending = [...level];
    const removed = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (removed.has(id)) continue;
      removed.add(id); pending.push(...(children.get(id) ?? []));
    }
    const retained = new Set(all.filter(row => !removed.has(row.id)).map(row => row.id));
    const records = recordsAt(repo, chatId, retained);
    const db = repo.database.db, sqlite = repo.database.sqlite;
    const affectedStoryTurns = new Set(all.filter(row => removed.has(row.id)).map(row => row.storyTurnId).filter(Boolean));
    const removedTurns = new Set(db.select().from(turns).where(eq(turns.conversationId, chatId)).all()
      .filter(row => affectedStoryTurns.has(row.storyTurnId) || [row.progress?.head, row.progress?.parent, row.progress?.oldHead, ...(row.progress?.completedMessageIds ?? [])].some(id => id && removed.has(id)))
      .map(row => row.id));
    const retainedEvents = new Set(records.events.map(row => row.id));
    const removeEvent = sqlite.prepare('DELETE FROM session_events WHERE conversation_id = ? AND id = ?');
    const detachEvent = sqlite.prepare('UPDATE session_events SET turn_id = NULL WHERE conversation_id = ? AND id = ?');
    for (const event of repo.events(chatId)) {
      const value = event.payload as Record<string, any> | null;
      const discard = portableStoryEventTypes.has(event.type) ? !retainedEvents.has(event.id)
        : (event.turnId && removedTurns.has(event.turnId)) || [value?.head, value?.messageId, value?.sourceMessageId].some(id => removed.has(id));
      if (discard) removeEvent.run(chatId, event.id);
      else if (event.turnId && removedTurns.has(event.turnId)) detachEvent.run(chatId, event.id);
    }
    for (const [table, rows] of [['memories', records.memory], ['state_snapshots', records.states], ['proposals', records.plans]] as const) {
      const keep = new Set(rows.map(row => row.id));
      const existing = sqlite.prepare(`SELECT id FROM ${table} WHERE conversation_id = ?`).all(chatId) as Array<{ id: string }>;
      const remove = sqlite.prepare(`DELETE FROM ${table} WHERE conversation_id = ? AND id = ?`);
      for (const row of existing) if (!keep.has(row.id)) remove.run(chatId, row.id);
    }
    const removeTurn = sqlite.prepare('DELETE FROM turns WHERE conversation_id = ? AND id = ?');
    const removeTraces = sqlite.prepare('DELETE FROM turn_traces WHERE conversation_id = ? AND turn_id = ?');
    for (const id of removedTurns) { removeTraces.run(chatId, id); removeTurn.run(chatId, id); }
    const removeMessage = sqlite.prepare('DELETE FROM messages WHERE conversation_id = ? AND id = ?');
    const removeChoices = sqlite.prepare('DELETE FROM action_choice_caches WHERE conversation_id = ? AND head_key = ?');
    for (const id of removed) { removeMessage.run(chatId, id); removeChoices.run(chatId, id); }
    repo.setHead(chatId, message.parentId);
    if (chat.historyStartMessageId && removed.has(chat.historyStartMessageId)) repo.setHistoryStart(chatId, null);
    return { conversation: repo.getConversation(chatId)!, deletedCount: removed.size };
  })();
}
