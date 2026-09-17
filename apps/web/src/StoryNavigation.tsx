import { useEffect, useState } from 'react';
import type { StoryNavigation as Navigation } from '@new-ai-chat/contracts';
import { api } from './api.js';

export default function StoryNavigation({ chatId, version, disabled, onHead, onChanged, onError }: {
  chatId: string; version: number; disabled: boolean;
  onHead: (id: string) => Promise<void>; onChanged: () => void; onError: (message: string) => void;
}) {
  const [data, setData] = useState<Navigation | null>(null);
  useEffect(() => {
    let active = true;
    void api<Navigation>(`/conversations/${chatId}/navigation`).then(value => { if (active) setData(value); }).catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [chatId, version]);
  const run = (action: Promise<unknown>) => { void action.then(onChanged).catch(error => onError(error.message)); };
  return <details className="story-navigation">
    <summary>场景与书签</summary>
    {data && <>
      <p>{data.scene.scenario || '场景未记录'}</p>
      <small>时间：{data.scene.time || '未记录'} · 地点：{data.scene.location || '未记录'} · 在场人物：{data.scene.presentCharacters.join('、') || '未记录'}</small>
      {data.bookmarks.map(bookmark => <div key={bookmark.id}>
        <button disabled={disabled} onClick={() => run(onHead(bookmark.messageId))}>☆ {bookmark.name}</button>
        <button disabled={disabled} onClick={() => {
          const name = window.prompt('书签名称', bookmark.name);
          if (name?.trim()) run(api(`/conversations/${chatId}/bookmarks`, 'POST', { ...bookmark, name }));
        }}>重命名</button>
        <button disabled={disabled} onClick={() => run(api(`/conversations/${chatId}/bookmarks/${bookmark.id}`, 'DELETE'))}>删除书签</button>
      </div>)}
      {!data.bookmarks.length && <p className="muted">可从消息操作中添加书签。</p>}
    </>}
  </details>;
}
