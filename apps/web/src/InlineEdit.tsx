import { useLayoutEffect, useRef, useState } from 'react';
import './inline-edit.css';

export default function InlineEdit({ initial, label, onSave, onCancel, disabled = false, singleLine = false, saveLabel = '保存' }: {
  initial: string; label: string; onSave: (text: string) => Promise<void>; onCancel: () => void;
  disabled?: boolean; singleLine?: boolean; saveLabel?: string;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (element) { element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`; }
  }, [value]);
  useLayoutEffect(() => {
    const element = field.current!;
    element.focus({ preventScroll: true });
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      element.style.height = '0px'; element.style.height = `${element.scrollHeight}px`;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  async function save() {
    if (disabled || pending.current || !value.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try { await onSave(value); }
    catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className={`inline-edit${singleLine ? ' inline-edit-short' : ''}`}>
    <textarea ref={field} aria-label={label} rows={1} value={value} disabled={disabled || busy}
      onChange={event => setValue(singleLine ? event.target.value.replace(/[\r\n]+/g, ' ') : event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); onCancel(); }
        if (event.key === 'Enter' && (singleLine || event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
      }} />
    <div className="inline-edit-actions">
      <button type="button" disabled={disabled || busy || !value.trim()} onClick={() => void save()}>{busy ? '保存中…' : saveLabel}</button>
      <button type="button" disabled={busy} onClick={onCancel}>取消</button>
      <small>{singleLine ? 'Enter 保存' : 'Ctrl / ⌘ + Enter 保存'} · Esc 取消</small>
    </div>
    {error && <small className="error" role="alert">{error}</small>}
  </div>;
}
