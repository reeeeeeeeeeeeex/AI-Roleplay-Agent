import { useState } from 'react';
import type { NarratorProfile } from '@new-ai-chat/contracts';
export default function NarratorSettings({ initial, onSave, onClose }: { initial: NarratorProfile; onSave: (value: NarratorProfile) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState(initial), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <div className="modal-shade"><section className="modal" role="dialog" aria-modal="true" aria-label="默认旁白"><header><h2>默认旁白</h2><button aria-label="关闭" onClick={onClose}>✕</button></header><form onSubmit={event => { event.preventDefault(); setBusy(true); void onSave(value).catch(error => setError(error.message)).finally(() => setBusy(false)); }}>
    <p className="muted">新聊天使用这里的身份设置；已有聊天可在聊天设置中单独调整。旁白不能删除或禁用。</p>
    <label>显示名称<input required value={value.name} onChange={e => setValue({ ...value, name: e.target.value })}/></label>
    <label>写作风格<textarea rows={6} value={value.style} onChange={e => setValue({ ...value, style: e.target.value })}/></label>
    <label>头像（本地资产地址）<input value={value.avatarPath ?? ''} onChange={e => setValue({ ...value, avatarPath: e.target.value || null })}/></label>
    {error && <p className="error">{error}</p>}<footer><button type="button" onClick={onClose}>取消</button><button className="primary" disabled={busy}>保存默认旁白</button></footer>
  </form></section></div>;
}
