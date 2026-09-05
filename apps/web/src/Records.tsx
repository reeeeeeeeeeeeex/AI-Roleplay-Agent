import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Conversation } from '@new-ai-chat/contracts';
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

export default function Records({
  chat,
  version,
  activity,
  disabled,
  onError,
  onChanged,
  onClose,
}: {
  chat: Conversation;
  version: number;
  activity: any[];
  disabled: boolean;
  onError: (text: string) => void;
  onChanged: () => void;
  onClose: () => void;
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

  useEffect(() => {
    let active = true;
    void Promise.all([
      api(`/conversations/${chat.id}/memory`),
      api(`/conversations/${chat.id}/state`),
      api(`/conversations/${chat.id}/proposals`),
    ])
      .then(([m, s, p]) => {
        if (active) {
          setMemory(m);
          setState(s);
          setStateText(JSON.stringify(s.tables, null, 2));
          setProposals(p);
        }
      })
      .catch((error: Error) => {
        if (active) onError(error.message);
      });
    return () => {
      active = false;
    };
  }, [chat.id, version]);

  async function run(path: string, value: unknown = {}) {
    setBusy(true);
    try {
      await api(path, 'POST', value);
      onChanged();
    } catch (error) {
      onError((error as Error).message);
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
            <button style={{ width: '100%', marginBottom: 12 }} disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/memory/generate`)}>
              {busy ? '更新中…' : '立即生成 Memory'}
            </button>
            {[...memory].reverse().map((entry) => (
              <article className="memory-entry" key={entry.id}>
                <div className="memory-stage">Stage {entry.stage}</div>
                <pre>{entry.content || '（空记忆标记）'}</pre>
              </article>
            ))}
            <details>
              <summary>手动添加记录</summary>
              <textarea aria-label="手动记忆" rows={4} value={newMemory} onChange={(e) => setNewMemory(e.target.value)} />
              <button disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/memory`, { content: newMemory }).then(() => setNewMemory(''))}>
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
            <h3 className="planner-status">{chat.plannerEnabled ? 'Planner → Writer' : 'Writer 自动路由'}</h3>
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
              <div className="nav-label" style={{ paddingLeft: 0 }}>本轮活动</div>
              {activity.map((event, index) => (
                <details className="activity" key={event.id ?? index} open={index >= activity.length - 3}>
                  <summary>{event.type}</summary>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </details>
              ))}
              {!activity.length && <p className="muted">本轮尚未产生规划或工具事件。</p>}
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
