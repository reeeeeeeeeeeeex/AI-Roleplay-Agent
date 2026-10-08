import type { Conversation } from '@new-ai-chat/contracts';
import { api } from './api.js';
import { useContentAutosave } from './useContentAutosave.js';
import { useBackdropClose } from './useBackdropClose.js';

export default function AuthorNoteEditor({ chat, disabled, onSaved, onClose }: {
  chat: Conversation; disabled: boolean; onSaved: (chat: Conversation) => void; onClose: () => void;
}) {
  const { value, change, flush, status, error } = useContentAutosave({
    initial: chat.authorNote, draftKey: `author-note:${chat.id}`,
    onSave: async (authorNote, previous) => {
      if (disabled) throw new Error('生成进行中，请结束后重试保存。');
      const current = await api<Conversation>(`/conversations/${chat.id}`);
      if (current.authorNote !== previous) throw new Error('作者注释已在别处修改，未覆盖现有内容。');
      const saved = await api<Conversation>(`/conversations/${chat.id}`, 'PUT', {
        ...current, authorNote, expectedUpdatedAt: current.updatedAt,
      }, { keepalive: true });
      onSaved(saved);
      return { saved: saved.authorNote };
    },
  });
  async function close() { if (await flush()) onClose(); }
  const backdrop = useBackdropClose(close);
  return <div className="modal-shade" {...backdrop}>
    <section className="modal" role="dialog" aria-modal="true" aria-label="作者注释"
      onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); void close(); } }}>
      <header><h2>作者注释</h2><button aria-label="关闭作者注释" onClick={() => void close()}>✕</button></header>
      <form onSubmit={event => { event.preventDefault(); void flush(); }}>
        <p>仅用于当前聊天，作为最前面的 System 指令发送。可写下本段故事的重要要求。</p>
        <label>作者注释<textarea autoFocus rows={10} maxLength={20_000} value={value} readOnly={disabled}
          placeholder="例如：本段保持悬疑气氛，不要提前揭示信件来源。"
          onChange={event => change(event.target.value)} onBlur={() => void flush()} /></label>
        <small role="status">{status === 'saving' ? '保存中…' : '离开编辑区自动保存'}</small>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </section>
  </div>;
}
