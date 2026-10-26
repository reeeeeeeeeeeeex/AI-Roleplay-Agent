import type { RuntimeTraceSink } from '@new-ai-chat/agent-runtime';
import type { AgentTraceEvent, AgentUsage, TurnRecord, TurnTrace } from '@new-ai-chat/contracts';
import type { Repository } from '../db/repository.js';
import type { EventBroker } from './events.js';

export function createTraceSink(repository: Repository, broker: EventBroker, turn: Pick<TurnRecord, 'id' | 'conversationId'>, startIndex = 0): RuntimeTraceSink & { flush(): void } {
  let requestIndex = startIndex;
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
      const current = repository.getTraceMetadata(traceId);
      if (current?.timing) repository.updateTrace(traceId, { timing: { ...current.timing, ...timing } });
    },
    tool(traceId, name, args, result, ok = true) {
      const current = repository.getTraceMetadata(traceId);
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

// Record requests finish only after their output has been validated and saved.
export function createRecordTrace(sink: RuntimeTraceSink, phase: 'memory' | 'state' | 'memory-rebuild', model: string) {
  let traceId: string | undefined;
  let usage: AgentUsage | undefined;
  const trace: RuntimeTraceSink = {
    ...sink,
    start(_phase, requestModel, speaker, contextReport) {
      traceId = sink.start(phase, requestModel, speaker, contextReport);
      return traceId;
    },
    finish(_id, _status, requestUsage) { usage = requestUsage; },
  };
  return {
    trace,
    finish(outcome: 'updated' | 'unchanged' | 'no-new-turns' | 'draft' | 'failed', status: 'completed' | 'failed' | 'cancelled' = 'completed', error?: string) {
      traceId ??= sink.start(phase, model);
      sink.event?.(traceId, 'record.result', { outcome });
      sink.finish(traceId, status, usage, error);
    },
  };
}
