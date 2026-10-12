import { t } from './i18n.js';
import { useRef } from 'react';
import { useContentAutosave } from './useContentAutosave.js';
import { useAutoSizeTextareas } from './useAutoSizeTextareas.js';
import SearchHighlights from './SearchHighlights.js';

export default function AutoSaveField({ draftKey, initial, label, disabled, placeholder = '—', onSave, onError, resetOnSave = false, singleLine = false, autoFocus = false, lockWhileSaving = false, layoutKey, highlight = '' }: {
  draftKey: string; initial: string; label: string; disabled: boolean; placeholder?: string; resetOnSave?: boolean; singleLine?: boolean; autoFocus?: boolean; lockWhileSaving?: boolean;
  onSave: (value: string, previous: string) => Promise<unknown>; onError?: (message: string) => void;
  layoutKey?: string;
  highlight?: string;
}) {
  const { value, change, flush, status, error } = useContentAutosave({ initial, draftKey, resetOnSave, onError, onSave: async (value, previous) => {
    if (disabled) throw new Error(t("生成进行中，请结束后重试保存。"));
    const saved = await onSave(value, previous);
    return { saved: typeof saved === 'string' ? saved : value };
  } });
  const field = useRef<HTMLTextAreaElement>(null);
  useAutoSizeTextareas(field, value, layoutKey);
  return <div className="record-field">
    <textarea ref={field} aria-label={label} placeholder={placeholder} rows={1} value={value} readOnly={disabled || (lockWhileSaving && status === 'saving')} autoFocus={autoFocus}
      onChange={event => change(singleLine ? event.target.value.replace(/[\r\n]+/g, ' ') : event.target.value)}
      onKeyDown={event => { if (singleLine && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} onBlur={() => void flush()} />
    {highlight && <SearchHighlights text={value} query={highlight} />}
    {status === 'saving' && <small role="status">{t("保存中…")}</small>}
    {error && <small className="error" role="alert">{error}</small>}
  </div>;
}
