import { stateLabel } from './state-labels.js';
import { t } from './i18n.js';
import { proposalLabel } from './ui-labels.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { type Conversation, type GenerationMode, type PinnedFact, type StateTableName } from '@new-ai-chat/contracts';
import StateCollectionRow from './StateCollectionRow.js';
import { api } from './api.js';
import RecordHistory from './RecordHistory.js';
import AgentTrace from './AgentTrace.js';
import AutoSaveField from './AutoSaveField.js';
import MemoryContent, { memoryPreview } from './MemoryContent.js';
import { flushContentEdits } from './useContentAutosave.js';
import { useBackdropClose } from './useBackdropClose.js';

const tableNames: Record<string, string> = {
  get global_state() { return t("全局状态"); },
  get protagonist_info() { return t("主角信息"); },
  get important_characters() { return t("重要角色"); },
  get protagonist_skills() { return t("主角技能"); },
  get inventory() { return t("背包物品"); },
  get quests_events() { return t("任务与事件"); },
};
export default function Records({
  chat,
  visible,
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
  visible: boolean;
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
  const [expanded, setExpanded] = useState(false);
  const backdrop = useBackdropClose(() => setExpanded(false));
  const [memorySection, setMemorySection] = useState<string | null>(null);
  const [stateSection, setStateSection] = useState('global_state');
  const [memory, setMemory] = useState<any[]>([]);
  const [state, setState] = useState<any>({ tables: {} });
  const [proposals, setProposals] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [facts, setFacts] = useState<PinnedFact[]>([]);
  const [loadedHead, setLoadedHead] = useState<string | null>();
  const [loading, setLoading] = useState(true);
  const content = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  const ready = loadedHead === chat.headMessageId;
  const selectedMemory = memorySection === 'facts' || memorySection === 'new' || memory.some(entry => entry.id === memorySection)
    ? memorySection : memory.at(-1)?.id ?? 'facts';

  useEffect(() => { setExpanded(false); }, [chat.id]);
  useLayoutEffect(() => {
    if (visible && ready && content.current) content.current.scrollTop = scrollTop.current;
  }, [visible, ready]);
  useEffect(() => {
    if (!visible || !expanded) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [visible, expanded]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
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
          setLoadedHead(chat.headMessageId);
        }
      })
      .catch((error: Error) => {
        if (active) onError(error.message);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, [chat.id, chat.headMessageId, version, visible]);

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

  async function selectTab(next: string) {
    try { await flushContentEdits(); setTab(next); }
    catch (error) { onError((error as Error).message); }
  }

  return (
    <div className={expanded ? 'records-shade' : 'records-host'} hidden={!visible} {...backdrop}>
    <aside className={`records${expanded ? ' records-expanded' : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? t("故事记录窗口") : undefined}>
      <header>
        <h2>{t("故事记录")}</h2>
        <div className="records-header-actions">
        <button aria-label={expanded ? t("收起记录窗口") : t("展开记录窗口")} title={expanded ? t("收起记录窗口（Esc）") : t("展开记录窗口")} onClick={() => setExpanded(!expanded)}>
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button aria-label={expanded ? t("关闭记录窗口") : t("关闭记录面板")} onClick={() => expanded ? setExpanded(false) : onClose()}>
          <X size={16} />
        </button>
        </div>
      </header>

      <nav aria-label={t("故事记录标签页")}>
        {[
          ['memory', 'Memory'],
          ['state', t("主角状态")],
          ['planner', 'Agent'],
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => void selectTab(id!)}>
            {label}
          </button>
        ))}
      </nav>

      <div className={`records-layout${tab === 'planner' ? ' records-agent-layout' : ''}`}>
        {expanded && ready && tab === 'memory' && <nav className="records-section-nav" aria-label={t("Memory 记录导航")}>
          <button className={selectedMemory === 'facts' ? 'selected' : ''} onClick={() => setMemorySection('facts')}><strong>{t("固定事实")}</strong><small>{t("仅由你维护 ·")} {facts.length}  {t("条")}</small></button>
          {[...memory].reverse().map(entry => <button key={entry.id} className={selectedMemory === entry.id ? 'selected' : ''} onClick={() => setMemorySection(entry.id)}>
            <strong>{t("阶段 {0}", entry.stage)}</strong><small>{memoryPreview(entry.content ?? '') || t("空记忆标记")}</small>
          </button>)}
          {!memory.length && <p className="muted">{t("尚无 Memory 记录。")}</p>}
          <button className={selectedMemory === 'new' ? 'selected' : ''} onClick={() => setMemorySection('new')}>{t("手动添加记录")}</button>
        </nav>}
        {expanded && ready && tab === 'state' && <nav className="records-section-nav" aria-label={t("主角状态表导航")}>
          {Object.entries(state.tables ?? {}).map(([table, rows]) => <button key={table} className={stateSection === table ? 'selected' : ''} onClick={() => setStateSection(table)}>
            <strong>{tableNames[table] ?? table}</strong><small>{(rows as any[]).length}  {t("条记录")}</small>
          </button>)}
        </nav>}
      <div ref={content} onScroll={event => { if (visible && ready) scrollTop.current = event.currentTarget.scrollTop; }} className={`records-content${tab === 'planner' ? ' records-agent-content' : ''}`}>
        {!ready && loading && <p className="muted" role="status">{t("正在读取记录…")}</p>}
        {ready && tab === 'memory' && (
          <>
            <details open hidden={expanded && selectedMemory !== 'facts'}>
              <summary>{t("固定事实 · 仅由你修改")}</summary>
              {facts.map(fact => <article className="memory-entry" key={fact.id}>
                <AutoSaveField key={`${fact.id}:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:fact:${fact.id}`} initial={fact.content} label={t("固定事实内容")} disabled={disabled || busy} onError={onError}
                  onSave={async (content, previous) => {
                    const saved = await api(`/conversations/${chat.id}/facts`, 'POST', { id: fact.id, content, previous, head: chat.headMessageId }, { keepalive: true });
                    setFacts(items => items.map(item => item.id === fact.id ? saved : item)); onChanged(); return saved.content;
                  }} />
                {fact.sourceMessageId && <button onClick={() => onSource(fact.sourceMessageId!)}>{t("查看来源")}</button>}
                  <button disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/facts/${fact.id}`, {}, 'DELETE')}>{t("取消固定")}</button>
              </article>)}
              <AutoSaveField key={`new-fact:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:new-fact`} initial="" label={t("添加固定事实")} placeholder={t("填写固定事实，离开自动保存")} disabled={disabled || busy} resetOnSave lockWhileSaving onError={onError}
                onSave={async content => { await api(`/conversations/${chat.id}/facts`, 'POST', { content, head: chat.headMessageId }, { keepalive: true }); onChanged(); }} />
            </details>
            <button style={{ width: '100%', marginBottom: 12 }} disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/memory/generate`)}>
              {busy ? t("更新中…") : t("立即生成 Memory")}
            </button>
            {[...memory].reverse().map((entry) => (
              <article className="memory-entry" key={entry.id} hidden={expanded && selectedMemory !== entry.id}>
                <div className="memory-stage">{t("阶段 {0}", entry.stage)}</div>
                <small className="muted">{entry.coverage ? t("覆盖 {0} 个完整回合", entry.coverage.storyTurnIds.length) : t("覆盖范围：历史记录未提供")}</small>
                {entry.coverage && <div><button onClick={() => onSource(entry.coverage.startMessageId)}>{t("起点")}</button><button onClick={() => onSource(entry.coverage.endMessageId)}>{t("终点")}</button></div>}
                <MemoryContent key={`${entry.id}:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:memory:${entry.id}`} initial={entry.content ?? ''} label={t("阶段 {0}", entry.stage)} disabled={disabled || busy} onError={onError}
                  onSave={async (content, previous) => {
                    const saved = await api(`/conversations/${chat.id}/memory/${entry.id}`, 'PATCH', { content, previous, head: chat.headMessageId }, { keepalive: true });
                    setMemory(items => items.map(item => item.id === entry.id ? saved : item)); onChanged(); return saved.content;
                  }} />
              </article>
            ))}
            <details open={expanded || undefined} hidden={expanded && selectedMemory !== 'new'}>
              <summary>{t("手动添加记录")}</summary>
              <AutoSaveField key={`new-memory:${chat.headMessageId}`} draftKey={`${chat.id}:${chat.headMessageId}:new-memory`} initial="" label={t("手动记忆")} placeholder={t("填写记忆，离开自动保存")} disabled={disabled || busy} resetOnSave lockWhileSaving onError={onError}
                onSave={async content => { await api(`/conversations/${chat.id}/memory`, 'POST', { content, head: chat.headMessageId }, { keepalive: true }); onChanged(); }} />
            </details>

          </>
        )}

        {ready && tab === 'state' && (
          <>
            <button style={{ width: '100%', marginBottom: 12 }} disabled={disabled || busy} onClick={() => void run(`/conversations/${chat.id}/state/generate`)}>{t("AI 更新")}</button>
            {Object.entries(state.tables ?? {}).map(([table, rows]) => (
                <details className="state-table" key={table} hidden={expanded && stateSection !== table} open={expanded || table === 'global_state' || table === 'protagonist_info'}>
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
                            <dt>{stateLabel(key)}</dt>
                            <dd><AutoSaveField key={`${chat.headMessageId}:${table}:${row.row_id}:${key}`} draftKey={`${chat.id}:${chat.headMessageId}:state:${table}:${row.row_id}:${key}`} initial={String(value ?? '')} label={`${tableNames[table]} ${row.row_id} ${stateLabel(key)}`} disabled={disabled || busy} onError={onError}
                              onSave={async (content, previous) => {
                                const saved = await api(`/conversations/${chat.id}/state/cell`, 'PATCH', { table, rowId: row.row_id, column: key, content, previous, head: chat.headMessageId }, { keepalive: true });
                                setState(saved); onChanged();
                              }} /></dd>
                          </div>
                        ))}
                    </dl>
                  ))}
                  {!(rows as any[]).length && <p className="muted" style={{ padding: '6px 0' }}>{t("暂无记录")}</p>}
                </details>
              ))}
          </>
        )}

        <div className="records-agent-view" hidden={tab !== 'planner'}>
          <AgentTrace key={chat.id} chatId={chat.id} version={version} activeTurnId={activeTurnId} expanded={expanded} visible={visible && tab === 'planner'} onError={onError}>
            <h3 className="planner-status">{generationMode === 'plain' ? t("普通写作") : generationMode === 'planner' ? 'Planner → Writer' : t("统一 Writer Agent")}</h3>
            {ready && proposals.map((p) => (
              <article className="proposal" key={p.id}>
                <small className="muted">{p.kind === 'state' ? t("状态提案") : t("世界事件")} · {proposalLabel(p.status)}</small>
                <pre>{JSON.stringify(p.payload, null, 2)}</pre>
                <div>
                  {(p.status === 'pending' ? ['apply', 'reject'] : p.status === 'applied' ? ['undo'] : []).map((action) => (
                    <button disabled={disabled || busy} key={action} onClick={() => void run(`/proposals/${p.id}/${action}`)}>
                      {{ apply: t("应用"), reject: t("拒绝"), undo: t("撤销") }[action]}
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {activity.length > 0 && <details className="activity"><summary>{t("当前回合事件 · 最近 80 条")}</summary><pre>{JSON.stringify(activity, null, 2)}</pre></details>}
            {ready && tab === 'planner' && <RecordHistory key={chat.headMessageId} chatId={chat.id} tab={tab} version={version} disabled={disabled || busy} onChanged={onChanged} onError={onError} />}
          </AgentTrace>
        </div>

        {ready && tab !== 'planner' && <RecordHistory
          key={chat.headMessageId}
          chatId={chat.id}
          tab={tab}
          version={version}
          disabled={disabled || busy}
          onChanged={onChanged}
          onError={onError}
        />}
      </div>
      </div>
    </aside>
    </div>
  );
}
