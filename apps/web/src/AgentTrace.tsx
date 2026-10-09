import { t, formatDate, formatNumber } from './i18n.js';
import { useEffect, useState, type ReactNode } from 'react';
import type { TraceSummary, TurnTrace } from '@new-ai-chat/contracts';
import { api } from './api.js';
import ContextReport from './ContextReport.js';
import './trace.css';

const phases = { get selection() { return t("选择发言者"); }, planning: 'Planner', writing: 'Writer', get records() { return t("记录更新"); }, get plain() { return t("普通写作"); }, get choices() { return t("行动选项"); } };
const statuses = { get running() { return t("运行中"); }, get completed() { return t("完成"); }, get failed() { return t("失败"); }, get cancelled() { return t("已取消"); } };
const format = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const duration = (from?: string | null, to?: string | null) => from && to ? `${formatNumber((Date.parse(to) - Date.parse(from)) / 1000, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s` : '—';

function RawBlock({ title, value, onError }: { title: string; value: unknown; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [value]);
  return <details className="trace-raw" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}</summary>
    {open && <>
      <button disabled={value == null} onClick={() => void navigator.clipboard.writeText(format(value) ?? '').then(() => setCopied(true)).catch(error => onError(error.message))}>{copied ? t("已复制") : t("复制原文")}</button>
      <pre>{value == null ? t("尚未捕获；旧 Trace 可能没有记录此项。") : format(value)}</pre>
    </>}
  </details>;
}

type Block = { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: unknown };

function transcript(trace: TurnTrace) {
  const events = trace.events ?? [];
  const last = events.findLast(event => event.type === 'message_end' && (event.data as any)?.message?.role === 'assistant');
  const message = (last?.data as any)?.message;
  const blocks: Block[] = message?.content ? [...message.content] : [];
  if (!message) for (const event of events) {
    if (event.type !== 'message_update') continue;
    const data = event.data as any;
    const index = data.contentIndex ?? 0;
    if (data.type === 'thinking_delta' || data.type === 'text_delta') {
      const type = data.type === 'thinking_delta' ? 'thinking' : 'text';
      const block = blocks[index] ??= { type };
      if (type === 'thinking') block.thinking = (block.thinking ?? '') + data.delta;
      else block.text = (block.text ?? '') + data.delta;
    } else if (data.block?.type === 'toolCall') blocks[index] = data.block;
  }
  if (!blocks.some(block => block?.type === 'thinking') && trace.thinking) blocks.unshift({ type: 'thinking', thinking: trace.thinking });
  const tools = new Map<string, any>();
  for (const event of events) {
    if (!event.type.startsWith('tool_execution_')) continue;
    const data = event.data as any;
    const tool = tools.get(data.toolCallId) ?? { id: data.toolCallId, name: data.toolName };
    if (event.type === 'tool_execution_start') Object.assign(tool, { arguments: data.args, startedAt: event.at, status: 'running' });
    if (event.type === 'tool_execution_update') tool.result = data.partialResult;
    if (event.type === 'tool_execution_end') Object.assign(tool, { result: data.result, endedAt: event.at, status: data.isError ? 'failed' : 'completed' });
    tools.set(tool.id, tool);
  }
  for (const tool of tools.values()) if (!blocks.some(block => block?.type === 'toolCall' && block.id === tool.id)) blocks.push({ type: 'toolCall', id: tool.id, name: tool.name, arguments: tool.arguments });
  for (const tool of tools.values()) if (tool.status === 'running' && trace.status !== 'running') tool.status = trace.status;
  if (!tools.size) for (const [index, tool] of (trace.tools ?? []).entries()) {
    const id = `legacy-${index}`;
    tools.set(id, { ...tool, status: tool.ok === false ? 'failed' : 'completed' });
    blocks.push({ type: 'toolCall', id, name: tool.name, arguments: tool.arguments });
  }
  return { blocks, tools, message };
}

