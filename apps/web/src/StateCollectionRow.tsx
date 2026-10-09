import { stateLabel } from './state-labels.js';
import { t } from './i18n.js';
import { useLayoutEffect, useRef, useState } from 'react';
import { stateColumns } from '@new-ai-chat/contracts/client';
import type { StateRow, StateTableName } from '@new-ai-chat/contracts';
import { api } from './api.js';
import { useContentAutosave } from './useContentAutosave.js';

export default function StateCollectionRow({ chatId, head, table, row, disabled, onSaved, onError }: {
  chatId: string; head: string | null; table: StateTableName; row: StateRow; disabled: boolean;
  onSaved: (state: any) => void; onError: (message: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false), [deleting, setDeleting] = useState(false);
  const container = useRef<HTMLElement>(null);
  const edit = useContentAutosave({
    initial: row, draftKey: `${chatId}:${head}:state-row:${table}:${row.row_id}`, onError,
    onSave: async (value, previous) => {
      const cells = Object.fromEntries(stateColumns[table].map(column => [column, value[column] ?? '']));
      const saved = await api(`/conversations/${chatId}/state/row`, 'PATCH', { head, table, rowId: row.row_id, previous, cells }, { keepalive: true });
      onSaved(saved);
      return { saved: saved.tables[table].find((item: StateRow) => item.row_id === row.row_id) as StateRow };
    },
  });
  useLayoutEffect(() => {
    const element = container.current!;
    const resize = () => element.querySelectorAll('textarea').forEach(field => { field.style.height = '0px'; field.style.height = `${field.scrollHeight}px`; });
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (width !== element.clientWidth) { width = element.clientWidth; resize(); } });
    observer.observe(element);
    return () => observer.disconnect();
  }, [edit.value]);
  const locked = disabled || deleting || edit.status === 'saving';
  async function remove() {
    setDeleting(true);
    try {
      const saved = await api(`/conversations/${chatId}/state/row`, 'DELETE', { head, table, rowId: row.row_id, previous: row });
      edit.discard(); onSaved(saved);
    } catch (cause) { onError((cause as Error).message); setDeleting(false); }
  }
  return <article ref={container} className="state-row" data-table={table} onBlur={event => {
    if (!locked && !confirmDelete && !event.currentTarget.contains(event.relatedTarget as Node | null)) void edit.flush();
  }}>
    <div className="state-row-actions">
      {confirmDelete ? <>
        <span>{t("删除这条记录？")}</span>
        <button disabled={locked} onClick={() => void remove()}>{t("确认删除")}</button>
        <button disabled={locked} onClick={() => setConfirmDelete(false)}>{t("保留")}</button>
      </> : <>
        <button disabled={locked} onClick={() => setConfirmDelete(true)}>{t("删除")}</button>
      </>}
    </div>
    <dl>{stateColumns[table].map(column => <div key={column}>
      <dt>{stateLabel(column)}</dt>
      <dd className="record-field">{column === 'is_dead' ? <select aria-label={stateLabel(column)} disabled={locked} value={String(edit.value[column] ?? '')} onChange={event => edit.change({ ...edit.value, [column]: event.target.value })}>
        <option value="">{t("未知")}</option><option value="否">{t("否 · 未死亡")}</option><option value="是">{t("是 · 已确认死亡")}</option>
      </select> : <textarea aria-label={stateLabel(column)} placeholder="—" rows={1} readOnly={locked} value={String(edit.value[column] ?? '')} onChange={event => edit.change({ ...edit.value, [column]: event.target.value })} />}</dd>
      {column === 'is_dead' && <small className="muted">{t("仅表示是否死亡；离场、失踪或未出现不等于死亡。")}</small>}
    </div>)}</dl>
    {edit.status === 'saving' && <small role="status">{t("保存中…")}</small>}
    {edit.error && <p role="alert" className="error">{edit.error}</p>}
  </article>;
}
