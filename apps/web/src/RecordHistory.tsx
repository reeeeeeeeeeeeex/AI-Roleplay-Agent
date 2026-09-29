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
  return <details><summary>{tab === 'state' ? '状态检查点' : 'Planner / 路由历史'} · {history.length}</summary>{[...history].reverse().slice(0, 100).map(item => <details key={item.id}><summary>{new Date(item.createdAt).toLocaleString()} {item.type ?? ''}</summary><pre>{JSON.stringify(item.tables ?? item.payload, null, 2)}</pre>{tab === 'state' && <button disabled={disabled || busy} onClick={() => {
    void flushContentEdits().then(async () => { setBusy(true); await api(`/conversations/${chatId}/state/restore`, 'POST', { snapshotId: item.id }); onChanged(); }).catch(error => onError(error.message)).finally(() => setBusy(false));
  }}>恢复为新检查点</button>}</details>)}</details>;
}
