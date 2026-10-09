import { t, formatDate, formatNumber } from './i18n.js';
import { useEffect, useState } from 'react';
import type { ProtagonistStateSnapshot } from '@new-ai-chat/contracts';
import { api } from './api.js';
import { flushContentEdits } from './useContentAutosave.js';

function StateCheckpoint({ chatId, item, disabled, onRestore, onError }: {
  chatId: string; item: Pick<ProtagonistStateSnapshot, 'id' | 'createdAt'>; disabled: boolean;
  onRestore: () => void; onError: (error: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ProtagonistStateSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || snapshot) return;
    let active = true; setFailed(false);
    void api<ProtagonistStateSnapshot>(`/conversations/${chatId}/state/history/${item.id}`)
      .then(value => { if (active) setSnapshot(value); })
      .catch(error => { if (active) { setFailed(true); onError(error.message); } });
    return () => { active = false; };
  }, [chatId, item.id, open, snapshot]);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{formatDate(item.createdAt)}</summary>
    {open && (snapshot ? <>
      <pre>{JSON.stringify(snapshot.tables, null, 2)}</pre>
      <button disabled={disabled} onClick={onRestore}>{t("恢复为新检查点")}</button>
    </> : !failed && <small role="status">{t("正在读取检查点…")}</small>)}
  </details>;
}

export default function RecordHistory({ chatId, tab, version, disabled, onChanged, onError }: { chatId: string; tab: string; version: number; disabled: boolean; onChanged: () => void; onError: (error: string) => void }) {
  const [history, setHistory] = useState<any[]>([]), [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);
  useEffect(() => { setVisibleCount(100); }, [chatId, tab]);
  useEffect(() => {
    let active = true; setHistory([]);
    if (tab !== 'state' && tab !== 'planner') return;
    void api(`/conversations/${chatId}/${tab === 'state' ? 'state/history?view=summary' : 'planner-history'}`).then(items => { if (active) setHistory(items); }).catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [chatId, tab, version]);
  if (!history.length) return null;
  // State snapshots arrive newest first; planner events arrive oldest first.
  const recent = tab === 'state' ? history : [...history].reverse();
  return <details><summary>{tab === 'state' ? t("状态检查点") : t("Planner / 路由历史")} · {formatNumber(history.length)}</summary>{recent.slice(0, visibleCount).map(item => tab === 'state'
    ? <StateCheckpoint key={item.id} chatId={chatId} item={item} disabled={disabled || busy} onError={onError} onRestore={() => {
      void flushContentEdits().then(async () => { setBusy(true); await api(`/conversations/${chatId}/state/restore`, 'POST', { snapshotId: item.id }); onChanged(); }).catch(error => onError(error.message)).finally(() => setBusy(false));
    }} />
    : <details key={item.id}><summary>{formatDate(item.createdAt)} {item.type ?? ''}</summary><pre>{JSON.stringify(item.payload, null, 2)}</pre></details>)}
    {recent.length > visibleCount && <button onClick={() => setVisibleCount(count => count + 100)}>{t("显示更早记录（还有 {0} 条）", formatNumber(recent.length - visibleCount))}</button>}
  </details>;
}
