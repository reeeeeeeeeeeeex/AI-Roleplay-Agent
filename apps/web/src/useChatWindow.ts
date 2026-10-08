import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MessageNode } from '@new-ai-chat/contracts';

export function useChatWindow(messages: MessageNode[], chatId: string | null, limit: number, drafts: unknown, layout: string) {
  const container = useRef<HTMLElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const pending = useRef<{ kind: 'anchor'; id: string; top: number } | { kind: 'jump'; id: string } | { kind: 'latest' } | null>(null);
  const [window, setWindow] = useState({ chatId, limit, firstId: null as string | null });
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const attachContainer = useCallback((element: HTMLElement | null) => {
    container.current = element;
    if (!element) return;
    // History may arrive before the chat view mounts, or survive leaving the view.
    followBottom.current = true;
    pending.current = { kind: 'latest' };
    setWindow(current => ({ ...current, firstId: null }));
  }, []);
  const sameWindow = window.chatId === chatId && window.limit === limit;
  const firstIndex = sameWindow && window.firstId ? messages.findIndex(message => message.id === window.firstId) : -1;
  const start = firstIndex >= 0 ? firstIndex : Math.max(0, messages.length - limit);
  const visibleMessages = messages.slice(start);
  const userMarkers = useMemo(() => messages.map((message, index) => ({ message, index })).filter(item => item.message.role === 'user')
    .map((item, index) => ({ id: item.message.id, text: item.message.content, number: index + 1, index: item.index })).slice(-20), [messages]);

  function updatePosition() {
    const element = container.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    followBottom.current = atBottom;
    setAwayFromBottom(!atBottom);
    const top = element.getBoundingClientRect().top + 48;
    let active: string | null = null;
    for (const marker of userMarkers) {
      const node = document.getElementById(`message-${marker.id}`);
      if (marker.index < start || (node && node.getBoundingClientRect().top <= top)) active = marker.id;
    }
    setActiveUserId(atBottom ? userMarkers.at(-1)?.id ?? null : active);
    lastScrollTop.current = element.scrollTop;
  }

  function loadOlder() {
    const element = container.current;
    if (!element || start === 0 || pending.current) return;
    const node = element.querySelector<HTMLElement>('[data-message-id]');
    if (!node) return;
    pending.current = { kind: 'anchor', id: node.dataset.messageId!, top: node.getBoundingClientRect().top };
    followBottom.current = false;
    setWindow({ chatId, limit, firstId: messages[Math.max(0, start - limit)]!.id });
  }

  function onScroll() {
    const element = container.current;
    if (!element || pending.current) return;
    const movingUp = element.scrollTop < lastScrollTop.current - 1;
    updatePosition();
    // Pin the first mounted message while reading, so incoming replies cannot remove it.
    if (!followBottom.current && firstIndex < 0 && visibleMessages[0]) setWindow({ chatId, limit, firstId: visibleMessages[0].id });
    if (movingUp && element.scrollTop < 100) loadOlder();
  }

  function scrollToLatest() {
    followBottom.current = true;
    pending.current = { kind: 'latest' };
    setWindow({ chatId, limit, firstId: null });
  }

  function onAvatarLoad() {
    const element = container.current;
    if (!element || !followBottom.current || pending.current) return;
    element.scrollTop = element.scrollHeight;
    updatePosition();
  }

  function scrollToMessage(id: string) {
    const index = messages.findIndex(message => message.id === id);
    if (index < 0) return;
    followBottom.current = false;
    pending.current = { kind: 'jump', id };
    setWindow({ chatId, limit, firstId: messages[Math.min(start, index)]!.id });
  }

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    if (!sameWindow) {
      pending.current = null; followBottom.current = true;
      setWindow({ chatId, limit, firstId: null });
    }
    const action = pending.current;
    if (action?.kind === 'anchor') {
      const node = document.getElementById(`message-${action.id}`);
      if (node) element.scrollTop += node.getBoundingClientRect().top - action.top;
    } else if (action?.kind === 'jump') {
      const node = document.getElementById(`message-${action.id}`);
      if (node) element.scrollTop += node.getBoundingClientRect().top - element.getBoundingClientRect().top - 12;
    } else if (action?.kind === 'latest' || followBottom.current) element.scrollTop = element.scrollHeight;
    pending.current = null;
    updatePosition();
  }, [messages, window, chatId, limit, drafts, layout]);

  return { container: attachContainer, bottom, visibleMessages, userMarkers, activeUserId, awayFromBottom, olderCount: start, loadOlder, onScroll, onAvatarLoad, scrollToLatest, scrollToMessage };
}
