import { randomUUID } from 'node:crypto';
import { actionChoiceListSchema, type ActionChoiceCache, type ActionChoiceGroup } from '@new-ai-chat/contracts';
import type { AgentRuntime, BaseAgentRequest } from '@new-ai-chat/agent-runtime';
import type { Repository } from '../db/repository.js';
import type { EventBroker } from './events.js';
import type { TurnService } from './turns.js';
import { StoryContext } from './context.js';
import { createTraceSink } from './trace.js';

export class ActionChoiceService {
  private active = new Map<string, { controller: AbortController; done: Promise<ActionChoiceCache> }>();
  constructor(private repo: Repository, private runtime: AgentRuntime, private events: EventBroker, private turns: TurnService) {}

  private position(chat: string, head: string | null) {
    const conversation = this.repo.getConversation(chat);
    if (!conversation || (head && this.repo.getMessage(head)?.conversationId !== chat)) throw new Error('行动选项的故事位置不存在。');
    return conversation;
  }
  get(chat: string, head: string | null): ActionChoiceCache {
    this.position(chat, head);
    const row = this.repo.database.sqlite.prepare('SELECT groups, selected_group_id FROM action_choice_caches WHERE conversation_id = ? AND head_key = ?').get(chat, head ?? '') as { groups: string; selected_group_id: string | null } | undefined;
    return row ? { groups: JSON.parse(row.groups) as ActionChoiceGroup[], selectedGroupId: row.selected_group_id } : { groups: [], selectedGroupId: null };
  }
  private save(chat: string, head: string | null, cache: ActionChoiceCache) {
    this.repo.database.sqlite.prepare(`INSERT INTO action_choice_caches (conversation_id, head_key, groups, selected_group_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_id, head_key) DO UPDATE SET groups = excluded.groups, selected_group_id = excluded.selected_group_id`).run(chat, head ?? '', JSON.stringify(cache.groups), cache.selectedGroupId);
    return cache;
  }
  select(chat: string, head: string | null, groupId: string) {
    const cache = this.get(chat, head);
    if (!cache.groups.some(group => group.id === groupId)) throw new Error('候选组不存在。');
    return this.save(chat, head, { ...cache, selectedGroupId: groupId });
  }
  edit(chat: string, head: string | null, groupId: string, index: number, previous: string, text: string) {
    const cache = this.get(chat, head);
    const group = cache.groups.find(group => group.id === groupId);
    if (!group || group.choices[index] === undefined) throw new Error('行动选项不存在。');
    if (group.choices[index] !== previous && group.choices[index] !== text.trim()) throw new Error('选项已在别处修改，草稿已保留，请重新打开后核对。');
    group.choices = actionChoiceListSchema.parse(group.choices.map((value, at) => at === index ? text : value));
    return this.save(chat, head, cache);
  }
  async generate(chat: string, head: string | null, signal: AbortSignal): Promise<ActionChoiceCache> {
    this.turns.assertIdle(chat);
    const conversation = this.position(chat, head);
    if (conversation.headMessageId !== head) throw new Error('故事位置已改变，请重新展开行动选项。');
    if (this.active.has(chat)) throw Object.assign(new Error('行动选项正在生成。'), { statusCode: 409 });
    const controller = new AbortController();
    const task = { controller, done: Promise.resolve(null as unknown as ActionChoiceCache) };
    this.active.set(chat, task);
    task.done = this.run(chat, head, conversation.updatedAt, AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120_000)]))
      .finally(() => { if (this.active.get(chat) === task) this.active.delete(chat); });
    return task.done;
  }
  private async run(chat: string, head: string | null, revision: string, signal: AbortSignal): Promise<ActionChoiceCache> {
    const settings = this.repo.getGeneralSettings();
    const options = settings.actionChoices;
    const connectionId = options.connectionId ?? settings.connectionId;
    const saved = connectionId ? this.repo.getRuntimeConnection(connectionId) : null;
    if (!saved) throw new Error('请在通用设置中配置行动选项使用的模型连接。');
    const connection = { ...saved, temperature: options.temperature ?? saved.temperature, maxTokens: options.maxTokens ?? saved.maxTokens,
      contextWindow: options.contextWindow ?? saved.contextWindow ?? 128_000, reasoning: options.reasoning ?? saved.reasoning, historyMessageLimit: options.historyMessageLimit };
    if (connection.protocol === 'anthropic-messages' && connection.temperature > 1) throw new Error('Anthropic 的行动选项温度不能超过 1。');
    const conversation = this.repo.getConversation(chat)!;
    const source = new StoryContext(this.repo, chat, undefined, { choiceHistoryLimit: options.historyMessageLimit });
    const id = randomUUID();
    const trace = createTraceSink(this.repo, this.events, { id, conversationId: chat });
    const request: BaseAgentRequest = {
      connection, conversationId: chat, storyTurnId: id, conversationKind: conversation.kind, scenario: conversation.scenario,
      authorNote: conversation.authorNote, streaming: options.streaming ?? settings.streaming,
      // A fixed start is a lower bound for this independent rolling window, not a request to send all history.
      fixedHistory: false, agencyMode: settings.agencyMode, narrator: settings.narrator,
      characters: source.cast.map(character => ({ ...character, exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' })),
      persona: this.repo.resolvePersona(conversation.personaId), history: source.history,
      stableLore: source.stableLore().filter(item => item.title === 'Scenario' || item.title === 'Group Scenario'),
      dynamicContext: (await source.dynamic(source.history.slice(-3).map(message => message.content).join('\n'))).filter(item => item.source !== 'lore' || item.required),
      latestUserText: '', latestUserIsNarration: false, promptSettings: this.repo.getPromptSettings(),
      source, signal, trace, contextReport: source.contextReport,
    };
    try {
      const choices = actionChoiceListSchema.parse(await this.runtime.choices(request, options.count, options.instruction));
      if (choices.length !== options.count) throw new Error(`行动选项数量应为 ${options.count}。`);
      signal.throwIfAborted();
      const current = this.repo.getConversation(chat);
      if (!current || current.headMessageId !== head || current.updatedAt !== revision || this.turns.busy(chat)) throw new Error('故事已改变，已丢弃过期行动选项。');
      const cache = this.get(chat, head);
      cache.groups.push({ id, choices, createdAt: new Date().toISOString() });
      cache.selectedGroupId = id;
      return this.save(chat, head, cache);
    } catch (error) {
      for (const item of this.repo.listTraces(id)) if (item.status === 'completed') this.repo.updateTrace(item.id, { status: signal.aborted ? 'cancelled' : 'failed', error: this.repo.redactError(error) });
      throw error;
    } finally { trace.flush(); }
  }
  async shutdown() {
    for (const task of this.active.values()) task.controller.abort();
    await Promise.allSettled([...this.active.values()].map(task => task.done));
  }
}
