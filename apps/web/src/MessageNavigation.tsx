import type { CSSProperties } from 'react';
import './message-navigation.css';

export default function MessageNavigation({ markers, activeId, onJump }: {
  markers: Array<{ id: string; number: number; text: string }>;
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  if (!markers.length) return null;
  return <nav className="message-navigation" aria-label="最近 20 条用户消息" style={{ '--marker-count': markers.length } as CSSProperties}>
    {markers.map(marker => <button key={marker.id} type="button"
      className={marker.id === activeId ? 'active' : ''}
      aria-current={marker.id === activeId ? 'location' : undefined}
      aria-label={`跳转到用户消息 ${marker.number}`}
      title={`第 ${marker.number} 条用户消息：${marker.text.replace(/\s+/gu, ' ').slice(0, 160)}`}
      onClick={() => onJump(marker.id)}>
      <i aria-hidden="true" />
    </button>)}
  </nav>;
}
