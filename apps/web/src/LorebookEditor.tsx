import { useEffect, useId, useRef, useState } from 'react';
import type { Lorebook, LoreEntry } from '@new-ai-chat/contracts';
import { ChevronDown, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import './lorebook-editor.css';

type Entry = Omit<LoreEntry, 'id' | 'lorebookId'>;
type DraftEntry = Entry & { localId: string; keyInput: string; secondaryInput: string; orderInput: string };

const emptyEntry: Entry = { title: '', keys: [], secondaryKeys: [], content: '', enabled: true, constant: false, order: 100, position: 'depth', depth: 0, legacyPayload: null };
const draftEntry = (entry: Entry): DraftEntry => ({ ...entry, localId: crypto.randomUUID(), keyInput: '', secondaryInput: '', orderInput: String(entry.order) });
const withKeyword = (keys: string[], input: string) => input.trim() && !keys.includes(input.trim()) ? [...keys, input.trim()] : keys;
const entryTitle = (entry: Entry) => entry.title.trim() || entry.keys.find(key => key.trim()) || entry.content.trim().split('\n')[0]?.slice(0, 80) || '未命名条目';
function entryValue(entry: DraftEntry): Entry {
  // Explicitly omit both database IDs and editor-only state from the whole-book API.
  return { title: entry.title, keys: withKeyword(entry.keys, entry.keyInput), secondaryKeys: withKeyword(entry.secondaryKeys, entry.secondaryInput),
    content: entry.content, enabled: entry.enabled, constant: entry.constant, order: Number(entry.orderInput),
    position: entry.position, depth: entry.depth, legacyPayload: entry.legacyPayload };
}

function Keywords({ label, values, input, onInput, onChange }: {
  label: string; values: string[]; input: string; onInput: (value: string) => void; onChange: (values: string[]) => void;
}) {
  const id = useId();
  function commit() { onChange(withKeyword(values, input)); onInput(''); }
  return <div className="lore-keywords">
    <label htmlFor={id}>{label}</label>
    <div className="lore-tags">
      {values.map((key, index) => <span className="lore-tag" key={index}>{key}
        <button type="button" aria-label={`移除${label} ${key}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>×</button>
      </span>)}
    </div>
    <input id={id} value={input} placeholder="输入后按回车添加" onChange={event => onInput(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commit(); } }} />
  </div>;
}

export default function LorebookEditor({ initial, onSave, onClose, zIndex }: {
  initial?: Partial<Lorebook>; onSave: (value: Omit<Partial<Lorebook>, 'entries'> & { entries: Entry[] }) => Promise<void>; onClose: () => void; zIndex: number;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [entries, setEntries] = useState(() => (initial?.entries ?? []).map(entry => draftEntry({ ...emptyEntry, ...entry })));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const baseline = useRef(JSON.stringify({ name, description, entries: entries.map(entryValue) }));
  const dirty = JSON.stringify({ name, description, entries: entries.map(entryValue) }) !== baseline.current;
  const titleInputs = useRef(new Map<string, HTMLInputElement>());
  const formId = useId();

  useEffect(() => {
    if (!focusId) return;
    const input = titleInputs.current.get(focusId);
    input?.scrollIntoView({ block: 'center' });
    input?.focus({ preventScroll: true });
    setFocusId(null);
  }, [focusId]);

  function update(localId: string, patch: Partial<DraftEntry>) {
    setEntries(old => old.map(entry => entry.localId === localId ? { ...entry, ...patch } : entry));
  }
  function add(source?: DraftEntry) {
    const order = entries.length ? Math.max(...entries.map(entry => Number(entry.orderInput) || 0)) + 1 : 100;
    const entry = draftEntry(source ? { ...entryValue(source), title: `${entryTitle(source)}（副本）`, order } : { ...emptyEntry, order });
    setEntries(old => [...old, entry]);
    setQuery('');
    setExpanded(old => new Set([...old, entry.localId]));
    setFocusId(entry.localId);
  }
  function toggle(localId: string) {
    setExpanded(old => { const next = new Set(old); if (next.has(localId)) next.delete(localId); else next.add(localId); return next; });
  }
  function close() { if (!busy) { if (dirty) setDiscarding(true); else onClose(); } }
  async function save() {
    if (busy) return;
    const invalid = entries.find(entry => !entry.orderInput.trim() || !Number.isSafeInteger(Number(entry.orderInput)));
    if (invalid) {
      setError(`「${entryTitle(invalid)}」的顺序必须是整数。`);
      setQuery('');
      setExpanded(old => new Set([...old, invalid.localId]));
      setFocusId(invalid.localId);
      return;
    }
    setBusy(true); setError(''); setDiscarding(false);
    try { await onSave({ ...initial, name: name.trim(), description, entries: entries.map(entryValue) }); }
    catch (err) { setError(err instanceof Error ? err.message : '保存失败，请重试。'); }
    finally { setBusy(false); }
  }
  const search = query.trim().toLocaleLowerCase();
  const visible = entries.filter(entry => [entry.title, entry.content, ...entry.keys, ...entry.secondaryKeys, entry.keyInput, entry.secondaryInput].some(value => value.toLocaleLowerCase().includes(search)));

  return <div className="modal-shade" style={{ zIndex }}>
    <section className="modal lorebook-modal" role="dialog" aria-modal="true" aria-label="编辑世界书">
      <header><h2>{initial?.id ? '编辑' : '创建'}世界书 <span className="muted">· {entries.length} 个条目</span></h2>
        <button type="button" onClick={close} disabled={busy} aria-label="关闭">✕</button>
      </header>
      <form id={formId} onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className="lorebook-fields">
          <div className="lorebook-meta">
            <label>名称<input value={name} required maxLength={200} onChange={event => setName(event.target.value)} /></label>
            <label>描述<textarea rows={2} maxLength={20_000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          </div>
          <div className="lore-toolbar">
            <button type="button" className="primary" onClick={() => add()}><Plus size={14} />新建条目</button>
            <input type="search" aria-label="搜索条目" placeholder="搜索标题、关键词或正文" value={query} onChange={event => setQuery(event.target.value)} />
            <button type="button" onClick={() => setExpanded(new Set(entries.map(entry => entry.localId)))}>全部展开</button>
            <button type="button" onClick={() => setExpanded(new Set())}>全部收起</button>
          </div>
          <div className="lore-entry-list">
            {visible.map(entry => {
              const open = expanded.has(entry.localId), title = entryTitle(entry), bodyId = `lore-${entry.localId}`;
              return <article className={`lore-entry${entry.enabled ? '' : ' lore-entry-disabled'}`} key={entry.localId} aria-label={title}>
                <div className="lore-entry-header">
                  <button className="lore-entry-toggle" type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(entry.localId)}>
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="lore-entry-heading"><strong>{title}</strong><span className="lore-entry-preview">{entry.content.trim() || '暂无正文'}</span></span>
                    <span className="lore-entry-mode">{entry.constant ? '始终加入' : '关键词触发'}</span>
                  </button>
                  <label className="check"><input type="checkbox" checked={entry.enabled} onChange={event => update(entry.localId, { enabled: event.target.checked })} />{entry.enabled ? '启用' : '停用'}</label>
                </div>
                <div id={bodyId} className="lore-entry-body" hidden={!open}>
                  <label>条目标题<input ref={input => { if (input) titleInputs.current.set(entry.localId, input); else titleInputs.current.delete(entry.localId); }} value={entry.title} onChange={event => update(entry.localId, { title: event.target.value })} /></label>
                  <label>正文<textarea rows={8} maxLength={200_000} value={entry.content} onChange={event => update(entry.localId, { content: event.target.value })} /></label>
                  <label>触发方式<select value={entry.constant ? 'constant' : 'keyword'} onChange={event => update(entry.localId, { constant: event.target.value === 'constant' })}>
                    <option value="keyword">关键词触发</option><option value="constant">始终加入</option>
                  </select></label>
                  {entry.constant && <small className="muted">启用时始终加入上下文，关键词会保留但不参与触发。</small>}
                  <div className="two-col">
                    <Keywords label="关键词" values={entry.keys} input={entry.keyInput} onInput={keyInput => update(entry.localId, { keyInput })} onChange={keys => update(entry.localId, { keys })} />
                    <Keywords label="辅助关键词" values={entry.secondaryKeys} input={entry.secondaryInput} onInput={secondaryInput => update(entry.localId, { secondaryInput })} onChange={secondaryKeys => update(entry.localId, { secondaryKeys })} />
                  </div>
                  <small className="muted">主关键词命中后，还需命中任一辅助关键词；辅助关键词留空则不作额外限制。</small>
                  {!entry.constant && !entry.keys.length && !entry.keyInput.trim() && <small className="muted">添加关键词后才能触发此条目，也可以改为“始终加入”。</small>}
                  <details><summary>高级设置</summary><label>顺序<input inputMode="numeric" value={entry.orderInput} onChange={event => update(entry.localId, { orderInput: event.target.value })} /></label><small className="muted">数字越小越靠前；保存后按顺序显示。</small></details>
                  <div className="lore-entry-actions">
                    <button type="button" onClick={() => add(entry)}><Copy size={14} />复制条目</button>
                    <button type="button" className="danger" onClick={() => setDeleting(entry.localId)}><Trash2 size={14} />删除条目</button>
                    {deleting === entry.localId && <div className="lore-delete-confirm" role="group" aria-label="确认删除条目">
                      <span>删除「{title}」？保存世界书后生效。</span>
                      <button type="button" className="danger" onClick={() => { setEntries(old => old.filter(item => item.localId !== entry.localId)); setDeleting(null); }}>确认删除</button>
                      <button type="button" onClick={() => setDeleting(null)}>保留条目</button>
                    </div>}
                  </div>
                </div>
              </article>;
            })}
            {!visible.length && <p className="lore-empty muted">{entries.length ? '没有匹配的条目。' : '世界书还是空的，点击“新建条目”开始编写。'}</p>}
          </div>
        </fieldset>
      </form>
      <footer className="lorebook-footer">
        {error && <p className="error" role="alert">{error}</p>}
        {discarding ? <div className="lore-discard" role="group" aria-label="未保存的修改"><span>有尚未保存的修改。</span><button type="button" onClick={() => setDiscarding(false)}>继续编辑</button><button type="button" className="danger" onClick={onClose}>放弃修改</button></div>
          : <><span className="muted">{dirty ? '有未保存的修改' : '修改后点击保存'}</span><button type="button" onClick={onClose} disabled={busy}>取消</button><button type="submit" form={formId} className="primary" disabled={busy}>{busy ? '保存中…' : '保存'}</button></>}
      </footer>
    </section>
  </div>;
}
