import { useLayoutEffect, type RefObject } from 'react';

export function useAutoSizeTextareas(ref: RefObject<HTMLElement | null>, value: unknown, layoutKey?: unknown, shrinkWhileEditing = false) {
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const fields = container instanceof HTMLTextAreaElement ? [container] : [...container.querySelectorAll('textarea')];
    const resize = (editing = container.contains(document.activeElement)) => {
      for (const field of fields) {
        if (!field.clientWidth) continue;
        // Measure a sibling so the live editor never collapses and clamps its scroller.
        const measure = field.cloneNode() as HTMLTextAreaElement;
        measure.removeAttribute('id'); measure.removeAttribute('name'); measure.removeAttribute('autofocus');
        measure.setAttribute('aria-hidden', 'true'); measure.tabIndex = -1;
        Object.assign(measure.style, { position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none', height: 'auto', width: getComputedStyle(field).width });
        measure.value = field.value;
        field.after(measure);
        const height = measure.scrollHeight + measure.offsetHeight - measure.clientHeight;
        measure.remove();
        // Keep the editing area steady while deleting; reclaim space after leaving it.
        field.style.height = `${editing && !shrinkWhileEditing ? Math.max(height, field.offsetHeight) : height}px`;
      }
    };
    resize();
    let width = container.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== container.clientWidth) { width = container.clientWidth; resize(); }
    });
    const onBlur = (event: FocusEvent) => {
      if (!container.contains(event.relatedTarget as Node | null)) resize(false);
    };
    observer.observe(container);
    container.addEventListener('focusout', onBlur);
    return () => { observer.disconnect(); container.removeEventListener('focusout', onBlur); };
  }, [ref, value, layoutKey, shrinkWhileEditing]);
}
