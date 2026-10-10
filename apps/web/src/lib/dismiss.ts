import { type RefObject, useEffect } from 'react';

/**
 * Closes a popover on outside pointer down, on Escape (returning focus to its trigger)
 * and when keyboard focus leaves it.
 */
export function useDismiss(
  open: boolean,
  close: () => void,
  containerRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (!container?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        triggerRef?.current?.focus();
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && !container?.contains(next)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    container?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      container?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, close, containerRef, triggerRef]);
}
