// Zotero Web API v3 client (CORS-enabled, works directly from the browser).
import { settings } from './settings.svelte';
import { db } from './db.svelte';
import type { CSLItem, Source } from './types';

const BASE = 'https://api.zotero.org';

export interface ZLibrary {
  id: string; // "users/123" | "groups/456"
  name: string;
}
export interface ZCollection {
  key: string;
  name: string;
  parent: string | null;
  numItems: number;
}
export interface ZItem {
  key: string;
  library: string;
  version: number;
  itemType: string;
  title: string;
  creators: string;
  year: string;
  tags: string[];
  csl: CSLItem;
  numChildren: number;
}
export interface ZAnnotation {
  key: string;
  parentItem: string; // top-level item key
  type: 'highlight' | 'underline' | 'note' | 'image' | 'ink' | 'childnote';
  text: string;
  comment: string;
  color: string;
  page: string;
  sort: string;
  tags: string[];
}

export const ZCOLORS: Record<string, string> = {
  '#ffd400': 'yellow',
  '#ff6666': 'red',
  '#5fb236': 'green',
  '#2ea8e5': 'blue',
  '#a28ae5': 'purple',
  '#e56eee': 'magenta',
  '#f19837': 'orange',
  '#aaaaaa': 'gray'
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function z(path: string, attempt = 0): Promise<{ data: unknown; total: number; version: number }> {
  const r = await fetch(BASE + path, {
    headers: { 'Zotero-API-Key': settings.zoteroApiKey.trim(), 'Zotero-API-Version': '3' }
  });
  // Zotero asks clients to slow down with 429/503 + Retry-After, or a Backoff header
  if ((r.status === 429 || r.status === 503) && attempt < 4) {
    const wait = Number(r.headers.get('Retry-After') ?? r.headers.get('Backoff') ?? 2 ** attempt);
    await sleep(Math.min(30, wait || 1) * 1000);
    return z(path, attempt + 1);
  }
  if (r.status === 403) throw new Error('Zotero: access denied – check user ID and API key permissions.');
  if (r.status === 404) throw new Error('Zotero: library not found – check the user/group ID.');
  if (r.status === 429) throw new Error('Zotero: rate limited, try again in a minute.');
  if (!r.ok) throw new Error(`Zotero ${r.status}: ${await r.text()}`);
  const backoff = Number(r.headers.get('Backoff') ?? 0);
  if (backoff) await sleep(Math.min(30, backoff) * 1000);
  const data = await r.json();
  // If Total-Results is unreadable, a full page means "there may be more".
  const start = Number(new URLSearchParams(path.split('?')[1] ?? '').get('start') ?? 0);
  const header = r.headers.get('Total-Results');
  const n = Array.isArray(data) ? data.length : 1;
  const total = header !== null ? Number(header) : start + n + (n >= 100 ? 1 : 0);
  // library version of this answer (for incremental sync); 0 if the header is not readable
  const version = Number(r.headers.get('Last-Modified-Version') ?? 0) || 0;
  return { data, total, version };
}

/** Fetch every page of a list endpoint. */
async function all<T>(path: string, onPage?: (n: number, total: number) => void): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let start = 0; ; start += 100) {
    const { data, total } = await z(`${path}${sep}limit=100&start=${start}`);
    out.push(...(data as T[]));
    onPage?.(out.length, total);
    if (start + 100 >= total || !(data as T[]).length) break;
  }
  return out;
}

export function zoteroConfigured() {
  return !!settings.zoteroUserId.trim() && !!settings.zoteroApiKey.trim();
}

export async function libraries(): Promise<ZLibrary[]> {
  const out: ZLibrary[] = [{ id: `users/${settings.zoteroUserId.trim()}`, name: 'My Library' }];
  try {
    const { data } = await z(`/users/${settings.zoteroUserId.trim()}/groups?limit=100`);
    for (const g of data as { id: number; data: { name: string } }[]) out.push({ id: `groups/${g.id}`, name: g.data.name });
  } catch {
    /* key may lack group access */
  }
  for (const id of settings.zoteroGroups.split(',').map((s) => s.trim()).filter(Boolean))
    if (!out.some((l) => l.id === `groups/${id}`)) out.push({ id: `groups/${id}`, name: `Group ${id}` });
  return out;
}

