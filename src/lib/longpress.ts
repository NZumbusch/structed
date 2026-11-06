// Long-press on touch / pen (the mouse uses right-click and Ctrl-click instead).
// Fires `run` after holding still. The click and the system menu that follow the
// finger lifting are swallowed page-wide: a selection bar appearing can shift the
// layout, so that click may land on a different element than the one held.
let swallowUntil = 0;
function swallow(e: Event) {
  if (Date.now() > swallowUntil) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'click') swallowUntil = 0;
}
if (typeof window !== 'undefined') {
  window.addEventListener('click', swallow, true);
  window.addEventListener('contextmenu', swallow, true);
  // a new touch starts fresh
  window.addEventListener('pointerdown', () => (swallowUntil = 0), true);
}

export function longpress(node: HTMLElement, opts: { run: () => void; disabled?: boolean; ms?: number }) {
  let o = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  function down(e: PointerEvent) {
    if (o.disabled || e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      timer = null;
      swallowUntil = Date.now() + 1500;
      navigator.vibrate?.(12);
      o.run();
    }, o.ms ?? 450);
  }
  function move(e: PointerEvent) {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear();
  }
  /** the system's long-press menu would open before our timer: hold it back while pressing */
  function menu(e: Event) {
    if (o.disabled || !timer) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', clear);
  node.addEventListener('pointercancel', clear);
  node.addEventListener('contextmenu', menu, true);
  return {
    update(n: typeof opts) {
      o = n;
    },
    destroy() {
      clear();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', clear);
      node.removeEventListener('pointercancel', clear);
      node.removeEventListener('contextmenu', menu, true);
    }
  };
}
