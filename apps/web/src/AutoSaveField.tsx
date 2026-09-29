import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function AutoSaveField({ draftKey, initial, label, disabled, placeholder = '—', onSave, onError }: {
  draftKey: string; initial: string; label: string; disabled: boolean; placeholder?: string;
  onSave: (value: string, previous: string) => Promise<void>; onError: (message: string) => void;
}) {
  const storageKey = `record-draft:${draftKey}`;
  const [draft, setDraft] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (typeof saved?.value === 'string' && typeof saved?.previous === 'string' && saved.value !== initial) return saved as { value: string; previous: string };
    } catch { /* Editing still works if draft storage is unavailable. */ }
    return { value: initial, previous: initial };
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const current = useRef(draft), pending = useRef(false);
  current.current = draft;
  useEffect(() => {
    if (pending.current || (current.current.value !== current.current.previous && current.current.value !== initial)) return;
    setDraft({ value: initial, previous: initial });
  }, [initial]);
  useLayoutEffect(() => {
    const element = field.current!;
    const resize = () => { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (width !== element.clientWidth) { width = element.clientWidth; resize(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft.value]);
  async function save() {
    const sent = current.current;
    if (disabled || pending.current || sent.value === sent.previous) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await onSave(sent.value, sent.previous);
      const next = { value: current.current.value, previous: sent.value };
      current.current = next; setDraft(next);
      try { sessionStorage.removeItem(storageKey); } catch { /* Optional draft storage. */ }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '保存失败';
      setError(`${message} 输入已保留，离开输入框时会重试。`); onError(message);
    } finally { pending.current = false; setBusy(false); }
  }
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const flush = () => { void saveRef.current(); };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  return <div className="record-field">
    <textarea ref={field} aria-label={label} placeholder={placeholder} rows={1} value={draft.value} readOnly={disabled || busy}
      onChange={event => {
        const next = { value: event.target.value, previous: current.current.previous };
        current.current = next; setDraft(next);
        try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the live draft. */ }
      }} onBlur={() => void save()} />
    {busy && <small role="status">保存中…</small>}
    {error && <small className="error" role="alert">{error}</small>}
  </div>;
}
