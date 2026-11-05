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

async function z(path: string): Promise<{ data: unknown; total: number }> {
  const r = await fetch(BASE + path, {
    headers: { 'Zotero-API-Key': settings.zoteroApiKey.trim(), 'Zotero-API-Version': '3' }
  });
  if (r.status === 403) throw new Error('Zotero: access denied – check user ID and API key permissions.');
  if (r.status === 404) throw new Error('Zotero: library not found – check the user/group ID.');
  if (r.status === 429) throw new Error('Zotero: rate limited, try again in a minute.');
  if (!r.ok) throw new Error(`Zotero ${r.status}: ${await r.text()}`);
  return { data: await r.json(), total: Number(r.headers.get('Total-Results') ?? 0) };
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

export async function items(lib: string, opts: { collection?: string; q?: string; start?: number }): Promise<{ items: ZItem[]; total: number }> {
  const base = opts.collection ? `/${lib}/collections/${opts.collection}/items/top` : `/${lib}/items/top`;
  const qs = new URLSearchParams({ format: 'json', include: 'data,csljson', limit: '100', start: String(opts.start ?? 0), sort: 'creator' });
  if (opts.q) qs.set('q', opts.q);
  const { data, total } = await z(`${base}?${qs}`);
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
  return { items: list, total };
}

function htmlToText(html: string): string {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('p,br,li,h1,h2,h3,h4,div').forEach((el) => el.append('\n'));
  return (d.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** All highlights/notes for a top-level item (via its PDF/EPUB attachments). */
export async function annotations(lib: string, itemKey: string, withNotes = true): Promise<ZAnnotation[]> {
  const out: ZAnnotation[] = [];
  const { data } = await z(`/${lib}/items/${itemKey}/children?limit=100`);
  const kids = data as { key: string; data: Record<string, unknown> }[];
  for (const k of kids) {
    if (k.data.itemType === 'note' && withNotes) {
      out.push({ key: k.key, parentItem: itemKey, type: 'childnote', text: '', comment: htmlToText(String(k.data.note ?? '')), color: '', page: '', sort: 'zzz', tags: [] });
    }
    if (k.data.itemType !== 'attachment') continue;
    for (let start = 0; ; start += 100) {
      const res = await z(`/${lib}/items/${k.key}/children?limit=100&start=${start}`);
      for (const a of res.data as { key: string; data: Record<string, unknown> }[]) {
        const d = a.data;
        if (d.itemType !== 'annotation') continue;
        out.push({
          key: a.key,
          parentItem: itemKey,
          type: d.annotationType as ZAnnotation['type'],
          text: String(d.annotationText ?? ''),
          comment: String(d.annotationComment ?? ''),
          color: String(d.annotationColor ?? '').toLowerCase(),
          page: String(d.annotationPageLabel ?? ''),
          sort: String(d.annotationSortIndex ?? ''),
          tags: ((d.tags as { tag: string }[]) ?? []).map((t) => t.tag)
        });
      }
      if (start + 100 >= res.total) break;
    }
  }
  return out.sort((a, b) => a.sort.localeCompare(b.sort));
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
