import type { SessionEvent } from '@new-ai-chat/contracts';

export interface PluginToolContext {
  conversationId: string;
  storyTurnId: string;
  signal: AbortSignal;
}

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: true;
  execute(input: unknown, context: PluginToolContext): Promise<unknown>;
}

export interface ContextFragment {
  source: 'lore' | 'memory' | 'state';
  title: string;
  content: string;
  priority: number;
}

export interface PluginRegistry {
  registerTool(tool: RegisteredTool): void;
  registerContextProvider(provider: (conversationId: string) => Promise<ContextFragment[]>): void;
  registerTurnHook(hook: (event: SessionEvent) => Promise<void>): void;
  registerProjection(name: string, reducer: (state: unknown, event: SessionEvent) => unknown): void;
  registerSettingsSchema(namespace: string, schema: Record<string, unknown>): void;
  registerUiPanel(panel: { id: string; title: string; moduleUrl: string }): void;
}

export class TrustedPluginRegistry implements PluginRegistry {
  readonly tools = new Map<string, RegisteredTool>();
  readonly contextProviders: Array<(conversationId: string) => Promise<ContextFragment[]>> = [];
  readonly turnHooks: Array<(event: SessionEvent) => Promise<void>> = [];
  readonly projections = new Map<string, (state: unknown, event: SessionEvent) => unknown>();
  readonly settingsSchemas = new Map<string, Record<string, unknown>>();
  readonly uiPanels = new Map<string, { id: string; title: string; moduleUrl: string }>();

  registerTool(tool: RegisteredTool): void {
    if (!['read_recent_story', 'search_lore', 'read_memory', 'search_memory', 'read_state', 'read_cast'].includes(tool.name) || tool.readOnly !== true) throw new Error('Tools are restricted to the read-only story capabilities.');
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }
  registerContextProvider(provider: (conversationId: string) => Promise<ContextFragment[]>): void {
    this.contextProviders.push(provider);
  }
  registerTurnHook(hook: (event: SessionEvent) => Promise<void>): void {
    this.turnHooks.push(hook);
  }
  registerProjection(name: string, reducer: (state: unknown, event: SessionEvent) => unknown): void {
    if (this.projections.has(name)) throw new Error(`Projection already registered: ${name}`);
    this.projections.set(name, reducer);
  }
  registerSettingsSchema(namespace: string, schema: Record<string, unknown>): void {
    if (this.settingsSchemas.has(namespace)) throw new Error(`Settings already registered: ${namespace}`);
    this.settingsSchemas.set(namespace, schema);
  }
  registerUiPanel(panel: { id: string; title: string; moduleUrl: string }): void {
    if (!/^\/internal\/panels\/[a-z0-9_-]+$/u.test(panel.moduleUrl)) throw new Error('UI panels must reference a statically bundled internal module.');
    if (this.uiPanels.has(panel.id)) throw new Error(`Panel already registered: ${panel.id}`);
    this.uiPanels.set(panel.id, panel);
  }
}