function RequestTrace({ trace, onError }: { trace: TurnTrace; onError: (message: string) => void }) {
  const { blocks, tools, message } = transcript(trace);
  const usage = trace.usage;
  const input = usage ? usage.input + usage.cacheRead + usage.cacheWrite : null;
  const timing = trace.timing;
  const http = trace.events?.find(event => event.type === 'http.response')?.data as any;
  return <article className="trace-request">
    <header>
      <strong>{phases[trace.phase]}  {t("· 请求")} {trace.requestIndex + 1}</strong>
      <span className={`trace-status ${trace.status}`}>{statuses[trace.status]}</span>
    </header>
    <div className="trace-model">{trace.model}{message?.stopReason && <code>{t('停止原因：')} {message.stopReason}</code>}{http && <code>HTTP {http.status}</code>}</div>
    <dl className="trace-metrics">
      <div><dt>{t("总输入")}</dt><dd>{input == null ? t("未返回") : formatNumber(input)}</dd></div>
      <div><dt>{t("输出")}</dt><dd>{usage?.output == null ? t("未返回") : formatNumber(usage?.output)}</dd></div>
      <div><dt>{t("缓存读取")}</dt><dd>{usage?.cacheRead == null ? t("未返回") : formatNumber(usage?.cacheRead)}{input ? ` · ${Math.round((usage?.cacheRead ?? 0) / input * 100)}%` : ''}</dd></div>
      <div><dt>{t("缓存写入")}</dt><dd>{usage?.cacheWrite == null ? t("未返回") : formatNumber(usage?.cacheWrite)}</dd></div>
      <div><dt>{t("思考 token")}</dt><dd>{usage?.reasoning == null ? t("未返回") : formatNumber(usage?.reasoning)}</dd></div>
      <div><dt>{t("总耗时")}</dt><dd>{duration(timing?.sentAt, timing?.completedAt ?? trace.completedAt)}</dd></div>
      <div><dt>{t("响应头")}</dt><dd>{duration(timing?.sentAt, timing?.headersAt)}</dd></div>
      <div><dt>{t("首个思考")}</dt><dd>{duration(timing?.sentAt, timing?.firstThinkingAt)}</dd></div>
      <div><dt>{t("首个正文")}</dt><dd>{duration(timing?.sentAt, timing?.firstTextAt)}</dd></div>
    </dl>
    {trace.error && <pre className="trace-error">{trace.error}</pre>}
    <div className="trace-transcript">
      {blocks.map((block, index) => {
        if (!block) return null;
        if (block.type === 'thinking') return <details className="trace-block trace-thinking" open key={index}><summary>{t("模型思考")}</summary><pre>{block.thinking}</pre></details>;
        if (block.type === 'text') return <section className="trace-block trace-text" key={index}><h4>{blocks.some(part => part?.type === 'toolCall') ? t("模型文本 · 工具调用前") : t("模型文本")}</h4><pre>{block.text}</pre></section>;
        if (block.type === 'toolCall') {
          const tool = tools.get(block.id ?? '');
          return <section className={`trace-block trace-tool ${tool?.status ?? ''}`} key={index}>
            <h4><code>{block.name ?? t("工具参数接收中")}</code><span>{tool ? statuses[tool.status as keyof typeof statuses] : trace.status === 'running' ? t("接收调用") : t("未执行")} {duration(tool?.startedAt, tool?.endedAt)}</span></h4>
            {block.id && <small className="muted">{block.id}</small>}
            <h5>{t("参数")}</h5><pre>{format(block.arguments ?? tool?.arguments)}</pre>
            {tool?.result !== undefined && <><h5>{t("结果")}</h5><pre>{format(tool.result)}</pre></>}
          </section>;
        }
        return <RawBlock key={index} title={block.type} value={block} onError={onError} />;
      })}
      {!blocks.length && <p className="muted">{trace.status === 'running' ? t("等待模型事件…") : t("此请求没有已记录的模型文本。")}</p>}
    </div>
    <ContextReport report={trace.contextReport ?? null} />
    <RawBlock title={t("Raw input · 实际请求 Body")} value={trace.request} onError={onError} />
    <RawBlock title={t("Raw output · 原始响应 / SSE 流")} value={trace.response} onError={onError} />
    <RawBlock title={t("Pi 事件 · {0} 条（含增量）", trace.events?.length ?? 0)} value={trace.events} onError={onError} />
    <RawBlock title={t("请求元数据 / 用量 / 时间戳")} value={{ id: trace.id, turnId: trace.turnId, speaker: trace.speaker, model: trace.model, phase: trace.phase, status: trace.status, stopReason: message?.stopReason, usage, timing, http, createdAt: trace.createdAt, completedAt: trace.completedAt }} onError={onError} />
  </article>;
}

