import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { turnRequestSchema } from '@new-ai-chat/contracts';
import { FakeRuntime, type WriterRequest } from '@new-ai-chat/agent-runtime';
import { TrustedPluginRegistry } from '@new-ai-chat/plugin-sdk';

const opened: Array<{ directory: string; server: Awaited<ReturnType<typeof createApp>> }> = [];
afterEach(async () => { for (const { directory, server } of opened.splice(0)) { await server.app.close(); rmSync(directory, { recursive: true, force: true }); } });
describe('trusted plugin SDK', () => {
  it('enriches captured context, scopes tools, runs one turn hook, and replays projections', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'new-ai-plugin-')); const hooks: string[] = [], requests: WriterRequest[] = [];
    const runtime = new FakeRuntime(); const write = runtime.write.bind(runtime);
    runtime.write = async (request, delta) => { requests.push(request); return write(request, delta); };
    const server = await createApp({ host: '127.0.0.1', port: 0, pairingToken: null, databasePath: join(directory, 'db.sqlite'), assetDir: join(directory, 'assets'), webDist: join(directory, 'web'), defaultImportPath: directory, fakeModel: true }, runtime, registry => {
      registry.registerContextProvider(async () => [{ source: 'lore', title: 'Native plugin', content: 'Captured context', priority: 5 }]);
      registry.registerTool({ name: 'read_state', description: 'Safe scoped state', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, readOnly: true, execute: async (_input, context) => ({ conversationId: context.conversationId }) });
      registry.registerTurnHook(async event => { hooks.push(event.type); });
      registry.registerProjection('completed', (state, event) => Number(state ?? 0) + (event.type === 'story.settled' ? 1 : 0));
      registry.registerSettingsSchema('test', { type: 'object' });
      registry.registerUiPanel({ id: 'test', title: 'Test', moduleUrl: '/internal/panels/test' });
    });
    opened.push({ directory, server });
    const chat = server.repository.listConversations()[0]!;
    server.turns.start(turnRequestSchema.parse({ conversationId: chat.id, input: { voice: 'protagonist', text: 'Hi' } })); await server.turns.idle(chat.id);
    expect(requests).toHaveLength(2); expect(requests[0]!.dynamicContext.some(item => item.content === 'Captured context')).toBe(true);
    expect(await requests[0]!.toolOverrides![0]!.execute({})).toEqual({ conversationId: chat.id });
    expect(hooks).toEqual(['story.settled']);
    expect((await server.app.inject({ url: `/api/conversations/${chat.id}/projections` })).json()).toEqual({ completed: 1 });
    expect((await server.app.inject({ url: '/api/internal-plugins' })).json().panels[0].id).toBe('test');
  });
  it('does not accept arbitrary tools, remote UI code, or duplicate registrations', () => {
    const registry = new TrustedPluginRegistry();
    expect(() => registry.registerTool({ name: 'shell', description: '', readOnly: true, inputSchema: {}, execute: async () => null })).toThrow();
    expect(() => registry.registerUiPanel({ id: 'evil', title: '', moduleUrl: 'https://evil.test/plugin.js' })).toThrow();
    registry.registerSettingsSchema('one', {}); expect(() => registry.registerSettingsSchema('one', {})).toThrow();
    registry.registerProjection('one', () => null); expect(() => registry.registerProjection('one', () => null)).toThrow();
  });
});
