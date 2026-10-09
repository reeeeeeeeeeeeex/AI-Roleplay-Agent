import { t } from './i18n.js';
import type { CSSProperties } from 'react';
import './message-navigation.css';

export default function MessageNavigation({ markers, activeId, onJump }: {
  markers: Array<{ id: string; number: number; text: string }>;
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  if (!markers.length) return null;
  return <nav className="message-navigation" aria-label={t("最近 20 条用户消息")} style={{ '--marker-count': markers.length } as CSSProperties}>
    {markers.map(marker => <button key={marker.id} type="button"
      className={marker.id === activeId ? 'active' : ''}
      aria-current={marker.id === activeId ? 'location' : undefined}
      aria-label={t("跳转到用户消息 {0}", marker.number)}
      title={t("第 {0} 条用户消息：{1}", marker.number, marker.text.replace(/\s+/gu, ' ').slice(0, 160))}
      onClick={() => onJump(marker.id)}>
      <i aria-hidden="true" />
    </button>)}
  </nav>;
}
