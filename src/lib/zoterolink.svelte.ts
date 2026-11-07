// A project linked to a Zotero collection: every item in that collection (or one of its
// subcollections) belongs to the project. Which collections an item is in comes with every
// Zotero item, so the automatic sync keeps it current; `refreshLink` checks the collection
// itself (one request per collection), takes over items the sync has not brought in yet and
// notices items taken out of the collection in Zotero.
import { db } from './db.svelte';
import { collectionItemKeys, collections, deletedZoteroKeys, itemsByKey, pdfOf, upsertSource, zoteroConfigured, zoteroPdfUrl, zoteroSelectUrl } from './zotero';
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';
import { t } from './i18n';
import type { Project, Source, ZoteroLink } from './types';

const last = new Map<string, number>();
const running = new Set<string>();
export const zlink = $state({ error: '', checking: '' });

/** The collection and all its subcollections. */
function withChildren(key: string, cols: { key: string; parent: string | null }[]): string[] {
  const keys = [key];
  for (let i = 0; i < keys.length; i++) for (const c of cols) if (c.parent === keys[i]) keys.push(c.key);
  return keys;
}

export async function linkCollection(project: Project, library: string, key: string): Promise<number> {
  const cols = await collections(library);
  const c = cols.find((x) => x.key === key);
  const link: ZoteroLink = { library, key, name: c?.name ?? key, keys: withChildren(key, cols) };
  db.update('projects', project.id, { zoteroCollection: link });
  return refreshLink(db.get('projects', project.id)!, true);
}

export function unlinkCollection(project: Project) {
  db.batch('unlink collection', () => {
    db.update('projects', project.id, { zoteroCollection: null });
    // "not for this project" marks only meant something for the linked collection
    for (const x of db.all('selections')) if (x.projectId === project.id && x.refType === 'source' && x.excluded) db.remove('selections', x.id);
  });
}

/**
 * Bring the project's sources in line with the linked collection. Returns how many
 * sources are in it. `force` skips the "at most every 2 minutes" rule.
 */
export async function refreshLink(project: Project, force = false): Promise<number> {
  const z = project.zoteroCollection;
  if (!z || !zoteroConfigured() || running.has(project.id)) return 0;
  if (!force && Date.now() - (last.get(project.id) ?? 0) < 2 * 60_000) return 0;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
  running.add(project.id);
  last.set(project.id, Date.now());
  zlink.checking = project.id;
  zlink.error = '';
  try {
    const cols = await collections(z.library);
    if (!cols.some((c) => c.key === z.key)) throw new Error('Zotero: the linked collection was not found.');
    const keys = withChildren(z.key, cols);
    const name = cols.find((c) => c.key === z.key)!.name;
    const inCol = new Map<string, Set<string>>(); // item key → linked collections it is in
    for (const k of keys) for (const it of await collectionItemKeys(z.library, k)) (inCol.get(it) ?? inCol.set(it, new Set()).get(it)!).add(k);
    const gone = deletedZoteroKeys();
    const known = new Map(db.all('sources').filter((s) => s.zoteroLibrary === z.library && s.zoteroKey).map((s) => [s.zoteroKey!, s]));
    const missing = [...inCol.keys()].filter((k) => !known.has(k) && !gone.has(`${z.library}/${k}`));
    const fetched = missing.length ? await itemsByKey(z.library, missing) : [];
    db.batch('zotero collection', () => {
      if (name !== z.name || keys.join() !== z.keys.join()) db.update('projects', project.id, { zoteroCollection: { ...z, name, keys } });
      for (const it of fetched) upsertSource(it, true, settings.zoteroSyncTags);
      // the linked collections each known source is in, as Zotero sees it now
      for (const s of known.values()) {
        const now = inCol.get(s.zoteroKey!) ?? new Set<string>();
        const before = s.zoteroCollections ?? [];
        const next = [...before.filter((k) => !keys.includes(k)), ...now];
        if (next.length !== before.length || next.some((k) => !before.includes(k))) db.update('sources', s.id, { zoteroCollections: next });
      }
    });
    return inCol.size;
  } catch (e) {
    zlink.error = String((e as Error).message ?? e);
    return 0;
  } finally {
    running.delete(project.id);
    zlink.checking = '';
  }
}

/** Open the item's first PDF in the Zotero app – or, without one, show the item there. */
export async function openPdf(s: Source) {
  try {
    const k = await pdfOf(s);
    if (k) return void (location.href = zoteroPdfUrl(s, k));
    ui.toast(t('No PDF found – showing the item in Zotero'));
  } catch {
    /* offline: at least show the item */
  }
  location.href = zoteroSelectUrl(s);
}
