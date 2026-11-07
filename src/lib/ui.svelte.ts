import { SvelteSet } from 'svelte/reactivity';

export type Stage = 'outline' | 'collect' | 'select' | 'arrange' | 'write';

function ls<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem('structed.' + k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function save(k: string, v: unknown) {
  try {
    localStorage.setItem('structed.' + k, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export type MenuItem = { label: string; icon?: string; run: () => void; danger?: boolean } | null;

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  kind?: 'info' | 'error' | 'ok';
}

class UI {
  projectId: string | null = $state(ls('projectId', null));
  // ('draft' was a separate overview until it merged into the outline)
  stage: Stage = $state(((s) => (s === 'draft' ? 'outline' : s))(ls<string>('stage', 'outline')) as Stage);
  // (until v0.x the overview was called 'write'; the editor now has that id)
  dialog: null | 'settings' | 'zotero' | 'export' | 'projects' | 'snapshots' | 'search' | 'help' = $state(null);
  settingsTab = $state('appearance');
  editArtifact: { id?: string; sourceId?: string | null; kind?: string; headingId?: string; oncreated?: (id: string) => void } | null = $state(null);
  editSource: { id?: string } | null = $state(null);
  placeTarget: string | null = $state(null); // artifact id for "place under…" picker
  collectSourceId: string | null = $state(ls('collectSourceId', null));
  /** sources whose Zotero highlights are being gone through one by one */
  reviewSources: string[] | null = $state(null);
  focusHeading: string | null = $state(null);
  focusBody: string | null = $state(null);
  tour = $state(false);
  /** distraction-free writing in the Write stage */
  focus = $state(ls('focus', false));
  /** a running writing sprint: ends at `end`, started with `words` words */
  sprint: { end: number; words: number; minutes: number } | null = $state(null);
  /** library opened without a project (from the start screen) */
  libraryMode = $state(ls('libraryMode', false));
  contextMenu: { x: number; y: number; title?: string; items: MenuItem[] } | null = $state(null);

  /** open the right-click menu at the pointer */
  openContext(e: MouseEvent, items: MenuItem[], title?: string) {
    e.preventDefault();
    e.stopPropagation();
    this.contextMenu = { x: e.clientX, y: e.clientY, items, title };
  }
  /** a question in a dialog (see ask) */
  question: { title: string; text: string; ok: string; cancel: string; danger?: boolean; answer: (v: boolean) => void } | null = $state(null);
  /** Ask in a dialog instead of window.confirm; resolves with the answer. */
  ask(q: { title: string; text: string; ok: string; cancel: string; danger?: boolean }): Promise<boolean> {
    this.question?.answer(false);
    return new Promise((resolve) => {
      this.question = { ...q, answer: (v) => ((this.question = null), resolve(v)) };
    });
  }
  /** ends the current multi-selection (set by the view that has one) */
  selection: (() => void) | null = $state(null);
  /** the Word export dialog (template, title page…) */
  wordExport = $state(false);
  /** the app is cached for offline use (service worker ready) */
  offlineReady = $state(false);
  recordingShortcut = $state(false);
  toasts: Toast[] = $state([]);
  collapsed = new SvelteSet<string>(ls<string[]>('collapsed', []));
  openBodies = new SvelteSet<string>(ls<string[]>('openBodies', []));
  expandedArtifacts = new SvelteSet<string>();
  panelQuery = $state('');
  narrow = $state(false);
  panelMobileOpen = $state(false);

  constructor() {
    $effect.root(() => {
      $effect(() => save('projectId', this.projectId));
      $effect(() => save('stage', this.stage));
      $effect(() => save('focus', this.focus));
      // reopening the app (or a reload) returns to the library / the open source
      $effect(() => save('libraryMode', this.libraryMode));
      $effect(() => save('collectSourceId', this.collectSourceId));
      $effect(() => save('collapsed', [...this.collapsed]));
      $effect(() => save('openBodies', [...this.openBodies]));
    });
    const mq = matchMedia('(max-width: 700px)');
    this.narrow = mq.matches;
    mq.addEventListener('change', (e) => (this.narrow = e.matches));
  }

  private n = 0;
  toast(text: string, opts: Omit<Toast, 'id' | 'text'> = {}, ms = 4500) {
    const id = ++this.n;
    // Only the newest undo toast is meaningful (undo always reverts the latest change).
    if (opts.action) this.toasts = this.toasts.filter((x) => !x.action);
    this.toasts.push({ id, text, ...opts });
    setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== id)), ms);
  }
  toggle(set: SvelteSet<string>, id: string) {
    if (set.has(id)) set.delete(id);
    else set.add(id);
  }
}

export const ui = new UI();
