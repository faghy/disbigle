import { type RefObject, useLayoutEffect } from 'react';

/**
 * Makes a textarea as tall as its text, from its `rows` up to `maxViewport` of the window
 * height; past that it scrolls. Long posts can then be read back without scrolling a tiny box.
 */
export function useAutoGrow(
  textarea: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxViewport = 0.6,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the text is read through the element
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    // Measure from the `rows` height, so deleting text shrinks the box again.
    element.style.height = '';
    const max = window.innerHeight * maxViewport;
    // scrollHeight leaves out the borders, which the (border-box) height includes.
    const wanted = element.scrollHeight + element.offsetHeight - element.clientHeight;
    if (wanted > element.offsetHeight) {
      element.style.height = `${Math.min(wanted, max)}px`;
    }
    element.style.overflowY = wanted > max ? 'auto' : 'hidden';
  }, [textarea, value, maxViewport]);
}
