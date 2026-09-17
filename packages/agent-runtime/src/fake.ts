import { fallbackPlan } from './plan.js';
import { PiAgentRuntime } from './runtime.js';
import type { AgentRuntime, AgentTurnResult, BaseAgentRequest, RouteRequest, WriterRequest, UnifiedWriterOptions } from './types.js';
export class FakeRuntime implements AgentRuntime {
  private readonly previewRuntime = new PiAgentRuntime();
  previewFirstRequest(request: BaseAgentRequest, mode: 'plain' | 'writer-agent' | 'planner', forcedPlan?: ReturnType<typeof fallbackPlan>) {
    return this.previewRuntime.previewFirstRequest(request, mode, forcedPlan);
  }
  async route(request: RouteRequest) {
    request.signal.throwIfAborted();
    const plan = fallbackPlan(request.storyTurnId, request.characters);
    plan.warnings = [];
    plan.outputs.unshift({ speaker: { kind: 'narrator' }, objective: 'Set scene', brief: '' });
    return { ...plan, outputs: plan.outputs.slice(0, request.characters.length ? 2 : 1) };
  }
  async plan(request: RouteRequest) { return this.route(request); }
  async write(request: WriterRequest, onDelta: (delta: string) => void, onTool?: (name: string, args: unknown) => void) {
    request.signal.throwIfAborted();
    const text = request.speaker.kind === 'narrator' ? '窗外的雨渐渐停了。门边留着一封未拆的信，纸面映着微光。' : '“要一起看看吗？”她把信推到桌子中央，等着你的回应。';
    for (const delta of text.match(/.{1,5}/gu) ?? []) { request.signal.throwIfAborted(); onDelta(delta); await new Promise((resolve) => setTimeout(resolve, 10)); }
    const completedAt = new Date().toISOString();
    return { text, providerState: null, usage: { input: 10, output: text.length, cacheRead: 0, cacheWrite: 0, totalTokens: 10 + text.length }, thinking: '', timing: { preparedAt: completedAt, sentAt: completedAt, headersAt: completedAt, firstThinkingAt: null, firstTextAt: completedAt, completedAt } };
  }
  async writeTurn(request: BaseAgentRequest, options: UnifiedWriterOptions): Promise<AgentTurnResult> {
    const plan = options.forcedPlan ?? await this.route({ ...request, plannerEnabled: false });
    options.onPhase?.('writing', plan);
    const results = [];
    let history = request.history;
    for (const [outputIndex, output] of plan.outputs.entries()) {
      const result = await this.write({ ...request, history, speaker: output.speaker, outputIndex, brief: output.brief, signal: request.signal }, (delta) => options.onDelta(output.speaker, outputIndex, delta), (name, args) => options.onTool?.(name, args, outputIndex));
      results.push({ speaker: output.speaker, ...result, requestCount: 1 });
      options.onOutputComplete?.(results.at(-1)!, outputIndex);
      const generated = { id: `fake-${outputIndex}`, conversationId: request.conversationId, parentId: null, storyTurnId: request.storyTurnId, role: 'assistant' as const, authorKind: output.speaker.kind, speaker: output.speaker, content: result.text, providerState: null, generationInfo: null, legacyPayload: null, createdAt: new Date().toISOString() };
      history = request.connection.historyMessageLimit ? [generated] : [...history, generated];
    }
    return { plan, results };
  }
  async maintain(request: BaseAgentRequest, instruction: string) {
    request.signal.throwIfAborted();
    return instruction.includes('state operations') ? '[]' : JSON.stringify({ timeSpan: '本轮', location: '室内', chronicle: '雨停后，两人在桌边发现并讨论一封信。', dialogue: [], overview: '发现信件' });
  }
  async testConnection() { return { text: 'OK (offline fake model)', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }; }
}
