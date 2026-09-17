import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Conversation, GenerationMode, PinnedFact } from '@new-ai-chat/contracts';
import { api } from './api.js';
import RecordHistory from './RecordHistory.js';

const tableNames: Record<string, string> = {
  global_state: '全局状态',
  protagonist_info: '主角信息',
  important_characters: '重要角色',
  protagonist_skills: '主角技能',
  inventory: '背包物品',
  quests_events: '任务与事件',
  options: '选项',
};
const formatBody = (value: unknown) => {
  if (typeof value !== 'string') return JSON.stringify(value, null, 2);
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
};

export default function Records({
  chat,
  generationMode,
  version,
  activity,
  liveThinking,
  disabled,
  onError,
  onChanged,
  onClose,
  onSource,
}: {
  chat: Conversation;
  generationMode: GenerationMode;
  version: number;
  activity: any[];
  liveThinking: string;
  disabled: boolean;
  onError: (text: string) => void;
  onChanged: () => void;
  onClose: () => void;
  onSource: (messageId: string) => void;
}) {
  const [tab, setTab] = useState('memory');
  const [memory, setMemory] = useState<any[]>([]);
  const [state, setState] = useState<any>({ tables: {} });
  const [proposals, setProposals] = useState<any[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [stateText, setStateText] = useState('');
  const [editState, setEditState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [baselineMemory, setBaselineMemory] = useState('');
  const [traces, setTraces] = useState<any[]>([]);
  const [facts, setFacts] = useState<PinnedFact[]>([]);
  const [newFact, setNewFact] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([
      api(`/conversations/${chat.id}/memory`),
      api(`/conversations/${chat.id}/state`),
      api(`/conversations/${chat.id}/proposals`),
      api(`/conversations/${chat.id}/traces`),
      api(`/conversations/${chat.id}/facts`),
    ])
      .then(([m, s, p, t, f]) => {
        if (active) {
          setMemory(m);
          setState(s);
          setStateText(JSON.stringify(s.tables, null, 2));
          setProposals(p);
          setTraces(t);
          setFacts(f);
        }
      })
      .catch((error: Error) => {
        if (active) onError(error.message);
      });
    return () => {
      active = false;
    };
  }, [chat.id, version]);

  async function run(path: string, value: unknown = {}, method = 'POST') {
    setBusy(true);
    try {
      await api(path, method, value);
      onChanged();
      return true;
    } catch (error) {
      onError((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="records">
      <header>
        <h2>故事记录</h2>
        <button aria-label="关闭记录面板" onClick={onClose}>
          <X size={16} />
        </button>
      </header>

      <nav>
        {[
          ['memory', 'Memory'],
          ['state', '主角状态'],
          ['planner', 'Agent'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id!)}>
            {label}
          </button>
        ))}
      </nav>

      <div className="records-content">
        {tab === 'memory' && (
          <>
            <details open>
              <summary>固定事实 · 仅由你修改</summary>
              {facts.map(fact => <article className="memory-entry" key={fact.id}>
                <pre>{fact.content}</pre>
                {fact.sourceMessageId && <button onClick={() => onSource(fact.sourceMessageId!)}>查看来源</button>}
                <button disabled={disabled || busy} onClick={() => {
                  const content = window.prompt('修改固定事实（仅当前分支）', fact.content);
                  if (content?.trim()) void run(`/conversations/${chat.id}/facts`, { id: fact.id, content });
                }}>修改</button>
                <button disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/facts/${fact.id}`, {}, 'DELETE')}>取消固定</button>
              </article>)}
              <textarea aria-label="固定事实" rows={2} value={newFact} onChange={event => setNewFact(event.target.value)} />
              <button disabled={disabled || busy || !newFact.trim()} onClick={() => void run(`/conversations/${chat.id}/facts`, { content: newFact }).then(saved => { if (saved) setNewFact(''); })}>固定事实</button>
            </details>
            <button style={{ width: '100%', marginBottom: 12 }} disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/memory/generate`)}>
              {busy ? '更新中…' : '立即生成 Memory'}
            </button>
            {[...memory].reverse().map((entry) => (
              <article className="memory-entry" key={entry.id}>
                <div className="memory-stage">Stage {entry.stage}</div>
                <small className="muted">{entry.coverage ? `覆盖 ${entry.coverage.storyTurnIds.length} 个完整回合` : '覆盖范围：历史记录未提供'}</small>
                {entry.coverage && <div><button onClick={() => onSource(entry.coverage.startMessageId)}>起点</button><button onClick={() => onSource(entry.coverage.endMessageId)}>终点</button></div>}
                <pre>{entry.content || '（空记忆标记）'}</pre>
              </article>
            ))}
            <details>
              <summary>手动添加记录</summary>
              <textarea aria-label="手动记忆" rows={4} value={newMemory} onChange={(e) => setNewMemory(e.target.value)} />
              <button disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/memory`, { content: newMemory }).then(saved => { if (saved) setNewMemory(''); })}>
                保存记录
              </button>
            </details>
            <details>
              <summary>替换当前 Memory</summary>
              <p className="muted" style={{ margin: '6px 0' }}>保存为新基线。保存空内容可清空模型读取的记忆。</p>
              <button
                onClick={() => {
                  const baseline = memory.findIndex((m) => m.source === 'imported' || m.source === 'manual');
                  setBaselineMemory((baseline < 0 ? memory : memory.slice(0, baseline + 1)).reverse().map((m) => m.content).join('\n\n'));
                }}
              >
                载入当前记忆
              </button>
              <textarea aria-label="替换记忆" rows={4} value={baselineMemory} onChange={(e) => setBaselineMemory(e.target.value)} />
              <button disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/memory`, { content: baselineMemory, mode: 'replace' })}>
                保存基线
              </button>
            </details>
          </>
        )}

        {tab === 'state' && (
          <>
            <div className="two-col" style={{ marginBottom: 12 }}>
              <button disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/state/generate`)}>
                AI 更新
              </button>
              <button disabled={disabled || busy} onClick={() => setEditState(!editState)}>
                编辑数据
              </button>
            </div>
            {editState ? (
              <>
                <textarea className="code state-editor" aria-label="状态 JSON" value={stateText} onChange={(e) => setStateText(e.target.value)} />
                <button
                  disabled={disabled || busy}
                  onClick={() => {
                    try {
                      void run(`/conversations/${chat.id}/state`, { tables: JSON.parse(stateText) });
                    } catch (error) {
                      onError((error as Error).message);
                    }
                  }}
                >
                  验证并保存
                </button>
              </>
            ) : (
              Object.entries(state.tables ?? {}).map(([table, rows]) => (
                <details className="state-table" key={table} open={table === 'global_state' || table === 'protagonist_info'}>
                  <summary>
                    <span>{tableNames[table] ?? table}</span>
                    <small>{(rows as any[]).length}</small>
                  </summary>
                  {(rows as any[]).map((row, index) => (
                    <dl key={index}>
                      {Object.entries(row)
                        .filter(([key]) => key !== 'row_id')
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{String(value ?? '—') || '—'}</dd>
                          </div>
                        ))}
                    </dl>
                  ))}
                  {!(rows as any[]).length && <p className="muted" style={{ padding: '6px 0' }}>暂无记录</p>}
                </details>
              ))
            )}
          </>
        )}

        {tab === 'planner' && (
          <>
            <h3 className="planner-status">{generationMode === 'plain' ? '普通写作' : generationMode === 'planner' ? 'Planner → Writer' : '统一 Writer Agent'}</h3>
            {generationMode !== 'plain' && liveThinking && <details className="activity" open><summary>当前请求 · 可见思考</summary><pre>{liveThinking}</pre></details>}
            {proposals.map((p) => (
              <article className="proposal" key={p.id}>
                <small className="muted">{p.kind === 'state' ? '状态提案' : '世界事件'} · {p.status}</small>
                <pre>{JSON.stringify(p.payload, null, 2)}</pre>
                <div>
                  {(p.status === 'pending' ? ['apply', 'reject'] : p.status === 'applied' ? ['undo'] : []).map((action) => (
                    <button disabled={disabled || busy} key={action} onClick={() => void run(`/proposals/${p.id}/${action}`)}>
                      {{ apply: '应用', reject: '拒绝', undo: '撤销' }[action]}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            <div style={{ marginTop: 14 }}>
              <div className="nav-label" style={{ paddingLeft: 0 }}>模型请求 Trace（最近 20 回合）</div>
              {[...new Set(traces.map((trace) => trace.turnId))].map((turnId) => {
                const records = traces.filter((trace) => trace.turnId === turnId).sort((a, b) => a.requestIndex - b.requestIndex);
                return <details className="activity trace-turn" key={turnId} open={turnId === traces[0]?.turnId}>
                  <summary>回合 {turnId.slice(0, 8)} · {records.length} 次请求</summary>
                  {records.map((trace) => {
                    const usage = trace.usage;
                    const totalInput = usage ? usage.input + usage.cacheRead + usage.cacheWrite : null;
                    const cacheRate = totalInput && usage ? `${Math.round(usage.cacheRead / totalInput * 100)}%` : usage ? '0%' : '未返回';
                    const elapsed = (start: string | null, end: string | null) => start && end ? `${(Date.parse(end) - Date.parse(start)) / 1000}s` : '未返回';
                    const timing = trace.timing;
                    const phaseName = ({ selection: '选人', planning: '规划', writing: '写作', records: '记录更新', plain: '普通写作' } as Record<string, string>)[trace.phase] ?? trace.phase;
                    return <article className="trace-card" key={trace.id}>
                    <header><strong>{phaseName}</strong><span>{trace.model} · 请求 {trace.requestIndex + 1} · {trace.status}</span></header>
                    <small className="muted">工具 {trace.tools?.length ?? 0} · 总输入 {totalInput ?? '未返回'} · 输出 {usage?.output ?? '未返回'} · 缓存命中 {usage?.cacheRead ?? '未返回'} / {cacheRate}{usage?.cacheWrite ? ` · 缓存写入 ${usage.cacheWrite}` : ''}{usage?.reasoning !== undefined ? ` · 思考 ${usage.reasoning}` : ''}</small>
                    <small className="muted">准备 {elapsed(timing?.preparedAt, timing?.sentAt)} · 响应头 {elapsed(timing?.sentAt, timing?.headersAt)} · 首次思考 {elapsed(timing?.sentAt, timing?.firstThinkingAt)} · 首次正文 {elapsed(timing?.sentAt, timing?.firstTextAt)} · 总耗时 {elapsed(timing?.sentAt, timing?.completedAt)}</small>
                    {trace.speaker && <small className="muted">输出身份：{trace.speaker.kind === 'narrator' ? '旁白' : trace.speaker.characterId}</small>}
                    <details><summary>实际请求 Body</summary><pre>{trace.request ? formatBody(trace.request) : '不可用（旧回合未捕获）'}</pre></details>
                    {trace.response && <details><summary>原始响应 Body</summary><pre>{formatBody(trace.response)}</pre></details>}
                    <details><summary>工具调用与结果</summary><pre>{trace.tools?.length ? JSON.stringify(trace.tools, null, 2) : '无工具调用'}</pre></details>
                    <details open><summary>可见思考</summary><pre>{trace.thinking || '模型未返回可见思考内容。'}</pre></details>
                    {trace.error && <p className="warning">{trace.error}</p>}
                  </article>;})}
                </details>;
              })}
              {!traces.length && activity.map((event, index) => <details className="activity" key={event.id ?? index} open={index >= activity.length - 3}><summary>{event.type}</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>)}
              {!traces.length && !activity.length && <p className="muted">本轮尚未产生请求记录。</p>}
            </div>
          </>
        )}

        <RecordHistory
          chatId={chat.id}
          tab={tab}
          version={version}
          disabled={disabled || busy}
          onChanged={onChanged}
          onError={onError}
        />
      </div>
    </aside>
  );
}
