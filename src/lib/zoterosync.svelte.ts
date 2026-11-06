// Automatic Zotero → Structed sync: keeps the sources of one Zotero library (or one
// collection) up to date. It asks Zotero only for items changed since the last run
// (`since=<library version>`), so a sync with nothing new is a single small request.
// New items become sources, changed metadata is updated. Nothing is deleted here:
// a source removed in Zotero may still carry your quotes.
import { db } from './db.svelte';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';
import { t } from './i18n';
import { sync } from './sync.svelte';
import { deletedZoteroKeys, items as fetchItems, upsertSource, zoteroConfigured, type ZItem } from './zotero';

const EVERY = 10 * 60_000; // in the background
const ON_RETURN = 2 * 60_000; // when coming back to the app, at most this often

export const zsync = $state({
  running: false,
  lastRun: 0,
  error: '',
  /** sources added / updated by the last run */
  added: 0,
  updated: 0
});

/** Where we are in the library, per scope ("users/1" or "users/1/C1"). */
const scopeKey = () => (settings.zoteroSyncCollection ? `${settings.zoteroSyncLibrary}/${settings.zoteroSyncCollection}` : settings.zoteroSyncLibrary);

export function zoteroSyncActive() {
  return settings.zoteroAutoSync && zoteroConfigured() && !!settings.zoteroSyncLibrary;
}

/** Fetch what changed in Zotero and update the sources. `quiet`: no toast when nothing happened. */
export async function syncZotero(quiet = true): Promise<void> {
  if (!zoteroSyncActive() || zsync.running || !db.ready) return;
  // with Google Drive sync, let it bring in the other devices' sources first,
  // so a source imported there is updated here instead of created twice
  for (let i = 0; i < 40 && (sync.status === 'syncing' || (sync.status === 'idle' && !sync.lastSync)); i++) await new Promise((r) => setTimeout(r, 500));
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  zsync.running = true;
  zsync.error = '';
  const key = scopeKey();
  const since = settings.zoteroSyncVersions[key] ?? 0;
  const lib = settings.zoteroSyncLibrary;
  const collection = settings.zoteroSyncCollection || undefined;
  try {
    const changed: ZItem[] = [];
    let offset = 0;
    let libVersion = 0;
    for (;;) {
      const r = await fetchItems(lib, { collection, since, start: offset });
      changed.push(...r.items);
      libVersion = Math.max(libVersion, r.version);
      offset += r.raw;
      if (!r.raw || offset >= r.total) break;
    }
    let added = 0;
    let updated = 0;
    // sources you deleted here stay deleted
    const gone = deletedZoteroKeys();
    const wanted = changed.filter((it) => !gone.has(`${lib}/${it.key}`));
    if (wanted.length) {
      const known = new Set(db.all('sources').filter((s) => s.zoteroLibrary === lib).map((s) => s.zoteroKey));
      db.batch('zotero sync', () => {
        for (const it of wanted) {
          if (known.has(it.key)) updated++;
          else added++;
          upsertSource(it, true, settings.zoteroSyncTags);
        }
      });
    }
    const version = Math.max(since, libVersion, ...changed.map((it) => it.version));
    settings.zoteroSyncVersions = { ...settings.zoteroSyncVersions, [key]: version };
    zsync.added = added;
    zsync.updated = updated;
    zsync.lastRun = Date.now();
    if (added) ui.toast(t('Zotero: {n} new sources', { n: added }), { kind: 'ok' });
    else if (!quiet) ui.toast(updated ? t('Zotero: {n} sources updated', { n: updated }) : t('Zotero: everything up to date'), { kind: 'ok' }, 2500);
  } catch (e) {
    zsync.error = String((e as Error).message ?? e);
    if (!quiet) ui.toast(zsync.error, { kind: 'error' });
  } finally {
    zsync.running = false;
  }
}

/** Start the background sync: now, every 10 minutes, and when the app becomes visible again. */
export function startZoteroSync() {
  const tick = () => syncZotero();
  const back = () => {
    if (document.visibilityState === 'visible' && Date.now() - zsync.lastRun > ON_RETURN) tick();
  };
  $effect.root(() => {
    $effect(() => {
      // (re)start whenever the setup changes
      if (!db.ready || !zoteroSyncActive()) return;
      void scopeKey();
      setTimeout(tick, 1500);
      const iv = setInterval(tick, EVERY);
      return () => clearInterval(iv);
    });
  });
  document.addEventListener('visibilitychange', back);
  addEventListener('online', tick);
}
