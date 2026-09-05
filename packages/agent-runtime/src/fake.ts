import { fallbackPlan } from './plan.js';
import type { AgentRuntime, BaseAgentRequest, RouteRequest, WriterRequest } from './types.js';
export class FakeRuntime implements AgentRuntime {
  async route(request: RouteRequest) {
    request.signal.throwIfAborted();
    const plan = fallbackPlan(request.storyTurnId, request.characters);
    plan.warnings = [];
    plan.outputs.unshift({ speaker: { kind: 'narrator' }, objective: 'Set scene', brief: '' });
    return { ...plan, outputs: plan.outputs.slice(0, request.characters.length ? 2 : 1) };
  }
  async plan(request: RouteRequest) { return this.route(request); }
  async write(request: WriterRequest, onDelta: (delta: string) => void) {
    request.signal.throwIfAborted();
    const text = request.speaker.kind === 'narrator' ? '窗外的雨渐渐停了。门边留着一封未拆的信，纸面映着微光。' : '“要一起看看吗？”她把信推到桌子中央，等着你的回应。';
    for (const delta of text.match(/.{1,5}/gu) ?? []) { request.signal.throwIfAborted(); onDelta(delta); await new Promise((resolve) => setTimeout(resolve, 10)); }
    return { text, providerState: null, usage: { input: 10, output: text.length, cacheRead: 0, cacheWrite: 0, totalTokens: 10 + text.length } };
  }
  async maintain(request: BaseAgentRequest, instruction: string) {
    request.signal.throwIfAborted();
    return instruction.includes('state operations') ? '[]' : JSON.stringify({ timeSpan: '本轮', location: '室内', chronicle: '雨停后，两人在桌边发现并讨论一封信。', dialogue: [], overview: '发现信件' });
  }
  async testConnection() { return { text: 'OK (offline fake model)', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }; }
}
