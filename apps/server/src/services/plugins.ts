import { z } from 'zod';
import type { TrustedPluginRegistry } from '@new-ai-chat/plugin-sdk';
import type { BaseAgentRequest } from '@new-ai-chat/agent-runtime';
import type { Repository } from '../db/repository.js';

const fragments = z.array(z.object({ source: z.enum(['lore', 'memory', 'state']), title: z.string().max(200), content: z.string().max(20_000), priority: z.number().finite() })).max(100);

// No runtime discovery, eval, remote modules or plugin-owned database transaction.
// Only the statically supplied bootstrap in createApp can install trusted code.
export class InternalPluginHost {
  constructor(readonly registry: TrustedPluginRegistry, readonly repository: Repository) {}
  async enrich<T extends BaseAgentRequest>(request: T): Promise<T> {
    const added = [];
    for (const provider of this.registry.contextProviders) {
      request.signal.throwIfAborted();
      added.push(...fragments.parse(await provider(request.conversationId)));
    }
    request.signal.throwIfAborted();
    return { ...request, dynamicContext: [...request.dynamicContext, ...added], toolOverrides: [...this.registry.tools.values()].map((tool) => ({
      name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
      execute: (input: unknown) => { request.signal.throwIfAborted(); return tool.execute(input, { conversationId: request.conversationId, storyTurnId: request.storyTurnId, signal: request.signal }); },
    })) };
  }
  async settled(chat: string): Promise<void> {
    const event = this.repository.events(chat, ['story.settled']).at(-1);
    if (!event) return;
    for (const [index, hook] of this.registry.turnHooks.entries()) {
      try { await hook(structuredClone(event)); }
      catch (error) { this.repository.addEvent(chat, event.turnId, 'plugin.hook.failed', { index, error: this.repository.redactError(error) }); }
    }
  }
  project(chat: string) {
    const events = this.repository.events(chat);
    return Object.fromEntries([...this.registry.projections.entries()].map(([name, reducer]) => [name, events.reduce((state, event) => reducer(state, structuredClone(event)), null as unknown)]));
  }
  metadata() { return { settingsSchemas: Object.fromEntries(this.registry.settingsSchemas), panels: [...this.registry.uiPanels.values()] }; }
}
