import { useRef, type MouseEvent, type PointerEvent } from 'react';

// A drag from a dialog to its backdrop can produce a click targeted at the backdrop.
export function useBackdropClose(close: () => void | Promise<void>) {
  const gesture = useRef<{ pointerId: number; started: boolean; ended: boolean } | null>(null);
  return {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      gesture.current = { pointerId: event.pointerId, started: event.isPrimary && event.button === 0 && event.target === event.currentTarget, ended: false };
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (gesture.current?.pointerId === event.pointerId) {
        // Hit-test as well: touch pointers may implicitly capture the release target.
        gesture.current.ended = event.button === 0 && event.target === event.currentTarget
          && event.currentTarget.ownerDocument.elementFromPoint(event.clientX, event.clientY) === event.currentTarget;
      }
    },
    onPointerCancel() { gesture.current = null; },
    onClick(event: MouseEvent<HTMLDivElement>) {
      const dismiss = gesture.current?.started && gesture.current.ended && event.target === event.currentTarget;
      gesture.current = null;
      if (dismiss) void close();
    },
  };
}
