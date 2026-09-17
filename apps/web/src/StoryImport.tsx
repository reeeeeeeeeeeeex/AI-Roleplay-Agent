import { useState } from 'react';
import { api } from './api.js';

export default function StoryImport({ disabled, onImported, onError }: { disabled: boolean; onImported: (id: string) => Promise<void>; onError: (message: string) => void }) {
  const [archive, setArchive] = useState<unknown>(null);
  const [preview, setPreview] = useState<{ title: string; counts: Record<string, number>; warnings: string[]; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function inspect(file?: File) {
    setArchive(null); setPreview(null); if (!file) return;
    setBusy(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('故事包不能超过 50 MiB。');
      const value: unknown = JSON.parse(await file.text());
      const result = await api('/imports/story/preview', 'POST', value);
      setArchive(value); setPreview(result);
    } catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!archive || !preview) return;
    setBusy(true);
    try { const chat = await api('/imports/story/execute', 'POST', archive); setArchive(null); setPreview(null); await onImported(chat.id); }
    catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section>
    <h2>恢复原生故事包</h2>
    <p className="muted">选择导出的 .airp.json 文件，先预览再导入。不会覆盖现有故事或连接设置。</p>
    <input aria-label="原生故事包" type="file" accept=".json,application/json" disabled={disabled || busy} onChange={event => void inspect(event.target.files?.[0])} />
    {preview && <div className="import-preview">
      <h3>{preview.title}</h3><p>{preview.note}</p>
      <div className="count-grid">{Object.entries(preview.counts).map(([key, value]) => <span key={key}><b>{value}</b>{key}</span>)}</div>
      {preview.warnings.map((warning, index) => <p className="warning" key={index}>{warning}</p>)}
      <button disabled={disabled || busy} onClick={() => void restore()}>{busy ? '导入中…' : '导入为新故事'}</button>
    </div>}
  </section>;
}
