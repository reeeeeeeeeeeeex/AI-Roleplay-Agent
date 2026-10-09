import { t } from './i18n.js';
import { useEffect, useRef, useState } from 'react';

const editors = new Set<() => Promise<boolean>>();
export function registerContentEditor(flush: () => Promise<boolean>): () => void {
  editors.add(flush);
  return () => { editors.delete(flush); };
}
export async function flushContentEdits() {
  for (const flush of [...editors]) if (!await flush()) throw new Error(t("内容尚未保存，请先处理编辑区的提示。草稿已保留。"));
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function useContentAutosave<T>({ initial, draftKey, onSave, onError, enabled = true, resetOnSave = false }: {
  initial: T; draftKey: string; onSave: (value: T, previous: T) => Promise<void | { saved: T }>; onError?: ((message: string) => void) | undefined; enabled?: boolean; resetOnSave?: boolean;
}) {
  const storageKey = `content-draft:${draftKey}`;
  const [draft, setDraft] = useState<{ value: T; previous: T }>(() => {
    if (enabled) try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? sessionStorage.getItem(`record-draft:${draftKey}`) ?? 'null');
      if (saved && 'value' in saved && 'previous' in saved) return saved;
    } catch { /* Keep editing when browser draft storage is unavailable. */ }
    return { value: initial, previous: initial };
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const current = useRef(draft), pending = useRef<Promise<boolean> | null>(null), requested = useRef(false), forceRequested = useRef(false);
  const mounted = useRef(true), external = useRef(initial);
  const options = useRef({ onSave, onError, enabled, resetOnSave, initial }); options.current = { onSave, onError, enabled, resetOnSave, initial };
  function remember(next: typeof draft) {
    if (options.current.enabled) try {
      if (equal(next.value, next.previous)) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify(next));
      sessionStorage.removeItem(`record-draft:${draftKey}`);
    } catch { /* The live draft remains editable. */ }
  }
  function update(next: typeof draft) { current.current = next; remember(next); if (mounted.current) setDraft(next); }
  function change(value: T | ((previous: T) => T)) {
    update({ ...current.current, value: typeof value === 'function' ? (value as (previous: T) => T)(current.current.value) : value });
  }
  function flush(force = false): Promise<boolean> {
    forceRequested.current ||= force;
    if (!force && equal(current.current.value, current.current.previous)) return pending.current ?? Promise.resolve(true);
    if (!options.current.enabled) return Promise.resolve(false);
    requested.current = true;
    if (pending.current) return pending.current;
    // Start on a microtask so blur handlers and checkbox/keyword changes settle together.
    const work = Promise.resolve().then(async () => {
      try {
        while (requested.current) {
          requested.current = false;
          const sent = current.current;
          const forced = forceRequested.current; forceRequested.current = false;
          if (!forced && equal(sent.value, sent.previous)) continue;
          if (mounted.current) { setStatus('saving'); setError(''); }
          const response = await options.current.onSave(sent.value, sent.previous);
          const saved = response?.saved ?? sent.value;
          const reset = options.current.resetOnSave && equal(current.current.value, sent.value);
          let next = current.current.value;
          if (equal(next, sent.value)) next = saved;
          else if (next && saved && typeof next === 'object' && typeof saved === 'object' && !Array.isArray(next)) {
            // Carry assigned IDs/version stamps forward without replacing newer typing.
            next = { ...next };
            for (const key of Object.keys(saved)) if (equal((next as any)[key], (sent.value as any)[key])) (next as any)[key] = (saved as any)[key];
          }
          update({ value: reset ? options.current.initial : next, previous: reset ? options.current.initial : saved });
        }
        if (mounted.current) setStatus('saved');
        return true;
      } catch (cause) {
        const message = t("{0} 草稿已保留，离开编辑区时会重试。", cause instanceof Error ? cause.message : t("保存失败"));
        if (mounted.current) { setStatus('error'); setError(message); }
        options.current.onError?.(message);
        return false;
      } finally { pending.current = null; }
    });
    pending.current = work;
    return work;
  }
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    if (!equal(initial, external.current) && !pending.current && equal(current.current.value, current.current.previous)) update({ value: initial, previous: initial });
    external.current = initial;
  }, [initial]);
  useEffect(() => {
    mounted.current = true;
    const save = () => flushRef.current();
    const leave = () => { void save(); };
    const unregister = enabled ? registerContentEditor(save) : undefined;
    if (enabled) window.addEventListener('pagehide', leave);
    return () => { mounted.current = false; unregister?.(); window.removeEventListener('pagehide', leave); if (enabled) leave(); };
  }, [enabled]);
  function discard() {
    if (pending.current) return;
    requested.current = false; forceRequested.current = false;
    update({ value: options.current.initial, previous: options.current.initial });
    setStatus('idle'); setError('');
  }
  return { value: draft.value, change, flush, discard, status, error, dirty: !equal(draft.value, draft.previous) };
}
