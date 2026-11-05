/** Svelte action: grow a textarea with its content (one row minimum). */
export function autosize(el: HTMLTextAreaElement, _value?: string) {
  const fit = () => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };
  const ro = new ResizeObserver(fit);
  ro.observe(el);
  el.addEventListener('input', fit);
  queueMicrotask(fit);
  return {
    update() {
      queueMicrotask(fit);
    },
    destroy() {
      ro.disconnect();
      el.removeEventListener('input', fit);
    }
  };
}

/** Is the caret on the first / last visual line of a (wrapping) textarea? */
export function caretAtEdge(el: HTMLTextAreaElement, dir: -1 | 1): boolean {
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
  if (el.scrollHeight <= lh * 1.6) return true; // single visual line
  return dir < 0 ? el.selectionStart === 0 : el.selectionEnd === el.value.length;
}
