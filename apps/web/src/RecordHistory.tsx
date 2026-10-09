import { t, formatDate, formatNumber } from './i18n.js';
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { flushContentEdits } from './useContentAutosave.js';
export default function RecordHistory({ chatId, tab, version, disabled, onChanged, onError }: { chatId: string; tab: string; version: number; disabled: boolean; onChanged: () => void; onError: (error: string) => void }) {
  const [history, setHistory] = useState<any[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setHistory([]);
    if (tab !== 'state' && tab !== 'planner') return;
    void api(`/conversations/${chatId}/${tab === 'state' ? 'state/history' : 'planner-history'}`).then(items => { if (active) setHistory(items); }).catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [chatId, tab, version]);
  if (!history.length) return null;
  // State snapshots arrive newest first; planner events arrive oldest first.
  const recent = tab === 'state' ? history : [...history].reverse();
  return <details><summary>{tab === 'state' ? t("状态检查点") : t("Planner / 路由历史")} · {formatNumber(history.length)}</summary>{recent.slice(0, 100).map(item => <details key={item.id}><summary>{formatDate(item.createdAt)} {item.type ?? ''}</summary><pre>{JSON.stringify(item.tables ?? item.payload, null, 2)}</pre>{tab === 'state' && <button disabled={disabled || busy} onClick={() => {
    void flushContentEdits().then(async () => { setBusy(true); await api(`/conversations/${chatId}/state/restore`, 'POST', { snapshotId: item.id }); onChanged(); }).catch(error => onError(error.message)).finally(() => setBusy(false));
  }}>{t("恢复为新检查点")}</button>}</details>)}</details>;
}
