import { randomUUID } from 'node:crypto';
import type { Context } from '@earendil-works/pi-ai';
import type { RuntimeConnection } from './types.js';

export function authorNoteInFirstSystem(connection: RuntimeConnection): boolean {
  return connection.protocol === 'openai-chat-completions'
    && (/(^|\.)deepseek\.com$/iu.test(new URL(connection.baseUrl).hostname) || /deepseek/iu.test(connection.model));
}

// Pi has no mid-conversation System message. Carry application-marked notes
// through its converter, then restore their real role at the fetch boundary.
export function prepareAuthorNotes(context: Context, connection: RuntimeConnection) {
  const { protocol } = connection;
  const firstSystem = authorNoteInFirstSystem(connection);
  const notes = new Map<string, string>();
  const messages = context.messages.flatMap(message => {
    if (message.role !== 'user' || !('authorNote' in message) || message.authorNote !== true) return [message];
    if (typeof message.content !== 'string') throw new Error('Author note must be text.');
    const marker = `author-note:${randomUUID()}`;
    notes.set(marker, message.content);
    return protocol === 'anthropic-messages' || firstSystem ? [] : [{ ...message, content: marker }];
  });
  return {
    context: notes.size ? { ...context, messages } : context,
    restore(payload: Record<string, unknown>): Record<string, unknown> {
      if (!notes.size) return payload;
      if (firstSystem) {
        if (!Array.isArray(payload.messages)) throw new Error('Unable to place System author note in DeepSeek request.');
        const messages = [...payload.messages];
        const first = messages[0];
        const note = [...notes.values()].join('\n\n');
        if (first?.role === 'system' || first?.role === 'developer') {
          const content = typeof first.content === 'string'
            ? [first.content, note].filter(Boolean).join('\n\n')
            : [...(first.content ?? []), { type: 'text', text: note }];
          messages[0] = { ...first, role: 'system', content };
        } else messages.unshift({ role: 'system', content: note });
        return { ...payload, messages };
      }
      if (protocol === 'anthropic-messages') {
        const system = typeof payload.system === 'string' ? [{ type: 'text', text: payload.system }] : Array.isArray(payload.system) ? payload.system : [];
        // Keep the SDK's stable System block and its cache breakpoint intact.
        return { ...payload, system: [...system, ...[...notes.values()].map(text => ({ type: 'text', text }))] };
      }
      const field = protocol === 'openai-responses' ? 'input' : 'messages';
      const input = payload[field];
      if (!Array.isArray(input)) throw new Error('Unable to place System author note in model request.');
      const restored = new Set<string>();
      const output = input.map(item => {
        const content = item?.content;
        const marker = typeof content === 'string' ? content : Array.isArray(content) && content.length === 1 ? content[0]?.text : undefined;
        if (item?.role !== 'user' || typeof marker !== 'string' || !notes.has(marker)) return item;
        restored.add(marker);
        return { ...item, role: 'system', content: typeof content === 'string' ? notes.get(marker) : [{ ...content[0], text: notes.get(marker) }] };
      });
      if (restored.size !== notes.size) throw new Error('System author note was lost during protocol conversion.');
      return { ...payload, [field]: output };
    },
  };
}
