import type {
  MessageNode,
  AgentUsage,
  RequestTiming,
  ProtagonistAgencyMode,
  ProtagonistStateSnapshot,
  SpeakerRef,
  TurnPlan,
  PromptSettings,
  GenerationMode,
  ContextReport,
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
  sourceId?: string;
  messageIds?: string[];
  required?: boolean;
}

export interface RuntimeNarrator {
  name: string;
  style: string;
}

export interface StoryContextSource {
  readRecentStory(limit: number): Promise<MessageNode[]>;
  searchLore(query: string, limit: number): Promise<RetrievedContext[]>;
  readMemory(limit: number): Promise<RetrievedContext[]>;
  searchMemory(query: string, limit: number): Promise<RetrievedContext[]>;
  readState(): Promise<ProtagonistStateSnapshot | null>;
  readCast(): Promise<RuntimeCharacter[]>;
}

export interface BaseAgentRequest {
  toolOverrides?: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; execute(input: unknown): Promise<unknown> }>;
  connection: RuntimeConnection;
  storyTurnId: string;
  conversationId: string;
  conversationKind?: 'solo' | 'group';
  scenario?: string;
  authorNote?: string;
  fixedHistory?: boolean;
  streaming?: boolean;
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
  continuation?: boolean;
  rewrite?: { instruction: string; originalText: string };
  contextReport?: ContextReport;
  promptMode?: 'writer' | 'planner' | 'choices';
  trace?: RuntimeTraceSink;
}

export type TracePhase = 'selection' | 'planning' | 'writing' | 'records' | 'plain' | 'choices';
export interface RuntimeTraceSink {
  event?(traceId: string, type: string, data: unknown): void;
  start(phase: TracePhase, model: string, speaker?: SpeakerRef, contextReport?: ContextReport): string;
  request(traceId: string, payload: unknown): void;
  response(traceId: string, payload: unknown): void;
  thinking(traceId: string, text: string): void;
  timing(traceId: string, timing: Partial<RequestTiming>): void;
  tool(traceId: string, name: string, args: unknown, result?: unknown, ok?: boolean): void;
  finish(traceId: string, status: 'completed' | 'failed' | 'cancelled', usage?: AgentUsage, error?: string): void;
}

export interface RouteRequest extends BaseAgentRequest {
  plannerEnabled: boolean;
}

export interface WriterRequest extends BaseAgentRequest {
  speaker: SpeakerRef;
  pendingSpeaker?: boolean;
  mode?: GenerationMode;
  brief: string;
  outputIndex: number;
}

export type { AgentUsage } from '@new-ai-chat/contracts';

export interface WriterResult {
  text: string;
  providerState: unknown;
  usage: AgentUsage;
  thinking: string;
  timing: RequestTiming;
}

export interface AgentTurnResult {
  plan: TurnPlan;
  results: Array<{ speaker: SpeakerRef; text: string; providerState: unknown; usage: AgentUsage; thinking: string; timing: RequestTiming; requestCount: number }>;
}

export interface UnifiedWriterOptions {
  mode: 'plain' | 'writer-agent';
  forcedPlan?: TurnPlan;
  prefix?: string;
  onDelta: (speaker: SpeakerRef, outputIndex: number, delta: string) => void;
  onTool?: (name: string, args: unknown, outputIndex?: number) => void;
  onPhase?: (phase: 'selection' | 'writing', detail?: unknown) => void;
  onThinkingDelta?: (text: string, outputIndex: number) => void;
  onOutputComplete?: (result: AgentTurnResult['results'][number], outputIndex: number) => void;
}

export interface FirstRequestPreview {
  contextReport: ContextReport;
  phase: TracePhase;
  requestBody: string;
  speaker: SpeakerRef | null;
  pendingSelection: boolean;
  clipped: boolean;
}

export interface AgentRuntime {
  choices(request: BaseAgentRequest, count: number, instruction: string): Promise<string[]>;
  previewFirstRequest(request: BaseAgentRequest, mode: GenerationMode, forcedPlan?: TurnPlan): Promise<FirstRequestPreview>;
  maintain(request: BaseAgentRequest, instruction: string): Promise<string>;
  plan(request: RouteRequest, onTool?: (name: string, args: unknown) => void): Promise<TurnPlan>;
  writeTurn(request: BaseAgentRequest, options: UnifiedWriterOptions): Promise<AgentTurnResult>;
  testConnection(connection: RuntimeConnection, signal: AbortSignal): Promise<{ text: string; usage: AgentUsage }>;
}