export async function collections(lib: string): Promise<ZCollection[]> {
  const out: ZCollection[] = [];
  for (let start = 0; ; start += 100) {
    const { data, total } = await z(`/${lib}/collections?limit=100&start=${start}`);
    for (const c of data as { key: string; data: { name: string; parentCollection: string | false }; meta: { numItems?: number } }[])
      out.push({ key: c.key, name: c.data.name, parent: c.data.parentCollection || null, numItems: c.meta.numItems ?? 0 });
    if (start + 100 >= total) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function items(
  lib: string,
  opts: { collection?: string; q?: string; start?: number; since?: number }
): Promise<{ items: ZItem[]; total: number; raw: number; version: number }> {
  const base = opts.collection ? `/${lib}/collections/${opts.collection}/items/top` : `/${lib}/items/top`;
  const qs = new URLSearchParams({ format: 'json', include: 'data,csljson', limit: '100', start: String(opts.start ?? 0), sort: 'creator' });
  if (opts.q) qs.set('q', opts.q);
  // only items changed after this library version (incremental sync)
  if (opts.since) qs.set('since', String(opts.since));
  const { data, total, version } = await z(`${base}?${qs}`);
  const raw = (data as unknown[]).length; // before filtering out standalone attachments/notes
  const list = (data as { key: string; version: number; data: Record<string, unknown>; csljson: CSLItem; meta: { creatorSummary?: string; parsedDate?: string; numChildren?: number } }[])
    .filter((it) => it.data.itemType !== 'attachment' && it.data.itemType !== 'note')
    .map((it) => ({
      key: it.key,
      library: lib,
      version: it.version,
      itemType: String(it.data.itemType),
      title: String(it.data.title ?? ''),
      creators: it.meta.creatorSummary ?? '',
      year: (it.meta.parsedDate ?? '').slice(0, 4),
      tags: ((it.data.tags as { tag: string }[]) ?? []).map((t) => t.tag),
      csl: it.csljson,
      numChildren: it.meta.numChildren ?? 0
    }));
  return { items: list, total, raw, version };
}

function htmlToText(html: string): string {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('p,br,li,h1,h2,h3,h4,div').forEach((el) => el.append('\n'));
  return (d.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

type ZRaw = { key: string; data: Record<string, unknown> };

/** Only these attachment types can have annotations (Zotero API restriction). */
export function canHaveAnnotations(d: Record<string, unknown>): boolean {
  if (d.itemType !== 'attachment' || d.linkMode === 'linked_url') return false;
  const ct = String(d.contentType ?? '');
  if (ct === 'application/pdf' || ct === 'application/epub+zip') return true;
  return ct === 'text/html' && (d.linkMode === 'imported_url' || d.linkMode === 'imported_file');
}

function toAnnotation(a: ZRaw, parentItem: string): ZAnnotation {
  const d = a.data;
  return {
    key: a.key,
    parentItem,
    type: d.annotationType as ZAnnotation['type'],
    text: String(d.annotationText ?? ''),
    comment: String(d.annotationComment ?? ''),
    color: String(d.annotationColor ?? '').toLowerCase(),
    page: String(d.annotationPageLabel ?? ''),
    sort: String(d.annotationSortIndex ?? ''),
    tags: ((d.tags as { tag: string }[]) ?? []).map((t) => t.tag)
  };
}
function toChildNote(n: ZRaw, parentItem: string): ZAnnotation {
  return { key: n.key, parentItem, type: 'childnote', text: '', comment: htmlToText(String(n.data.note ?? '')), color: '', page: '', sort: 'zzz', tags: [] };
}

/** Highlights/notes for one top-level item (via its PDF/EPUB/snapshot attachments). */
export async function annotations(lib: string, itemKey: string, withNotes = true): Promise<ZAnnotation[]> {
  const out: ZAnnotation[] = [];
  const kids = await all<ZRaw>(`/${lib}/items/${itemKey}/children`);
  for (const k of kids) {
    if (k.data.itemType === 'note' && withNotes) out.push(toChildNote(k, itemKey));
    if (!canHaveAnnotations(k.data)) continue;
    for (const a of await all<ZRaw>(`/${lib}/items/${k.key}/children`))
      if (a.data.itemType === 'annotation') out.push(toAnnotation(a, itemKey));
  }
  return out.sort((a, b) => a.sort.localeCompare(b.sort));
}

/**
 * Highlights/notes for many items at once. For larger sets this reads all
 * annotations, attachments and notes of the library in a few paged requests and
 * matches them locally – far fewer requests than asking item by item.
 * Errors for single items are collected instead of aborting the whole import.
 */
export async function annotationsFor(
  lib: string,
  itemKeys: string[],
  onProgress?: (msg: string) => void,
  withNotes = true
): Promise<{ items: ZAnnotation[]; failed: { key: string; error: string }[] }> {
  const wanted = new Set(itemKeys);
  const failed: { key: string; error: string }[] = [];
  const items: ZAnnotation[] = [];
  if (itemKeys.length <= 8) {
    let i = 0;
    for (const key of itemKeys) {
      onProgress?.(`${++i}/${itemKeys.length}`);
      try {
        items.push(...(await annotations(lib, key, withNotes)));
      } catch (e) {
        failed.push({ key, error: String((e as Error).message ?? e) });
      }
    }
    return { items, failed };
  }
  // library-wide: attachments → parent item, then annotations → attachment
  const attParent = new Map<string, string>();
  for (const a of await all<ZRaw>(`/${lib}/items?itemType=attachment`, (n, t) => onProgress?.(`attachments ${n}/${t}`)))
    if (a.data.parentItem && canHaveAnnotations(a.data)) attParent.set(a.key, String(a.data.parentItem));
  for (const a of await all<ZRaw>(`/${lib}/items?itemType=annotation`, (n, t) => onProgress?.(`highlights ${n}/${t}`))) {
    const top = attParent.get(String(a.data.parentItem ?? ''));
    if (top && wanted.has(top)) items.push(toAnnotation(a, top));
  }
  if (withNotes)
    for (const n of await all<ZRaw>(`/${lib}/items?itemType=note`, (c, t) => onProgress?.(`notes ${c}/${t}`))) {
      const top = String(n.data.parentItem ?? '');
      if (wanted.has(top)) items.push(toChildNote(n, top));
    }
  items.sort((a, b) => (a.parentItem === b.parentItem ? a.sort.localeCompare(b.sort) : 0));
  return { items, failed };
}

/**
 * Zotero items whose source was deleted here ("library/key"). They are not imported
 * again automatically – only when picked explicitly in the import dialog.
 */
export function deletedZoteroKeys(): Set<string> {
  const live = new Set(db.all('sources').filter((s) => s.zoteroKey).map((s) => `${s.zoteroLibrary}/${s.zoteroKey}`));
  return new Set(
    db
      .deletedOf('sources')
      .filter((s) => s.zoteroKey)
      .map((s) => `${s.zoteroLibrary}/${s.zoteroKey}`)
      .filter((k) => !live.has(k))
  );
}

/** Create or update a Source from a Zotero item. */
export function upsertSource(it: ZItem, update = true, importTags = false): Source {
  const existing = db.all('sources').find((s) => s.zoteroKey === it.key && s.zoteroLibrary === it.library);
  const csl = { ...it.csl, id: it.key };
  if (existing) {
    if (update) db.update('sources', existing.id, { csl, tags: importTags ? [...new Set([...existing.tags, ...it.tags])] : existing.tags });
    return existing;
  }
  return db.create('sources', { csl, tags: importTags ? it.tags : [], zoteroKey: it.key, zoteroLibrary: it.library });
}

export function findDuplicate(c: CSLItem): Source | undefined {
  const doi = c.DOI?.toLowerCase();
  const ty = `${(c.title ?? '').toLowerCase().trim()}|${c.issued?.['date-parts']?.[0]?.[0] ?? ''}`;
  return db.all('sources').find((s) => (doi && s.csl.DOI?.toLowerCase() === doi) || `${(s.csl.title ?? '').toLowerCase().trim()}|${s.csl.issued?.['date-parts']?.[0]?.[0] ?? ''}` === ty);
}
