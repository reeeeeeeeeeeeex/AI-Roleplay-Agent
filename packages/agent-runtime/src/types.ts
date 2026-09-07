import type {
  MessageNode,
  ProtagonistAgencyMode,
  ProtagonistStateSnapshot,
  SpeakerRef,
  TurnPlan,
  PromptSettings,
} from '@new-ai-chat/contracts';

export interface RuntimeConnection {
  id: string;
  protocol: 'openai-chat-completions' | 'anthropic-messages' | 'openai-responses';
  baseUrl: string;
  model: string;
  apiKey: string;
  headers: Record<string, string>;
  temperature: number;
  maxTokens: number;
  contextWindow?: number;
  historyMessageLimit?: number;
  reasoning: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface RuntimeCharacter {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
}

export interface RuntimePersona {
  name: string;
  description: string;
}

export interface RetrievedContext {
  source: 'lore' | 'memory' | 'state';
  title: string;
  content: string;
  priority: number;
}

export interface RuntimeNarrator {
  name: string;
  style: string;
}

export interface StoryContextSource {
  readRecentStory(limit: number): Promise<MessageNode[]>;
  searchLore(query: string, limit: number): Promise<RetrievedContext[]>;
  readMemory(limit: number): Promise<RetrievedContext[]>;
  readState(): Promise<ProtagonistStateSnapshot | null>;
  readCast(): Promise<RuntimeCharacter[]>;
}

export interface BaseAgentRequest {
  toolOverrides?: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; execute(input: unknown): Promise<unknown> }>;
  connection: RuntimeConnection;
  storyTurnId: string;
  conversationId: string;
  agencyMode: ProtagonistAgencyMode;
  narrator: RuntimeNarrator;
  characters: RuntimeCharacter[];
  persona: RuntimePersona | null;
  history: MessageNode[];
  stableLore: RetrievedContext[];
  dynamicContext: RetrievedContext[];
  latestUserText: string;
  latestUserIsNarration: boolean;
  source: StoryContextSource;
  signal: AbortSignal;
  promptSettings?: PromptSettings;
  trace?: RuntimeTraceSink;
}

export type TracePhase = 'selection' | 'planning' | 'writing' | 'records' | 'plain';
export interface RuntimeTraceSink {
  start(phase: TracePhase, requestIndex: number, model: string): string;
  request(traceId: string, payload: unknown): void;
  response(traceId: string, payload: unknown): void;
  thinking(traceId: string, text: string): void;
  tool(traceId: string, name: string, args: unknown, result?: unknown, ok?: boolean): void;
  finish(traceId: string, status: 'completed' | 'failed' | 'cancelled', usage?: AgentUsage, error?: string): void;
}

export interface RouteRequest extends BaseAgentRequest {
  plannerEnabled: boolean;
}

export interface WriterRequest extends BaseAgentRequest {
  speaker: SpeakerRef;
  brief: string;
  outputIndex: number;
}

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface WriterResult {
  text: string;
  providerState: unknown;
  usage: AgentUsage;
}

export interface AgentTurnResult {
  plan: TurnPlan;
  results: Array<{ speaker: SpeakerRef; text: string; providerState: unknown; usage: AgentUsage }>;
}

export interface UnifiedWriterOptions {
  mode: 'plain' | 'writer-agent';
  forcedPlan?: TurnPlan;
  prefix?: string;
  onDelta: (speaker: SpeakerRef, outputIndex: number, delta: string) => void;
  onTool?: (name: string, args: unknown, outputIndex?: number) => void;
  onPhase?: (phase: 'selection' | 'writing', detail?: unknown) => void;
  onThinking?: (text: string, outputIndex: number) => void;
}

export interface AgentRuntime {
  maintain(request: BaseAgentRequest, instruction: string): Promise<string>;
  plan(request: RouteRequest, onTool?: (name: string, args: unknown) => void): Promise<TurnPlan>;
  route(request: RouteRequest, onTool?: (name: string, args: unknown) => void): Promise<TurnPlan>;
  write(request: WriterRequest, onDelta: (delta: string) => void, onTool?: (name: string, args: unknown) => void): Promise<WriterResult>;
  writeTurn(request: BaseAgentRequest, options: UnifiedWriterOptions): Promise<AgentTurnResult>;
  testConnection(connection: RuntimeConnection, signal: AbortSignal): Promise<{ text: string; usage: AgentUsage }>;
}
