import { t } from './i18n.js';
import { useLayoutEffect, useRef } from 'react';
import './message-navigation.css';

export default function MessageNavigation({ markers, activeId, onJump }: {
  markers: Array<{ id: string; number: number; text: string }>;
  activeId: string | null;
  onJump: (id: string) => void;
}) {
  const container = useRef<HTMLElement>(null);
  const activeMarker = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = container.current;
    const marker = activeMarker.current;
    if (element && marker) element.scrollTop = marker.offsetTop - (element.clientHeight - marker.offsetHeight) / 2;
  }, [activeId, markers.length]);

  if (!markers.length) return null;
  return <nav ref={container} className="message-navigation" aria-label={t("用户消息导航")}>
    {markers.map(marker => <button key={marker.id} type="button"
      ref={marker.id === activeId ? activeMarker : undefined}
      className={marker.id === activeId ? 'active' : ''}
      aria-current={marker.id === activeId ? 'location' : undefined}
      aria-label={t("跳转到用户消息 {0}", marker.number)}
      title={t("第 {0} 条用户消息：{1}", marker.number, marker.text.replace(/\s+/gu, ' ').slice(0, 160))}
      onClick={() => onJump(marker.id)}>
      <i aria-hidden="true" />
    </button>)}
  </nav>;
}
