import { useEffect, useState } from 'react';
import { stateColumns, type StateRow, type StateTableName } from '@new-ai-chat/contracts';
import { api } from './api.js';
import { useContentAutosave } from './useContentAutosave.js';

export default function StateCollectionRow({ chatId, head, table, row, disabled, onSaved, onError }: {
  chatId: string; head: string | null; table: StateTableName; row: StateRow; disabled: boolean;
  onSaved: (state: any) => void; onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false), [confirmDelete, setConfirmDelete] = useState(false), [deleting, setDeleting] = useState(false);
  const edit = useContentAutosave({
    initial: row, draftKey: `${chatId}:${head}:state-row:${table}:${row.row_id}`, onError,
    onSave: async (value, previous) => {
      const cells = Object.fromEntries(stateColumns[table].map(column => [column, value[column] ?? '']));
      const saved = await api(`/conversations/${chatId}/state/row`, 'PATCH', { head, table, rowId: row.row_id, previous, cells }, { keepalive: true });
      onSaved(saved);
      return { saved: saved.tables[table].find((item: StateRow) => item.row_id === row.row_id) as StateRow };
    },
  });
  useEffect(() => { if (edit.dirty) setEditing(true); }, [edit.dirty]);
  const locked = disabled || deleting || edit.status === 'saving';
  async function finish() { if (await edit.flush()) setEditing(false); }
  async function remove() {
    setDeleting(true);
    try {
      const saved = await api(`/conversations/${chatId}/state/row`, 'DELETE', { head, table, rowId: row.row_id, previous: row });
      edit.discard(); onSaved(saved);
    } catch (cause) { onError((cause as Error).message); setDeleting(false); }
  }
  return <article className="state-row" data-table={table} onBlur={event => {
    if (editing && !locked && !confirmDelete && !event.currentTarget.contains(event.relatedTarget as Node | null)) void finish();
  }}>
    <div className="state-row-actions">
      {confirmDelete ? <>
        <span>删除这条记录？</span>
        <button disabled={locked} onClick={() => void remove()}>确认删除</button>
        <button disabled={locked} onClick={() => setConfirmDelete(false)}>保留</button>
      </> : <>
        <button disabled={locked} onClick={() => editing ? void finish() : setEditing(true)}>{editing ? '完成' : '编辑'}</button>
        {editing && <button disabled={locked} onClick={() => { edit.discard(); setEditing(false); }}>取消</button>}
        <button disabled={locked} onClick={() => setConfirmDelete(true)}>删除</button>
      </>}
    </div>
    <dl>{stateColumns[table].map(column => <div key={column}>
      <dt>{column}</dt>
      <dd>{editing ? column === 'is_dead' ? <select aria-label={column} disabled={locked} value={String(edit.value[column] ?? '')} onChange={event => edit.change({ ...edit.value, [column]: event.target.value })}>
        <option value="">未知</option><option value="否">否 · 未死亡</option><option value="是">是 · 已确认死亡</option>
      </select> : <textarea aria-label={column} rows={2} disabled={locked} value={String(edit.value[column] ?? '')} onChange={event => edit.change({ ...edit.value, [column]: event.target.value })} /> : String(row[column] ?? '') || '—'}</dd>
      {column === 'is_dead' && <small className="muted">仅表示是否死亡；离场、失踪或未出现不等于死亡。</small>}
    </div>)}</dl>
    {editing && <small className="muted">整条记录一起编辑，离开此记录自动保存。</small>}
    {edit.error && <p role="alert" className="error">{edit.error}</p>}
  </article>;
}