export default function AgentTrace({ chatId, version, activeTurnId, onError, expanded = false, visible = true, children }: { chatId: string; version: number; activeTurnId: string | null; onError: (message: string) => void; expanded?: boolean; visible?: boolean; children?: ReactNode }) {
  const [summaries, setSummaries] = useState<TraceSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [trace, setTrace] = useState<TurnTrace | null>(null);
  const [copied, setCopied] = useState(false);
  const selectedId = follow ? summaries[0]?.id : selected;
  const selectedStatus = summaries.find(item => item.id === selectedId)?.status;

  useEffect(() => { setSummaries([]); setTrace(null); setSelected(null); setFollow(true); }, [chatId]);
  useEffect(() => {
    if (!visible) return;
    let active = true, pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try { const rows = await api(`/conversations/${chatId}/traces?view=summary`); if (active) setSummaries(rows); }
      catch (error) { if (active) onError((error as Error).message); }
      finally { pending = false; }
    };
    void load();
    const timer = activeTurnId ? setInterval(() => void load(), 750) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [chatId, version, activeTurnId, visible]);

  useEffect(() => {
    if (!visible || !selectedId) return;
    let active = true, pending = false, haveRequest = false;
    setTrace(old => old?.id === selectedId ? old : null); setCopied(false);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await api(`/traces/${selectedId}${haveRequest && selectedStatus === 'running' ? '?view=live' : ''}`);
        haveRequest ||= next.request != null;
        if (active) setTrace(old => old?.id === next.id ? { ...old, ...next } : next);
      } catch (error) { if (active) onError((error as Error).message); }
      finally { pending = false; }
    };
    void load();
    const timer = selectedStatus === 'running' ? setInterval(() => void load(), 500) : undefined;
    return () => { active = false; clearInterval(timer); };
  }, [selectedId, selectedStatus, visible]);

  return <section className={`agent-trace ${expanded ? 'wide' : ''}`} aria-label="Agent Trace">
      <header className="trace-toolbar">
        <strong>Agent Trace</strong>
        <div>
          <button className={follow ? 'active' : ''} onClick={() => { setSelected(selectedId ?? null); setFollow(!follow); }}>{t("跟随最新")}{follow ? ' ✓' : ''}</button>
          <button disabled={!selectedId} onClick={() => void api(`/traces/${selectedId}`).then(value => navigator.clipboard.writeText(JSON.stringify(value, null, 2))).then(() => setCopied(true)).catch(error => onError(error.message))}>{copied ? t("已复制") : t("复制 Trace")}</button>
        </div>
      </header>
      <div className="trace-layout">
        <nav className="trace-requests" aria-label={t("模型请求列表")}>
          {[...new Set(summaries.map(item => item.turnId))].map(turnId => <div key={turnId}>
            <h4>{t("回合")} {turnId.slice(0, 8)}</h4>
            {summaries.filter(item => item.turnId === turnId).sort((a, b) => a.requestIndex - b.requestIndex).map(item => <button className={item.id === selectedId ? 'selected' : ''} key={item.id} onClick={() => { setFollow(false); setSelected(item.id); }}>
              <strong>{item.requestIndex + 1}. {phases[item.phase]} <span className={`trace-status ${item.status}`}>{statuses[item.status]}</span></strong>
              <small>{formatDate(item.createdAt)} · {item.model}</small>
            </button>)}
          </div>)}
          {!summaries.length && <p className="muted">{t("尚无模型请求记录。")}</p>}
        </nav>
        <div className="trace-detail">{children}{trace && trace.id === selectedId ? <RequestTrace key={trace.id} trace={trace} onError={onError} /> : selectedId ? <p className="muted">{t("正在读取 Trace…")}</p> : null}</div>
      </div>
    </section>;
}
