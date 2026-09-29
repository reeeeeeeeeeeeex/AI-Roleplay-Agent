import type { RuntimeTraceSink } from '@new-ai-chat/agent-runtime';
import type { AgentTraceEvent, TurnRecord, TurnTrace } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
import type { EventBroker } from './events.js';

export function createTraceSink(repository: Repository, broker: EventBroker, turn: TurnRecord): RuntimeTraceSink & { flush(): void } {
  let requestIndex = 0;
  const buffers = new Map<string, { events: AgentTraceEvent[]; timer?: ReturnType<typeof setTimeout> }>();
  const emit = (type: string, payload: object) => broker.publish(turn.conversationId, turn.id, type, { turnId: turn.id, ...payload });
  function flush(traceId: string) {
    const buffer = buffers.get(traceId);
    if (!buffer) return;
    clearTimeout(buffer.timer); delete buffer.timer;
    repository.updateTrace(traceId, { events: buffer.events });
  }
  return {
    start(phase, model, speaker, contextReport) {
      const index = requestIndex++;
      const trace = repository.createTrace({ conversationId: turn.conversationId, turnId: turn.id, phase, requestIndex: index, status: 'running', model,
        speaker: speaker ?? null, request: null, response: null, contextReport: contextReport ?? null, tools: [], events: [], thinking: null, usage: null,
        timing: { preparedAt: new Date().toISOString(), sentAt: null, headersAt: null, firstThinkingAt: null, firstTextAt: null, completedAt: null }, error: null });
      buffers.set(trace.id, { events: [] });
      emit('trace.started', { traceId: trace.id, phase, requestIndex: index, model, speaker });
      return trace.id;
    },
    event(traceId, type, data) {
      const buffer = buffers.get(traceId);
      if (!buffer) return;
      // Pi mutates partial messages as it streams; retain the event's value at this instant.
      buffer.events.push({ type, at: new Date().toISOString(), data: structuredClone(data) });
      buffer.timer ??= setTimeout(() => flush(traceId), 200);
    },
    request(traceId, request) { repository.updateTrace(traceId, { request }); emit('trace.request', { traceId }); },
    response(traceId, response) { repository.updateTrace(traceId, { response }); emit('trace.response', { traceId }); },
    thinking(traceId, thinking) { repository.updateTrace(traceId, { thinking }); },
    timing(traceId, timing) {
      const current = repository.getTrace(traceId, true);
      if (current?.timing) repository.updateTrace(traceId, { timing: { ...current.timing, ...timing } });
    },
    tool(traceId, name, args, result, ok = true) {
      const current = repository.getTrace(traceId, true);
      repository.updateTrace(traceId, { tools: [...(current?.tools as TurnTrace['tools'] ?? []), { name, arguments: args, result, ok }] });
      emit('tool.completed', { phase: current?.phase, traceId, name, args, ok });
    },
    finish(traceId, status, usage, error) {
      flush(traceId); buffers.delete(traceId);
      const knownUsage = usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens].some(value => value > 0) ? usage : null;
      repository.updateTrace(traceId, { status, usage: knownUsage, error: error ?? null, completedAt: new Date().toISOString() });
      emit('trace.completed', { traceId, status, usage, error });
    },
    flush() {
      for (const traceId of buffers.keys()) flush(traceId);
      buffers.clear();
    },
  };
}
