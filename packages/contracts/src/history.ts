import type { MessageNode } from './index.js';

// A sibling Swipe occupies the same starting position; regenerating the start
// itself can temporarily leave the branch ending immediately before it.
export function historyStartIndex(history: Pick<MessageNode, 'id'>[], start: Pick<MessageNode, 'id' | 'parentId'>): number {
  const exact = history.findIndex(message => message.id === start.id);
  if (exact >= 0) return exact;
  if (start.parentId === null) return 0;
  const parent = history.findIndex(message => message.id === start.parentId);
  return parent < 0 ? -1 : parent + 1;
}
