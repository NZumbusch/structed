// Tiny pointer-based drag & drop that works with mouse, pen and touch (long-press).
// Native HTML5 DnD doesn't work on iOS/Android touch, so we roll our own.

export interface DragPayload {
  type: 'artifact' | 'placement' | 'heading';
  id: string;
  label: string;
}

export interface DropInfo {
  x: number;
  y: number;
  rect: DOMRect;
  el: HTMLElement;
}

export interface DropOptions {
  accepts: (p: DragPayload) => boolean;
  onOver?: (p: DragPayload, info: DropInfo) => void;
  onLeave?: () => void;
  onDrop: (p: DragPayload, info: DropInfo) => void;
}

export interface DragOptions {
  payload: DragPayload | (() => DragPayload);
  disabled?: boolean;
  /** Only start when pointerdown happens inside this selector. */
  handle?: string;
}

const IGNORE = 'input,textarea,select,button,a,[contenteditable],.cm-editor,[data-nodrag]';
const zones = new Map<HTMLElement, DropOptions>();

let active: {
  payload: DragPayload;
  ghost: HTMLElement;
  x: number;
  y: number;
  zone: HTMLElement | null;
  raf: number;
} | null = null;

export const isDragging = () => !!active;

function findZone(x: number, y: number): HTMLElement | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el) {
    const z = zones.get(el);
    if (z && active && z.accepts(active.payload)) return el;
    el = el.parentElement;
  }
  return null;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

function tick() {
  if (!active) return;
  const { x, y } = active;
  const under = document.elementFromPoint(x, y) as HTMLElement | null;
  const sp = scrollParent(under);
  if (sp) {
    const r = sp.getBoundingClientRect();
    const edge = 48;
    if (y < r.top + edge) sp.scrollTop -= Math.ceil((r.top + edge - y) / 4);
    else if (y > r.bottom - edge) sp.scrollTop += Math.ceil((y - (r.bottom - edge)) / 4);
  }
  active.raf = requestAnimationFrame(tick);
}

function move(x: number, y: number) {
  if (!active) return;
  active.x = x;
  active.y = y;
  active.ghost.style.left = x + 12 + 'px';
  active.ghost.style.top = y + 12 + 'px';
  const z = findZone(x, y);
  if (z !== active.zone) {
    if (active.zone) {
      active.zone.classList.remove('dnd-over');
      zones.get(active.zone)?.onLeave?.();
    }
    active.zone = z;
    z?.classList.add('dnd-over');
  }
  if (z) zones.get(z)?.onOver?.(active.payload, { x, y, rect: z.getBoundingClientRect(), el: z });
}

function end(drop: boolean) {
  if (!active) return;
  const a = active;
  active = null;
  cancelAnimationFrame(a.raf);
  a.ghost.remove();
  document.body.classList.remove('dnd-active');
  if (a.zone) {
    a.zone.classList.remove('dnd-over');
    const z = zones.get(a.zone);
    z?.onLeave?.();
    if (drop && z) z.onDrop(a.payload, { x: a.x, y: a.y, rect: a.zone.getBoundingClientRect(), el: a.zone });
  }
}

function start(payload: DragPayload, x: number, y: number) {
  const ghost = document.createElement('div');
  ghost.className = 'dnd-ghost';
  ghost.textContent = payload.label.slice(0, 120) || '…';
  document.body.appendChild(ghost);
  document.body.classList.add('dnd-active');
  active = { payload, ghost, x, y, zone: null, raf: 0 };
  navigator.vibrate?.(10);
  window.getSelection()?.removeAllRanges();
  move(x, y);
  active.raf = requestAnimationFrame(tick);
}

// Global listeners: touch moves must be non-passive to stop scrolling during drags.
if (typeof window !== 'undefined') {
  window.addEventListener(
    'touchmove',
    (e) => {
      if (!active) return;
      e.preventDefault();
      const t = e.touches[0];
      if (t) move(t.clientX, t.clientY);
    },
    { passive: false }
  );
  window.addEventListener('touchend', () => end(true));
  window.addEventListener('touchcancel', () => end(false));
  window.addEventListener('pointermove', (e) => {
    if (active && e.pointerType !== 'touch') move(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', (e) => {
    if (active && e.pointerType !== 'touch') end(true);
  });
  window.addEventListener('keydown', (e) => {
    if (active && e.key === 'Escape') end(false);
  });
  window.addEventListener('blur', () => end(false));
}

export function draggable(node: HTMLElement, opts: DragOptions) {
  let o = opts;
  let pending: { x: number; y: number; id: number; type: string; timer?: ReturnType<typeof setTimeout> } | null = null;

  const payload = () => (typeof o.payload === 'function' ? o.payload() : o.payload);

  function down(e: PointerEvent) {
    if (o.disabled || e.button !== 0 || active) return;
    const target = e.target as HTMLElement;
    if (o.handle && !target.closest(o.handle)) return;
    if (!o.handle && target.closest(IGNORE)) return;
    pending = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
    if (e.pointerType !== 'mouse') {
      pending.timer = setTimeout(() => {
        if (pending) {
          const p = pending;
          pending = null;
          start(payload(), p.x, p.y);
        }
      }, 280);
    }
    window.addEventListener('pointermove', pmove);
    window.addEventListener('pointerup', cancel, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
  }
  function pmove(e: PointerEvent) {
    if (!pending || e.pointerId !== pending.id) return;
    const d = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.type === 'mouse') {
      if (d > 6) {
        pending = null;
        start(payload(), e.clientX, e.clientY);
      }
    } else if (d > 10) cancel(); // user is scrolling
  }
  function cancel() {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
    window.removeEventListener('pointermove', pmove);
  }
  function ctx(e: Event) {
    if (pending || active) e.preventDefault();
  }
  node.addEventListener('pointerdown', down);
  node.addEventListener('contextmenu', ctx);
  return {
    update(n: DragOptions) {
      o = n;
    },
    destroy() {
      cancel();
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('contextmenu', ctx);
    }
  };
}

export function droppable(node: HTMLElement, opts: DropOptions) {
  zones.set(node, opts);
  return {
    update(n: DropOptions) {
      zones.set(node, n);
    },
    destroy() {
      zones.delete(node);
    }
  };
}

/** Where in the element's vertical extent the pointer is: 'before' | 'inside' | 'after'. */
export function zonePosition(info: DropInfo, inside = true): 'before' | 'inside' | 'after' {
  const rel = (info.y - info.rect.top) / Math.max(info.rect.height, 1);
  if (!inside) return rel < 0.5 ? 'before' : 'after';
  if (rel < 0.28) return 'before';
  if (rel > 0.72) return 'after';
  return 'inside';
}
