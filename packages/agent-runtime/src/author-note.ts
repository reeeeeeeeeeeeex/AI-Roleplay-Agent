import type { Context } from '@earendil-works/pi-ai';
import type { RuntimeConnection } from './types.js';

// Pi only models user/assistant/tool messages. Remove application-marked notes
// before conversion, then prepend them to the real System at the fetch boundary.
export function prepareAuthorNotes(context: Context, connection: RuntimeConnection) {
  const { protocol } = connection;
  const notes: string[] = [];
  const messages = context.messages.flatMap(message => {
    if (message.role !== 'user' || !('authorNote' in message) || message.authorNote !== true) return [message];
    if (typeof message.content !== 'string') throw new Error('Author note must be text.');
    notes.push(message.content);
    return [];
  });
  return {
    context: notes.length ? { ...context, messages } : context,
    restore(payload: Record<string, unknown>): Record<string, unknown> {
      if (!notes.length) return payload;
      if (protocol === 'anthropic-messages') {
        const system = typeof payload.system === 'string' ? [{ type: 'text', text: payload.system }] : Array.isArray(payload.system) ? payload.system : [];
        return { ...payload, system: [...notes.map(text => ({ type: 'text', text })), ...system] };
      }
      const field = protocol === 'openai-responses' ? 'input' : 'messages';
      const input = payload[field];
      if (!Array.isArray(input)) throw new Error('Unable to place System author note in model request.');
      const output = [...input], first = output[0], note = notes.join('\n\n');
      if (first?.role === 'system' || first?.role === 'developer') {
        const content = typeof first.content === 'string'
          ? [note, first.content].filter(Boolean).join('\n\n')
          : [{ type: protocol === 'openai-responses' ? 'input_text' : 'text', text: note }, ...(first.content ?? [])];
        output[0] = { ...first, role: 'system', content };
      } else output.unshift({ role: 'system', content: note });
      return { ...payload, [field]: output };
    },
  };
}
