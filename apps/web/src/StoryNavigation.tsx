import { t, diagnosticText } from './i18n.js';
import { useEffect, useState } from 'react';
import type { StoryNavigation as Navigation } from '@new-ai-chat/contracts';
import { api } from './api.js';
import AutoSaveField from './AutoSaveField.js';
import { flushContentEdits } from './useContentAutosave.js';

export default function StoryNavigation({ chatId, title, head, version, disabled, onJump, onChanged, onError }: {
  chatId: string; title: string; head: string | null; version: number; disabled: boolean;
  onJump: (id: string) => Promise<void>; onChanged: () => void; onError: (message: string) => void;
}) {
  const [data, setData] = useState<Navigation | null>(null);
  useEffect(() => {
    let active = true;
    void api<Navigation>(`/conversations/${chatId}/navigation`).then(value => { if (active) setData(value); }).catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [chatId, version]);
  const run = (action: Promise<unknown>) => { void action.then(onChanged).catch(error => onError(error.message)); };
  async function download(format: 'markdown' | 'native') {
    try {
      await flushContentEdits();
      const response = await fetch(`/api/conversations/${chatId}/export?format=${format}`);
      if (!response.ok) { const body = await response.json(); throw new Error(diagnosticText(body.errorText, body.error ?? t("导出失败"))); }
      const url = URL.createObjectURL(await response.blob());
      // Keep multilingual names short enough for common filesystems; the prefix avoids reserved device names.
      const name = Array.from(title.trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')).slice(0, 48).join('');
      const link = document.createElement('a'); link.href = url; link.download = `story-${name ? `${name}-` : ''}${chatId.slice(0, 8)}.${format === 'markdown' ? 'md' : 'airp.json'}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { onError((error as Error).message); }
  }
  return <details className="story-navigation">
    <summary>{t("场景与书签")}</summary>
    <div><button disabled={disabled} onClick={() => void download('markdown')}>{t("导出当前分支 Markdown")}</button><button disabled={disabled} onClick={() => void download('native')}>{t("导出完整故事包")}</button></div>
    {data && <>
      <AutoSaveField draftKey={`${chatId}:scene`} initial={data.scene.scenario} label={t("当前场景")} placeholder={t("场景未记录")} disabled={disabled} onError={onError} onSave={async (scenario, previous) => {
        const current = await api(`/conversations/${chatId}`);
        await api(`/conversations/${chatId}`, 'PUT', { ...current, scenario, expectedScenario: previous, expectedUpdatedAt: current.updatedAt }, { keepalive: true }); onChanged();
      }} />
      <div className="scene-fields">{(['time', 'location'] as const).map(field => <label key={field}>{field === 'time' ? t("时间") : t("地点")}<AutoSaveField key={`${head}:${field}`} draftKey={`${chatId}:${head}:scene-${field}`} initial={data.scene[field]} label={field === 'time' ? t("当前时间") : t("当前地点")} placeholder={t("未记录")} singleLine disabled={disabled} onError={onError}
        onSave={async (content, previous) => { await api(`/conversations/${chatId}/state/cell`, 'PATCH', { table: 'global_state', rowId: 1, column: field === 'time' ? 'current_time' : 'current_location', content, previous, head }, { keepalive: true }); onChanged(); }} /></label>)}</div>
      <small>{t("重要角色：")}{data.scene.importantCharacters.join('、') || t("未记录")}</small>
      {data.bookmarks.map(bookmark => <div key={bookmark.id}>
        <AutoSaveField draftKey={`${chatId}:bookmark:${bookmark.id}`} initial={bookmark.name} label={t("书签名称")} singleLine disabled={disabled} onError={onError}
          onSave={async (name, previous) => { const saved = await api(`/conversations/${chatId}/bookmarks`, 'POST', { ...bookmark, name, previous }, { keepalive: true }); onChanged(); return saved.name; }} />
        <button disabled={disabled} aria-label={t("跳转到书签 {0}", bookmark.name)} onClick={() => run(onJump(bookmark.messageId))}>{t("跳转")}</button>
        <button disabled={disabled} onClick={() => run(api(`/conversations/${chatId}/bookmarks/${bookmark.id}`, 'DELETE'))}>{t("删除书签")}</button>
      </div>)}
      {!data.bookmarks.length && <p className="muted">{t("可从消息操作中添加书签。")}</p>}
    </>}
  </details>;
}
