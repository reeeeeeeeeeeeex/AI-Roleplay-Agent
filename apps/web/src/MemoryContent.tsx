import { useLayoutEffect, useRef } from 'react';
import { t } from './i18n.js';
import { useContentAutosave } from './useContentAutosave.js';

const labels = { timeSpan: '时间跨度', location: '地点', chronicle: '纪要', dialogue: '重要对话', overview: '概览' } as const;
type MemoryContent = { timeSpan: string; location: string; chronicle: string; dialogue: string[]; overview: string };

function parseMemory(content: string): MemoryContent | null {
  try {
    const value = JSON.parse(content);
    // Leave free text and unfamiliar records intact instead of hiding unknown fields.
    if (!value || Array.isArray(value) || Object.keys(value).length !== Object.keys(labels).length) return null;
    if (!Object.keys(labels).every(key => key === 'dialogue'
      ? Array.isArray(value[key]) && value[key].every((item: unknown) => typeof item === 'string')
      : typeof value[key] === 'string')) return null;
    return value;
  } catch { return null; }
}

export function memoryPreview(content: string): string {
  const memory = parseMemory(content);
  return (memory ? memory.overview || memory.chronicle : content).trim().slice(0, 60);
}

export default function MemoryContent({ draftKey, initial, label, disabled, onSave, onError }: {
  draftKey: string; initial: string; label: string; disabled: boolean;
  onSave: (content: string, previous: string) => Promise<string>;
  onError: (message: string) => void;
}) {
  // Keep the existing raw-string draft and compare the whole record when saving.
  const edit = useContentAutosave({ initial, draftKey, onError, onSave: async (value, previous) => {
    if (disabled) throw new Error(t('生成进行中，请结束后重试保存。'));
    return { saved: await onSave(value, previous) };
  } });
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = container.current!;
    const resize = () => element.querySelectorAll('textarea').forEach(field => {
      if (!field.clientWidth) return;
      field.style.height = '0px'; field.style.height = `${field.scrollHeight}px`;
    });
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) { width = element.clientWidth; resize(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [edit.value]);
  const memory = parseMemory(edit.value);
  return <div ref={container} className="record-field" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void edit.flush();
  }}>
    {memory ? <dl className="memory-fields">{(Object.keys(labels) as (keyof MemoryContent)[]).map(key => <div key={key}>
      <dt>{t(labels[key])}</dt>
      <dd>{(key === 'dialogue' ? (memory.dialogue.length ? memory.dialogue : ['']) : [memory[key]]).map((value, index) =>
        <textarea key={index} aria-label={`${label} ${t(labels[key])}${key === 'dialogue' ? ` ${index + 1}` : ''}`} placeholder="—" rows={1} readOnly={disabled} value={value}
          onChange={event => {
            const next = event.target.value;
            if (key === 'dialogue') {
              const dialogue = [...memory.dialogue]; dialogue[index] = next;
              edit.change(JSON.stringify({ ...memory, dialogue }, null, 2));
            } else edit.change(JSON.stringify({ ...memory, [key]: next }, null, 2));
          }} />
      )}</dd>
    </div>)}</dl> : <textarea aria-label={label} placeholder={t('（空记忆标记）')} rows={1} readOnly={disabled} value={edit.value} onChange={event => edit.change(event.target.value)} />}
    {edit.status === 'saving' && <small role="status">{t('保存中…')}</small>}
    {edit.error && <small className="error" role="alert">{edit.error}</small>}
  </div>;
}
