import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, Square } from 'lucide-react';
import type { ActionChoiceCache } from '@new-ai-chat/contracts';
import { api } from './api.js';
import { flushContentEdits } from './useContentAutosave.js';
import './action-choices.css';

type Edit = { groupId: string; index: number; value: string; previous: string };
export default function ActionChoices({ chatId, head, disabled, onSend, onBusy, onChanged }: {
  chatId: string; head: string | null; disabled: boolean; onSend: (text: string) => Promise<void>;
  onBusy: (busy: boolean) => void; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false), [cache, setCache] = useState<ActionChoiceCache>({ groups: [], selectedGroupId: null });
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const key = `action-choice-draft:${chatId}:${head ?? ''}`;
  const [edit, setEdit] = useState<Edit | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') as Edit | null; } catch { return null; }
  });
  const editRef = useRef(edit); editRef.current = edit;
  const savingRef = useRef<Promise<boolean> | null>(null), controller = useRef<AbortController | null>(null);
  const loaded = useRef(false), attempted = useRef(false), acting = useRef(false), mounted = useRef(true);
  const callbacks = useRef({ onBusy, onChanged }); callbacks.current = { onBusy, onChanged };
  const endpoint = `/conversations/${chatId}/action-choices`;
  const selectedIndex = Math.max(0, cache.groups.findIndex(group => group.id === cache.selectedGroupId));
  const group = cache.groups[selectedIndex];
  function updateEdit(next: Edit | null) {
    editRef.current = next; setEdit(next);
    try { if (next) sessionStorage.setItem(key, JSON.stringify(next)); else sessionStorage.removeItem(key); } catch { /* Keep live input if storage is unavailable. */ }
  }
  function flushEdit(): Promise<boolean> {
    if (savingRef.current) return savingRef.current;
    const draft = editRef.current;
    if (!draft) return Promise.resolve(true);
    if (draft.value === draft.previous) { updateEdit(null); return Promise.resolve(true); }
    setSaving(true); setError('');
    const pending = (async () => {
      try {
        const next = await api<ActionChoiceCache>(endpoint, 'PATCH', { head, groupId: draft.groupId, index: draft.index, previous: draft.previous, text: draft.value }, { keepalive: true });
        if (mounted.current) setCache(next);
        updateEdit(null); return true;
      } catch (cause) {
        if (mounted.current) setError(`${(cause as Error).message} 草稿已保留，离开编辑框可重试。`);
        return false;
      } finally { savingRef.current = null; if (mounted.current) setSaving(false); }
    })();
    savingRef.current = pending;
    return pending;
  }
  const flushRef = useRef(flushEdit); flushRef.current = flushEdit;
  useEffect(() => {
    mounted.current = true;
    const flush = () => { void flushRef.current(); };
    window.addEventListener('pagehide', flush);
    return () => { mounted.current = false; controller.current?.abort(); callbacks.current.onBusy(false); window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  useEffect(() => { if (disabled) { controller.current?.abort(); setOpen(false); } }, [disabled]);

  async function generate() {
    await flushContentEdits();
    if (!mounted.current) return;
    attempted.current = true;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); callbacks.current.onBusy(true); callbacks.current.onChanged(); setError('');
    try {
      const next = await api<ActionChoiceCache>(endpoint, 'POST', { head }, { signal: abort.signal });
      if (mounted.current && !abort.signal.aborted) setCache(next);
    } catch (cause) {
      if (mounted.current) setError(abort.signal.aborted ? '生成已取消，已有选项保留。' : (cause as Error).message);
    } finally {
      if (controller.current === abort) controller.current = null;
      if (mounted.current) { setBusy(false); callbacks.current.onBusy(false); callbacks.current.onChanged(); }
    }
  }
  async function action(work: () => Promise<void>) {
    if (acting.current || busy || disabled) return;
    acting.current = true;
    try { if (await flushEdit()) await work(); }
    catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { acting.current = false; }
  }
  async function toggle() {
    if (open) { if (await flushEdit()) setOpen(false); return; }
    setOpen(true);
    if (loaded.current || acting.current || disabled) return;
    acting.current = true; setError('');
    try {
      const next = await api<ActionChoiceCache>(`${endpoint}?head=${encodeURIComponent(head ?? '')}`);
      if (!mounted.current) return;
      loaded.current = true; setCache(next);
      if (!next.groups.length && !attempted.current) await generate();
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { acting.current = false; }
  }
  async function navigate(direction: number) {
    await action(async () => {
      const next = cache.groups[selectedIndex + direction];
      if (!next && direction > 0) return generate();
      if (next) setCache(await api<ActionChoiceCache>(`${endpoint}/selection`, 'PUT', { head, groupId: next.id }));
    });
  }
  return <section className="action-choices" aria-label="行动选项">
    <div className="action-choice-toolbar">
      <button type="button" disabled={disabled} aria-expanded={open} onClick={() => void toggle()}>行动选项 {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
      {open && <div className="action-choice-navigation">
        <button type="button" aria-label="上一组选项" disabled={disabled || busy || selectedIndex === 0} onClick={() => void navigate(-1)}><ChevronLeft size={16} /></button>
        <small>{cache.groups.length ? `${selectedIndex + 1} / ${cache.groups.length}` : '尚无选项'}</small>
        <button type="button" aria-label={selectedIndex < cache.groups.length - 1 ? '下一组选项' : '生成新一组选项'} disabled={disabled || busy} onClick={() => void navigate(1)}><ChevronRight size={16} /></button>
        {busy && <button type="button" aria-label="停止生成行动选项" onClick={() => controller.current?.abort()}><Square size={13} /></button>}
      </div>}
    </div>
    {open && <>
      {busy && <small role="status">正在生成行动选项…</small>}
      {saving && <small role="status">保存中…</small>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="action-choice-grid">
        {group?.choices.map((text, index) => <div className="action-choice-bubble" key={`${group.id}:${index}`}>
          {edit?.groupId === group.id && edit.index === index
            ? <textarea autoFocus aria-label={`编辑选项 ${index + 1}`} maxLength={4000} rows={3} value={edit.value} readOnly={saving || disabled}
                onChange={event => updateEdit({ ...edit, value: event.target.value })} onBlur={() => void flushEdit()} />
            : <><button type="button" className="action-choice-text" disabled={disabled || busy} onClick={() => void action(() => onSend(text))}>{text}</button>
                <button type="button" className="action-choice-edit" aria-label={`编辑选项 ${index + 1}`} disabled={disabled || busy} onClick={() => void action(async () => updateEdit({ groupId: group.id, index, value: text, previous: text }))}><Pencil size={13} /></button></>}
        </div>)}
      </div>
    </>}
  </section>;
}
