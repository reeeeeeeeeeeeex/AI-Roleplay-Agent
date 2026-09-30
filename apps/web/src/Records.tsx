import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { stateColumnLabels, type Conversation, type GenerationMode, type PinnedFact, type StateTableName } from '@new-ai-chat/contracts';
import StateCollectionRow from './StateCollectionRow.js';
import { api } from './api.js';
import RecordHistory from './RecordHistory.js';
import AgentTrace from './AgentTrace.js';
import AutoSaveField from './AutoSaveField.js';
import { flushContentEdits } from './useContentAutosave.js';

const tableNames: Record<string, string> = {
  global_state: '全局状态',
  protagonist_info: '主角信息',
  important_characters: '重要角色',
  protagonist_skills: '主角技能',
  inventory: '背包物品',
  quests_events: '任务与事件',
};
export default function Records({
  chat,
  generationMode,
  version,
  activity,
  activeTurnId,
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
  activeTurnId: string | null;
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
  const [busy, setBusy] = useState(false);
  const [facts, setFacts] = useState<PinnedFact[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api(`/conversations/${chat.id}/memory`),
      api(`/conversations/${chat.id}/state`),
      api(`/conversations/${chat.id}/proposals`),
      api(`/conversations/${chat.id}/facts`),
    ])
      .then(([m, s, p, f]) => {
        if (active) {
          setMemory(m);
          setState(s);
          setProposals(p);
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
    try {
      await flushContentEdits();
      setBusy(true);
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
                <AutoSaveField key={`${fact.id}:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:fact:${fact.id}`} initial={fact.content} label="固定事实内容" disabled={disabled || busy} onError={onError}
                  onSave={async (content, previous) => {
                    const saved = await api(`/conversations/${chat.id}/facts`, 'POST', { id: fact.id, content, previous, head: chat.headMessageId }, { keepalive: true });
                    setFacts(items => items.map(item => item.id === fact.id ? saved : item)); onChanged(); return saved.content;
                  }} />
                {fact.sourceMessageId && <button onClick={() => onSource(fact.sourceMessageId!)}>查看来源</button>}
                  <button disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/facts/${fact.id}`, {}, 'DELETE')}>取消固定</button>
              </article>)}
              <AutoSaveField key={`new-fact:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:new-fact`} initial="" label="添加固定事实" placeholder="填写固定事实，离开自动保存" disabled={disabled || busy} resetOnSave lockWhileSaving onError={onError}
                onSave={async content => { await api(`/conversations/${chat.id}/facts`, 'POST', { content, head: chat.headMessageId }, { keepalive: true }); onChanged(); }} />
            </details>
            <button style={{ width: '100%', marginBottom: 12 }} disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/memory/generate`)}>
              {busy ? '更新中…' : '立即生成 Memory'}
            </button>
            {[...memory].reverse().map((entry) => (
              <article className="memory-entry" key={entry.id}>
                <div className="memory-stage">Stage {entry.stage}</div>
                <small className="muted">{entry.coverage ? `覆盖 ${entry.coverage.storyTurnIds.length} 个完整回合` : '覆盖范围：历史记录未提供'}</small>
                {entry.coverage && <div><button onClick={() => onSource(entry.coverage.startMessageId)}>起点</button><button onClick={() => onSource(entry.coverage.endMessageId)}>终点</button></div>}
                <AutoSaveField key={`${entry.id}:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:memory:${entry.id}`} initial={entry.content} label={`Memory Stage ${entry.stage}`} placeholder="（空记忆标记）" disabled={disabled || busy} onError={onError}
                  onSave={async (content, previous) => {
                    const saved = await api(`/conversations/${chat.id}/memory/${entry.id}`, 'PATCH', { content, previous, head: chat.headMessageId }, { keepalive: true });
                    setMemory(items => items.map(item => item.id === entry.id ? saved : item)); onChanged();
                  }} />
              </article>
            ))}
            <details>
              <summary>手动添加记录</summary>
              <AutoSaveField key={`new-memory:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:new-memory`} initial="" label="手动记忆" placeholder="填写记忆，离开自动保存" disabled={disabled || busy} resetOnSave lockWhileSaving onError={onError}
                onSave={async content => { await api(`/conversations/${chat.id}/memory`, 'POST', { content, head: chat.headMessageId }, { keepalive: true }); onChanged(); }} />
            </details>

          </>
        )}

        {tab === 'state' && (
          <>
            <button style={{ width: '100%', marginBottom: 12 }} disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/state/generate`)}>AI 更新</button>
            {Object.entries(state.tables ?? {}).map(([table, rows]) => (
                <details className="state-table" key={table} open={table === 'global_state' || table === 'protagonist_info'}>
                  <summary>
                    <span>{tableNames[table] ?? table}</span>
                    <small>{(rows as any[]).length}</small>
                  </summary>
                  {(rows as any[]).map((row) => table !== 'global_state' && table !== 'protagonist_info' ? (
                    <StateCollectionRow key={`${chat.headMessageId}:${row.row_id}`} chatId={chat.id} head={chat.headMessageId} table={table as StateTableName} row={row} disabled={disabled || busy} onError={onError} onSaved={saved => { setState(saved); onChanged(); }} />
                  ) : (
                    <dl key={row.row_id}>
                      {Object.entries(row)
                        .filter(([key]) => key !== 'row_id')
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>{stateColumnLabels[table as StateTableName]?.[key] ?? key}</dt>
                            <dd><AutoSaveField key={`${chat.headMessageId}:${table}:${row.row_id}:${key}`} draftKey={`${chat.id}:${chat.headMessageId}:state:${table}:${row.row_id}:${key}`} initial={String(value ?? '')} label={`${tableNames[table]} ${row.row_id} ${stateColumnLabels[table as StateTableName]?.[key] ?? key}`} disabled={disabled || busy} onError={onError}
                              onSave={async (content, previous) => {
                                const saved = await api(`/conversations/${chat.id}/state/cell`, 'PATCH', { table, rowId: row.row_id, column: key, content, previous, head: chat.headMessageId }, { keepalive: true });
                                setState(saved); onChanged();
                              }} /></dd>
                          </div>
                        ))}
                    </dl>
                  ))}
                  {!(rows as any[]).length && <p className="muted" style={{ padding: '6px 0' }}>暂无记录</p>}
                </details>
              ))}
          </>
        )}

        {tab === 'planner' && (
          <>
            <h3 className="planner-status">{generationMode === 'plain' ? '普通写作' : generationMode === 'planner' ? 'Planner → Writer' : '统一 Writer Agent'}</h3>
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
            <AgentTrace key={chat.id} chatId={chat.id} version={version} activeTurnId={activeTurnId} onError={onError} />
            {activity.length > 0 && <details className="activity"><summary>当前回合事件 · 最近 80 条</summary><pre>{JSON.stringify(activity, null, 2)}</pre></details>}
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
