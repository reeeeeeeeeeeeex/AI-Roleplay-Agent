import type { SessionEvent } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
export class EventBroker {
  private listeners = new Map<string, Set<(event: SessionEvent) => void>>();
  constructor(private repository: Repository) {}
  publish(chat: string, turn: string | null, type: string, payload: unknown): SessionEvent {
    const event = this.repository.addEvent(chat, turn, type, payload);
    if (turn) for (const listener of this.listeners.get(turn) ?? []) listener(event);
    return event;
  }
  subscribe(turn: string, listener: (event: SessionEvent) => void): () => void {
    const set = this.listeners.get(turn) ?? new Set(); set.add(listener); this.listeners.set(turn, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(turn); };
  }
}
