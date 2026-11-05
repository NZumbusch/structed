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

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  kind?: 'info' | 'error' | 'ok';
}

class UI {
  projectId: string | null = $state(ls('projectId', null));
  stage: Stage = $state(ls('stage', 'outline'));
  dialog: null | 'settings' | 'zotero' | 'export' | 'projects' | 'snapshots' | 'search' | 'help' = $state(null);
  settingsTab = $state('appearance');
  editArtifact: { id?: string; sourceId?: string | null; kind?: string; headingId?: string } | null = $state(null);
  editSource: { id?: string } | null = $state(null);
  placeTarget: string | null = $state(null); // artifact id for "place under…" picker
  collectSourceId: string | null = $state(null);
  zoteroFor: string | null = $state(null); // source id: jump to highlight import
  focusHeading: string | null = $state(null);
  focusBody: string | null = $state(null);
  tour = $state(false);
  /** library opened without a project (from the start screen) */
  libraryMode = $state(false);
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
