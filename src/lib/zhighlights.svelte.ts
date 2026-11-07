// How many Zotero highlights of a source have not been gone through yet (neither taken
// nor skipped). Kept on this device only, per library: annotation → its PDF → the item.
// After the first run it asks Zotero only for what changed (`since=<version>`), so a check
// with nothing new costs two small requests.
import { SvelteMap } from 'svelte/reactivity';
import { db } from './db.svelte';
import { annotationChanges, deletedSince, parentsOf, zoteroConfigured } from './zotero';

interface Cache {
  v: number;
  /** attachment → top-level item */
  att: Record<string, string>;
  /** annotation → attachment (only highlights / underlines / notes with text) */
  ann: Record<string, string>;
}
const KEY = (lib: string) => 'structed.zhl.' + lib;
function load(lib: string): Cache {
  try {
    return { v: 0, att: {}, ann: {}, ...JSON.parse(localStorage.getItem(KEY(lib)) || '{}') };
  } catch {
    return { v: 0, att: {}, ann: {} };
  }
}
function save(lib: string, c: Cache) {
  try {
    localStorage.setItem(KEY(lib), JSON.stringify(c));
  } catch {
    /* full or blocked: it is only a cache */
  }
}

/** per library: item key → its highlight keys */
const byItem = new SvelteMap<string, Map<string, string[]>>();
const last = new Map<string, number>();
const running = new Set<string>();

function index(lib: string, c: Cache) {
  const m = new Map<string, string[]>();
  for (const [a, att] of Object.entries(c.ann)) {
    const top = c.att[att];
    if (top) (m.get(top) ?? m.set(top, []).get(top)!).push(a);
  }
  byItem.set(lib, m);
}

/** Bring the cache of one library up to date (at most every 2 minutes unless forced). */
export async function refreshHighlights(lib: string, force = false) {
  if (!zoteroConfigured() || running.has(lib)) return;
  if (!byItem.has(lib)) index(lib, load(lib));
  if (!force && Date.now() - (last.get(lib) ?? 0) < 2 * 60_000) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  running.add(lib);
  last.set(lib, Date.now());
  try {
    const c = load(lib);
    const { items, version } = await annotationChanges(lib, c.v);
    for (const a of items) {
      if (a.hasText && a.type !== 'ink' && a.type !== 'image') c.ann[a.key] = a.attachment;
      else delete c.ann[a.key];
    }
    const unknown = [...new Set(items.map((a) => a.attachment))].filter((k) => k && !(k in c.att));
    if (unknown.length) Object.assign(c.att, await parentsOf(lib, unknown));
    if (c.v) for (const k of await deletedSince(lib, c.v)) delete c.ann[k];
    if (version) c.v = version;
    save(lib, c);
    index(lib, c);
  } catch {
    /* offline or no access: keep what we know */
  } finally {
    running.delete(lib);
  }
}

/** Highlights of a source that were neither taken nor skipped. */
export function newHighlights(lib: string | undefined, itemKey: string | undefined, seen: Set<string>): number {
  if (!lib || !itemKey) return 0;
  return (byItem.get(lib)?.get(itemKey) ?? []).filter((k) => !seen.has(k)).length;
}

/** Zotero keys already taken or skipped (skipped ones are kept as deleted items). */
export function seenHighlights(): Set<string> {
  const out = new Set<string>();
  for (const a of db.all('artifacts')) if (a.zoteroKey) out.add(a.zoteroKey);
  for (const a of db.deletedOf('artifacts')) if (a.zoteroKey) out.add(a.zoteroKey);
  return out;
}
