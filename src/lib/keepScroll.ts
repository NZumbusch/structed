// Remembers where a scrolling area was, per project and view, and puts it back when the
// view comes back (switching stages, opening a source again, reloading the tab).
// Content that renders a little later (the text editors in Write) is waited for.
const KEY = 'structed.scroll';
let saved: Record<string, number> = {};
try {
  saved = JSON.parse(sessionStorage.getItem(KEY) || '{}');
} catch {
  /* private mode */
}
let pending: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* ignore */
    }
  }, 300);
}

/** `use:keepScroll={'write:' + projectId}` – the key says which place this is. */
export function keepScroll(node: HTMLElement, key: string | null | undefined) {
  let k = key;
  let restoring = false;
  let raf = 0;

  function restore() {
    cancelAnimationFrame(raf);
    const target = k ? saved[k] : undefined;
    if (!target) return;
    restoring = true;
    const start = performance.now();
    // keep putting it there while the content is still settling: until it is tall enough,
    // and at least half a second, since lines that render late (a citation above the list)
    // would otherwise shift the view. Scrolling yourself ends this at once.
    const step = () => {
      node.scrollTop = target;
      const t = performance.now() - start;
      const reached = Math.abs(node.scrollTop - target) < 2;
      if ((reached && t > 500) || t > 1500) restoring = false;
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function onScroll() {
    if (restoring || !k) return;
    saved[k] = node.scrollTop;
    persist();
  }
  // the person scrolling takes over from the restore
  const takeOver = () => {
    restoring = false;
    cancelAnimationFrame(raf);
  };

  node.addEventListener('scroll', onScroll, { passive: true });
  node.addEventListener('wheel', takeOver, { passive: true });
  node.addEventListener('touchstart', takeOver, { passive: true });
  node.addEventListener('keydown', takeOver);
  restore();
  return {
    update(nk: string | null | undefined) {
      if (nk === k) return;
      k = nk;
      node.scrollTop = 0;
      restore();
    },
    destroy() {
      cancelAnimationFrame(raf);
      node.removeEventListener('scroll', onScroll);
      node.removeEventListener('wheel', takeOver);
      node.removeEventListener('touchstart', takeOver);
      node.removeEventListener('keydown', takeOver);
    }
  };
}
