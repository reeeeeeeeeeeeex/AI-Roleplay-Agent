import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { MessageNode } from '@new-ai-chat/contracts';
import { t } from './i18n.js';
import './message-search.css';

export default function MessageSearch({ messages, onMatch, onClose, inputRef }: {
  messages: MessageNode[]; onMatch: (id: string | null) => void; onClose: () => void; inputRef: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    return text ? messages.filter(message => message.role !== 'system' && message.content.toLowerCase().includes(text)) : [];
  }, [messages, query]);
  const index = Math.max(0, matches.findIndex(message => message.id === chosen));
  const current = matches[index]?.id ?? null;
  const notify = useRef(onMatch);
  notify.current = onMatch;
  useEffect(() => { notify.current(current); }, [current, query]);

  function step(direction: number) {
    const next = matches[(index + direction + matches.length) % matches.length];
    if (!next) return;
    setChosen(next.id);
    if (next.id === current) notify.current(next.id);
  }

  return <div className="message-search" role="search" aria-label={t('搜索正文')} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }}>
    <input ref={inputRef} type="search" autoFocus aria-label={t('搜索当前分支正文')} placeholder={t('搜索当前分支正文')}
      title={t('搜索已保存的正文；Enter 下一条，Shift+Enter 上一条。')} value={query}
      onChange={event => { setQuery(event.target.value); setChosen(null); }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
      }} />
    <small role="status" aria-live="polite">{t('{0} / {1} 条消息', matches.length ? index + 1 : 0, matches.length)}</small>
    <button type="button" aria-label={t('上一条匹配消息')} title={t('上一条匹配消息')} disabled={!matches.length} onClick={() => step(-1)}><ArrowUp size={16} /></button>
    <button type="button" aria-label={t('下一条匹配消息')} title={t('下一条匹配消息')} disabled={!matches.length} onClick={() => step(1)}><ArrowDown size={16} /></button>
    <button type="button" aria-label={t('关闭搜索')} title={t('关闭搜索')} onClick={onClose}><X size={16} /></button>
  </div>;
}
