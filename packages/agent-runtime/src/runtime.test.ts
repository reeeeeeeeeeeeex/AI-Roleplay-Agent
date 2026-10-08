import { describe, expect, it, vi } from 'vitest';
import { defaultPromptSettings, type TurnPlan } from '@new-ai-chat/contracts';
import { PiAgentRuntime } from './runtime.js';
import { PiModelGateway } from './pi-gateway.js';
import type { BaseAgentRequest, RuntimeTraceSink } from './types.js';

const character = { id: 'character-a', name: '自由扮演', description: 'Describe the scene.', personality: '', scenario: '', exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '' };
const fixedPlan: TurnPlan = {
  storyTurnId: 'turn', sceneObjective: 'Rewrite the reply.',
  outputs: [{ speaker: { kind: 'character', characterId: character.id }, objective: 'Rewrite', brief: 'Preserve the scene.' }],
  worldEventProposals: [], protagonistStateProposals: [], warnings: [],
};
const selection = { name: 'select_output_voices', args: { outputs: [{ speaker: { kind: 'narrator' }, brief: 'Set the scene.' }] } };
type Step = { text?: string; thinking?: string; calls?: Array<{ name: string; args: unknown }>; error?: string };

function setup(steps: Step[]) {
  const bodies: string[] = [];
  const network = vi.fn<typeof fetch>(async (_url, init) => {
    bodies.push(String(init?.body));
    const step = steps[bodies.length - 1];
    if (!step) throw new Error('Unexpected model request.');
    if (step.error) return Response.json({ error: { message: step.error, type: 'invalid_request_error' } }, { status: 400 });
    const chunk = (delta: unknown, finish_reason: string | null = null) => ({
      id: `response-${bodies.length}`, object: 'chat.completion.chunk', model: 'test',
      choices: [{ index: 0, delta, finish_reason }],
    });
    const events = [
      chunk({ role: 'assistant', ...(step.thinking ? { reasoning_content: step.thinking } : {}) }),
      ...(step.text ? [chunk({ content: step.text })] : []),
      ...(step.calls ? [chunk({ tool_calls: step.calls.map((call, index) => ({ index, id: `call-${bodies.length}-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } })) })] : []),
      { ...chunk({}, step.calls?.length ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 50, completion_tokens: 10 } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}`).join('\n\n') + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const runtime = new PiAgentRuntime(new PiModelGateway(network));
  const traces: Array<{ status?: string; error?: string; response?: unknown; events: Array<{ type: string; data: any }>; tools: Array<{ name: string; args: unknown; result: unknown; ok: boolean | undefined }> }> = [];
  const trace: RuntimeTraceSink = {
    start: () => { traces.push({ tools: [], events: [] }); return String(traces.length - 1); },
    request: () => {}, response: (id, value) => { traces[Number(id)]!.response = value; }, thinking: () => {}, timing: () => {},
    event: (id, type, data) => { traces[Number(id)]!.events.push({ type, data: structuredClone(data) }); },
    tool: (id, name, args, result, ok) => { traces[Number(id)]!.tools.push({ name, args, result, ok }); },
    finish: (id, status, _usage, error) => { Object.assign(traces[Number(id)]!, { status, error }); },
  };
  const controller = new AbortController();
  const request: BaseAgentRequest = {
    connection: { id: 'test', protocol: 'openai-chat-completions', baseUrl: 'https://example.test/v1', model: 'test', apiKey: 'test', headers: {}, temperature: 1, maxTokens: 1000, contextWindow: 128000, reasoning: 'high' },
    conversationId: 'chat', storyTurnId: 'turn', conversationKind: 'solo', streaming: true,
    agencyMode: 'protected', narrator: { name: '旁白', style: '' }, characters: [character], persona: null,
    history: [], stableLore: [], dynamicContext: [], latestUserText: 'Continue.', latestUserIsNarration: false,
    source: { readRecentStory: async () => [], searchLore: async () => [], readMemory: vi.fn(async () => []), searchMemory: async () => [], readState: async () => null, readCast: async () => [character] },
    signal: controller.signal, promptSettings: defaultPromptSettings, trace,
  };
  return { runtime, request, network, bodies, traces, controller };
}

it('plain thinking-only responses preserve diagnostics without saving prose or retrying automatically', async () => {
  const { runtime, request, network, traces } = setup([{ thinking: '离线模拟思考内容' }]);
  const thinking = vi.spyOn(request.trace!, 'thinking');
  const finish = vi.spyOn(request.trace!, 'finish');
  const onOutputComplete = vi.fn();
  const onDelta = vi.fn();
  await expect(runtime.writeTurn(request, { mode: 'plain', onDelta, onOutputComplete })).rejects.toThrow('模型仅返回了思考内容，没有返回正文（结束原因：stop）');
  expect(network).toHaveBeenCalledTimes(1);
  expect(onOutputComplete).not.toHaveBeenCalled(); expect(onDelta).not.toHaveBeenCalled();
  expect(thinking).toHaveBeenCalledWith('0', '离线模拟思考内容');
  expect(finish).toHaveBeenCalledWith('0', 'failed', expect.objectContaining({ input: 50, output: 10 }), expect.stringContaining('本次输出未保存'));
  expect(traces[0]?.response).toContain('data: [DONE]');
});

it('sends memories from oldest to newest in the plain request body and preview', async () => {
  const { runtime, request, network, bodies } = setup([{ text: 'Continue the story.' }]);
  request.dynamicContext = [
    { source: 'memory', title: 'Pinned Fact', content: 'User fact.', priority: 2000, required: true },
    { source: 'state', title: 'Current state', content: 'Current facts.', priority: 500 },
    ...[3, 1, 2].map(stage => ({ source: 'memory' as const, title: `Stage ${stage}`, content: `Past stage ${stage}.`, priority: 100 + stage / 1_000_000 })),
  ];
  const preview = await runtime.previewFirstRequest(request, 'plain');
  expect(network).not.toHaveBeenCalled();
  await runtime.writeTurn(request, { mode: 'plain', onDelta: () => {}, onOutputComplete: async () => {} });
  expect(bodies[0]).toBe(preview.requestBody);
  const body = JSON.parse(bodies[0]!);
  expect(body.messages.slice(1, -1).map((message: { content: string }) => message.content.match(/^\[([^\]]+)\]/u)?.[1]))
    .toEqual(['Pinned Fact', 'User State', 'Memory: Stage 1', 'Memory: Stage 2', 'Memory: Stage 3']);
});

it('action choice requests omit writing instructions and history reasoning, and trace malformed results', async () => {
  const { runtime, request, bodies, traces } = setup([{ text: '["观察门口。","询问来意。"]', thinking: '当前选择思考' }, { text: '["重复","重复"]' }]);
  request.connection.model = 'deepseek-test';
  request.authorNote = '选项作者注释';
  request.characters = [{ ...character, description: '角色身份', exampleDialogue: '禁止发送示例', systemPrompt: '禁止发送卡片主指令' }];
  request.promptSettings = { ...defaultPromptSettings, mainInstruction: '禁止发送正文主指令', additionalInstruction: '附加要求' };
  request.history = [{ id: 'history', conversationId: 'chat', parentId: null, storyTurnId: null, role: 'assistant', authorKind: 'character', speaker: { kind: 'character', characterId: character.id }, content: '已发生正文', providerState: { reasoning_content: '禁止发送旧思考' }, legacyPayload: null, createdAt: new Date().toISOString() }];
  request.stableLore = [{ source: 'lore', title: 'Book', content: '禁止发送整本世界书', priority: 1 }];
  expect(await runtime.choices(request, 2, '可编辑选项指令')).toEqual(['观察门口。', '询问来意。']);
  const body = JSON.parse(bodies[0]!);
  expect(body.tools).toBeUndefined();
  expect(body.messages[0].content).toContain('选项作者注释');
  expect(bodies[0]).toContain('附加要求'); expect(bodies[0]).toContain('可编辑选项指令'); expect(bodies[0]).toContain('已发生正文');
  expect(bodies[0]).not.toContain('禁止发送');
  await expect(runtime.choices(request, 2, '可编辑选项指令')).rejects.toThrow();
  expect(traces.map(trace => trace.status)).toEqual(['completed', 'failed']);
  expect(traces[0]!.response).toContain('当前选择思考');
  expect(traces[1]!.response).toContain('重复');
});

describe('Agent tool lifecycle', () => {
  it('keeps a rewrite speaker fixed and recovers from a hallucinated selection tool', async () => {
    const { runtime, request, bodies, traces, network } = setup([{ calls: [selection] }, { text: 'Rewritten story.' }]);
    request.rewrite = { instruction: 'Use clearer wording.', originalText: 'Old story.' };
    request.authorNote = 'Keep the scene quiet.';
    request.promptSettings = { ...defaultPromptSettings, additionalInstruction: 'Use precise dialogue.' };
    const preview = await runtime.previewFirstRequest(request, 'writer-agent', fixedPlan);
    expect(network).not.toHaveBeenCalled();
    const onOutputComplete = vi.fn();
    const result = await runtime.writeTurn(request, { mode: 'writer-agent', forcedPlan: fixedPlan, onDelta: () => {}, onOutputComplete });
    expect(bodies[0]).toBe(preview.requestBody);
    const first = JSON.parse(bodies[0]!);
    expect(first.tools.map((tool: any) => tool.function.name)).not.toContain('select_output_voices');
    expect(first.messages.at(-1).content).toContain(`The assigned speaker is ${JSON.stringify(fixedPlan.outputs[0]!.speaker)}`);
    expect(result.results[0]).toMatchObject({ speaker: fixedPlan.outputs[0]!.speaker, text: 'Rewritten story.' });
    expect(onOutputComplete).toHaveBeenCalledTimes(1);
    expect(traces[0]?.tools[0]).toMatchObject({ name: 'select_output_voices', ok: false });
    expect(traces[0]?.error).toContain('not found');
    expect(traces[1]?.status).toBe('completed');
    expect(first.messages[0].role).toBe('system');
    expect(first.messages[0].content.startsWith("[Author's Note]\nKeep the scene quiet.")).toBe(true);
    expect(first.messages[0].content).toContain('[Additional Instruction]\nUse precise dialogue.');
    expect(JSON.parse(bodies[1]!).messages.slice(0, first.messages.length)).toEqual(first.messages);
  });

  it('routes exact character IDs and writes two voices without exposing tool commentary', async () => {
    const voices = [{ speaker: { kind: 'character', characterId: character.id }, brief: 'Speak first.' }, { speaker: { kind: 'narrator' }, brief: 'Describe next.' }];
    const { runtime, request, bodies, traces } = setup([
      { thinking: 'Choose voices.', calls: [{ name: 'select_output_voices', args: { outputs: voices } }] },
      { text: 'I will inspect memory.', calls: [{ name: 'read_memory', args: {} }] },
      { text: 'Character prose.' }, { text: 'Narrator prose.' },
    ]);
    const preview = await runtime.previewFirstRequest(request, 'writer-agent');
    const onDelta = vi.fn(), onOutputComplete = vi.fn();
    const result = await runtime.writeTurn(request, { mode: 'writer-agent', prefix: '', onDelta, onOutputComplete });
    expect(bodies[0]).toBe(preview.requestBody);
    const tool = JSON.parse(bodies[0]!).tools.find((tool: any) => tool.function.name === 'select_output_voices');
    expect(JSON.stringify(tool)).toContain(character.id);
    expect(JSON.stringify(tool)).toContain(character.name);
    expect(bodies[1]).toContain('Choose voices.');
    expect(bodies[1]).toContain('Write only the first selected voice now');
    expect(traces[0]?.tools[0]).toMatchObject({ name: 'select_output_voices', ok: true });
    expect(traces[1]?.tools[0]).toMatchObject({ name: 'read_memory', ok: true });
    expect(onDelta.mock.calls.map(call => call[2])).toEqual(['Character prose.', 'Narrator prose.']);
    expect(result.results.map(output => output.speaker)).toEqual(voices.map(output => output.speaker));
    expect(onOutputComplete.mock.calls.map(call => call[1])).toEqual([0, 1]);
    expect(traces[0]!.events.find(event => event.type === 'message_update' && event.data.type === 'thinking_delta')?.data).toMatchObject({ delta: 'Choose voices.' });
    expect(traces[0]!.events.filter(event => event.type.startsWith('tool_execution_')).map(event => event.type)).toEqual(['tool_execution_start', 'tool_execution_end']);
    expect(traces[1]!.events.find(event => event.type === 'message_end')?.data.message.content).toContainEqual({ type: 'text', text: 'I will inspect memory.' });
    expect(traces[0]!.response).toContain('data: [DONE]');
    expect(traces[2]!.events.find(event => event.type === 'message_end')?.data.message.stopReason).toBe('stop');
    expect(traces[0]!.events.filter(event => event.type === 'message_update').every(event => !('partial' in event.data))).toBe(true);
  });

  it('returns a corrective tool result for repeated selection without losing the selected speaker', async () => {
    const { runtime, request, bodies, traces } = setup([{ calls: [selection] }, { calls: [selection] }, { text: 'Story after correction.' }]);
    const result = await runtime.writeTurn(request, { mode: 'writer-agent', onDelta: () => {} });
    expect(result.results[0]?.text).toBe('Story after correction.');
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toContain('Speaker selection is already complete');
    expect(traces[1]?.tools[0]).toMatchObject({ name: 'select_output_voices', ok: false });
    expect(traces[1]?.status).toBe('failed');
  });

  it('counts invalid tool calls and reports their actual failure at the tool limit', async () => {
    const { runtime, request, bodies, traces } = setup(Array.from({ length: 7 }, () => ({ calls: [{ name: 'search_lore', args: {} }] })));
    await expect(runtime.writeTurn(request, { mode: 'writer-agent', forcedPlan: fixedPlan, onDelta: () => {} })).rejects.toThrow('Writer Agent tool call limit exceeded (6).');
    expect(bodies).toHaveLength(7);
    expect(traces.every(trace => trace.tools[0]?.ok === false)).toBe(true);
    expect(traces[0]?.error).toContain('query');
    expect(traces.at(-1)?.error).toContain('tool call limit');
  });

  it.each(['writer', 'planner'] as const)('preserves upstream errors before %s selection', async (mode) => {
    const { runtime, request, bodies, traces } = setup([{ error: 'Upstream rejected the test model.' }]);
    const result = mode === 'planner' ? runtime.plan({ ...request, plannerEnabled: true }) : runtime.writeTurn(request, { mode: 'writer-agent', onDelta: () => {} });
    await expect(result).rejects.toThrow('Upstream rejected the test model.');
    expect(bodies).toHaveLength(1);
    expect(traces[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('Upstream rejected') });
  });

  it('records planner read and submit tool results on the originating request traces', async () => {
    const { runtime, request, bodies, traces } = setup([{ calls: [{ name: 'read_memory', args: {} }] }, { calls: [{ name: 'submit_turn_plan', args: { ...fixedPlan, outputs: fixedPlan.outputs } }] }]);
    request.authorNote = 'Plan a quiet scene.';
    const result = await runtime.plan({ ...request, plannerEnabled: true });
    expect(result.outputs).toEqual(fixedPlan.outputs);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const messages = JSON.parse(body).messages;
      expect(messages[0].role).toBe('system');
      expect(messages[0].content.startsWith("[Author's Note]\nPlan a quiet scene.")).toBe(true);
      expect(JSON.stringify(messages.slice(1))).not.toContain("Author's Note");
    }
    expect(traces.map(trace => trace.tools[0]?.name)).toEqual(['read_memory', 'submit_turn_plan']);
    expect(traces.every(trace => trace.status === 'completed' && trace.tools[0]?.ok)).toBe(true);
  });

  it('cancels before tool execution without saving prose or starting another request', async () => {
    const { runtime, request, controller, bodies, traces } = setup([{ calls: [{ name: 'read_memory', args: {} }] }]);
    const onOutputComplete = vi.fn();
    await expect(runtime.writeTurn(request, { mode: 'writer-agent', forcedPlan: fixedPlan, onDelta: () => {}, onOutputComplete, onTool: () => controller.abort() })).rejects.toThrow();
    expect(request.source.readMemory).not.toHaveBeenCalled();
    expect(onOutputComplete).not.toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
    expect(traces[0]?.status).toBe('cancelled');
  });
});
