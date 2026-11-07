import { db, byOrder, orderBetween } from './db.svelte';
import { t } from './i18n';
import type { Artifact, CSLItem, CSLName, Heading, LocatorLabel, Placement, Project, Source } from './types';
import { settings } from './settings.svelte';

// ---------------- projects ----------------
export const TEMPLATES: Record<string, { en: string[]; de: string[] }> = {
  blank: { en: [''], de: [''] },
  essay: { en: ['Introduction', 'Main part', 'Conclusion'], de: ['Einleitung', 'Hauptteil', 'Fazit'] },
  seminar: {
    en: ['Introduction', 'State of research', 'Theory & method', 'Analysis', 'Discussion', 'Conclusion'],
    de: ['Einleitung', 'Forschungsstand', 'Theorie & Methode', 'Analyse', 'Diskussion', 'Fazit']
  },
  imrad: {
    en: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion', 'Conclusion'],
    de: ['Abstract', 'Einleitung', 'Methoden', 'Ergebnisse', 'Diskussion', 'Fazit']
  },
  thesis: {
    en: ['Introduction', 'Literature review', 'Theoretical framework', 'Methodology', 'Findings', 'Discussion', 'Conclusion'],
    de: ['Einleitung', 'Literaturüberblick', 'Theoretischer Rahmen', 'Methodik', 'Ergebnisse', 'Diskussion', 'Fazit']
  }
};

export function createProject(title: string, template: string, lang: 'en' | 'de') {
  return db.batch('create project', () => {
    const p = db.create('projects', { title });
    const heads = TEMPLATES[template]?.[lang] ?? [''];
    heads.forEach((h, i) =>
      db.create('headings', { projectId: p.id, parentId: null, order: i + 1, title: h, body: '' })
    );
    return p;
  });
}

export function deleteProject(id: string) {
  db.batch('delete project', () => {
    for (const t of ['headings', 'placements', 'comments', 'snapshots', 'selections'] as const)
      for (const e of db.all(t)) if (e.projectId === id) db.remove(t, e.id);
    db.remove('projects', id);
  });
}

// ---------------- heading tree ----------------
export function children(projectId: string, parentId: string | null): Heading[] {
  return db
    .all('headings')
    .filter((h) => h.projectId === projectId && h.parentId === parentId)
    .sort(byOrder);
}

export function descendants(projectId: string, id: string): Heading[] {
  const out: Heading[] = [];
  const walk = (pid: string) => {
    for (const c of children(projectId, pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** Flattened tree in reading order, with depth and numbering like 1.2.3 */
export interface FlatHeading {
  h: Heading;
  depth: number;
  num: string;
  hasChildren: boolean;
}
export function flatten(projectId: string, collapsed?: Set<string>): FlatHeading[] {
  const all = db.all('headings').filter((h) => h.projectId === projectId);
  const byParent = new Map<string | null, Heading[]>();
  for (const h of all) {
    const k = h.parentId && all.some((x) => x.id === h.parentId) ? h.parentId : null;
    (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(h);
  }
  for (const l of byParent.values()) l.sort(byOrder);
  const out: FlatHeading[] = [];
  const walk = (pid: string | null, depth: number, prefix: string) => {
    (byParent.get(pid) ?? []).forEach((h, i) => {
      const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      const kids = byParent.get(h.id) ?? [];
      out.push({ h, depth, num, hasChildren: kids.length > 0 });
      if (!collapsed?.has(h.id)) walk(h.id, depth + 1, num);
    });
  };
  walk(null, 0, '');
  return out;
}

export function addHeading(projectId: string, parentId: string | null, afterId?: string | null, title = '') {
  const sibs = children(projectId, parentId);
  let order: number;
  if (afterId) {
    const i = sibs.findIndex((s) => s.id === afterId);
    order = orderBetween(sibs[i]?.order, sibs[i + 1]?.order);
  } else order = orderBetween(sibs[sibs.length - 1]?.order, undefined);
  return db.create('headings', { projectId, parentId, order, title, body: '' });
}

export function addChildHeading(h: Heading, title = '') {
  const kids = children(h.projectId, h.id);
  return db.create('headings', {
    projectId: h.projectId,
    parentId: h.id,
    order: orderBetween(kids[kids.length - 1]?.order, undefined),
    title,
    body: ''
  });
}

export function indent(h: Heading): boolean {
  const sibs = children(h.projectId, h.parentId);
  const i = sibs.findIndex((s) => s.id === h.id);
  if (i <= 0) return false;
  const prev = sibs[i - 1];
  const kids = children(h.projectId, prev.id);
  db.update('headings', h.id, { parentId: prev.id, order: orderBetween(kids[kids.length - 1]?.order, undefined) });
  return true;
}

export function outdent(h: Heading): boolean {
  if (!h.parentId) return false;
  const parent = db.get('headings', h.parentId);
  if (!parent) return false;
  const sibs = children(h.projectId, parent.parentId);
  const i = sibs.findIndex((s) => s.id === parent.id);
  db.update('headings', h.id, { parentId: parent.parentId, order: orderBetween(sibs[i]?.order, sibs[i + 1]?.order) });
  return true;
}

export function moveUpDown(h: Heading, dir: -1 | 1) {
  const sibs = children(h.projectId, h.parentId);
  const i = sibs.findIndex((s) => s.id === h.id);
  const j = i + dir;
  if (j < 0 || j >= sibs.length) return;
  const other = sibs[j];
  const k = j + dir;
  const order = dir < 0 ? orderBetween(sibs[k]?.order, other.order) : orderBetween(other.order, sibs[k]?.order);
  db.update('headings', h.id, { order });
}

export function moveHeading(id: string, targetId: string, pos: 'before' | 'after' | 'inside') {
  const h = db.get('headings', id);
  const t = db.get('headings', targetId);
  if (!h || !t || id === targetId) return;
  if (descendants(h.projectId, h.id).some((d) => d.id === targetId)) return;
  if (pos === 'inside') {
    const kids = children(t.projectId, t.id).filter((k) => k.id !== id);
    db.update('headings', id, { parentId: t.id, order: orderBetween(kids[kids.length - 1]?.order, undefined) });
    return;
  }
  const sibs = children(t.projectId, t.parentId).filter((s) => s.id !== id);
  const i = sibs.findIndex((s) => s.id === t.id);
  const order = pos === 'before' ? orderBetween(sibs[i - 1]?.order, t.order) : orderBetween(t.order, sibs[i + 1]?.order);
  db.update('headings', id, { parentId: t.parentId, order });
}

/**
 * Outliner "Enter": split the title at the caret. Text after the caret moves to
 * a new heading (first child if `intoChildren`, else next sibling). With the caret
 * at position 0 of a non-empty title, an empty heading is inserted *before*.
 * Returns the id that should receive focus.
 */
export function splitHeading(h: Heading, value: string, pos: number, intoChildren: boolean): string {
  return db.batch('new heading', () => {
    const rest = value.slice(pos);
    if (pos === 0 && value) {
      const n = addHeading(h.projectId, h.parentId, h.id);
      moveHeading(n.id, h.id, 'before');
      return h.id;
    }
    if (rest) db.update('headings', h.id, { title: value.slice(0, pos) });
    if (intoChildren) {
      const first = children(h.projectId, h.id)[0];
      const n = addChildHeading(h, rest);
      if (first) moveHeading(n.id, first.id, 'before');
      return n.id;
    }
    return addHeading(h.projectId, h.parentId, h.id, rest).id;
  });
}

export function deleteHeading(h: Heading) {
  db.batch('delete heading', () => {
    const all = [h, ...descendants(h.projectId, h.id)];
    const ids = new Set(all.map((x) => x.id));
    for (const p of db.all('placements')) if (ids.has(p.headingId)) db.remove('placements', p.id);
    for (const c of db.all('comments')) if (ids.has(c.targetId)) db.remove('comments', c.id);
    for (const x of all) db.remove('headings', x.id);
  });
}

// ---------------- placements ----------------
export function placementsOf(headingId: string): Placement[] {
  return db
    .all('placements')
    .filter((p) => p.headingId === headingId && db.get('artifacts', p.artifactId))
    .sort(byOrder);
}

export function place(projectId: string, headingId: string, artifactId: string, beforeId?: string | null) {
  const list = placementsOf(headingId);
  const existing = list.find((p) => p.artifactId === artifactId);
  let order: number;
  if (beforeId) {
    const i = list.findIndex((p) => p.id === beforeId);
    order = orderBetween(list[i - 1]?.order, list[i]?.order);
  } else order = orderBetween(list[list.length - 1]?.order, undefined);
  if (existing) {
    db.update('placements', existing.id, { order });
    return existing;
  }
  return db.create('placements', { projectId, headingId, artifactId, order });
}

export function movePlacement(id: string, headingId: string, beforeId?: string | null) {
  const p = db.get('placements', id);
  if (!p) return;
  const list = placementsOf(headingId).filter((x) => x.id !== id);
  const dup = list.find((x) => x.artifactId === p.artifactId);
  if (dup) {
    db.remove('placements', id);
    return;
  }
  let order: number;
  if (beforeId) {
    const i = list.findIndex((x) => x.id === beforeId);
    order = orderBetween(list[i - 1]?.order, list[i]?.order);
  } else order = orderBetween(list[list.length - 1]?.order, undefined);
  db.update('placements', id, { headingId, order });
}

export function usageCount(artifactId: string, projectId?: string): number {
  return db.all('placements').filter((p) => p.artifactId === artifactId && (!projectId || p.projectId === projectId) && db.get('headings', p.headingId)).length;
}

export function deleteArtifact(a: Artifact) {
  db.batch('delete item', () => {
    for (const p of db.all('placements')) if (p.artifactId === a.id) db.remove('placements', p.id);
    for (const x of db.all('selections')) if (x.refType === 'artifact' && x.refId === a.id) db.remove('selections', x.id);
    if (a.imageId) db.remove('blobs', a.imageId);
    db.remove('artifacts', a.id);
  });
}

export function deleteSource(s: Source, withArtifacts: boolean) {
  db.batch('delete source', () => {
    for (const a of db.all('artifacts'))
      if (a.sourceId === s.id) {
        if (withArtifacts) deleteArtifact(a);
        else db.update('artifacts', a.id, { sourceId: null });
      } else if (a.original?.sourceId === s.id) db.update('artifacts', a.id, { original: null });
    for (const x of db.all('selections')) if (x.refType === 'source' && x.refId === s.id) db.remove('selections', x.id);
    db.remove('sources', s.id);
  });
}

/**
 * Move every item of `from` to `into` and delete `from` – e.g. to replace a
 * placeholder source with the real one imported from Zotero. Tags and notes
 * of the placeholder are kept on the target.
 */
export function mergeSource(from: Source, into: Source): number {
  if (from.id === into.id) return 0;
  return db.batch('merge source', () => {
    let n = 0;
    for (const a of db.all('artifacts'))
      if (a.sourceId === from.id) {
        db.update('artifacts', a.id, { sourceId: into.id });
        n++;
      } else if (a.original?.sourceId === from.id) db.update('artifacts', a.id, { original: { ...a.original, sourceId: into.id } });
    for (const x of db.all('selections'))
      if (x.refType === 'source' && x.refId === from.id) {
        const dup = db.all('selections').some((y) => y.refType === 'source' && y.refId === into.id && y.projectId === x.projectId);
        if (dup) db.remove('selections', x.id);
        else db.update('selections', x.id, { refId: into.id });
      }
    const tags = [...new Set([...into.tags, ...from.tags])];
    const note = [into.note, from.note].filter((x) => x?.trim()).join('\n\n');
    db.update('sources', into.id, { tags, note: note || undefined, reading: into.reading ?? from.reading });
    db.remove('sources', from.id);
    return n;
  });
}

// ---------------- project selection ("Auswahl") ----------------
const sel = (projectId: string, refType: 'source' | 'artifact', refId: string) =>
  db.all('selections').find((x) => x.projectId === projectId && x.refType === refType && x.refId === refId);

export function isPlaced(artifactId: string, projectId: string): boolean {
  return usageCount(artifactId, projectId) > 0;
}
/** Is the source in the Zotero collection linked to the project? */
export function inLinkedCollection(s: Source | undefined, p: Project | undefined): boolean {
  const z = p?.zoteroCollection;
  if (!z || !s?.zoteroKey || s.zoteroLibrary !== z.library) return false;
  return !!s.zoteroCollections?.some((k) => z.keys.includes(k));
}
/** How a whole source belongs to a project: picked here, through the linked Zotero collection – or not. */
export function sourceVia(sourceId: string, projectId: string): 'picked' | 'collection' | null {
  const own = sel(projectId, 'source', sourceId);
  if (own) return own.excluded ? null : 'picked';
  return inLinkedCollection(db.get('sources', sourceId), db.get('projects', projectId)) ? 'collection' : null;
}
export function sourceSelected(sourceId: string, projectId: string): boolean {
  return sourceVia(sourceId, projectId) !== null;
}
/** Sources that belong to the project as a whole (picked or through the linked collection). */
export function projectSources(projectId: string): Source[] {
  return db.all('sources').filter((s) => sourceSelected(s.id, projectId));
}
/** Why an item belongs to a project: placed, picked individually, via its source – or not at all. */
export function membership(a: Artifact, projectId: string): 'placed' | 'item' | 'source' | null {
  if (isPlaced(a.id, projectId)) return 'placed';
  const own = sel(projectId, 'artifact', a.id);
  if (own && !own.excluded) return 'item';
  if (own?.excluded) return null;
  if (a.sourceId && sourceSelected(a.sourceId, projectId)) return 'source';
  return null;
}
export const inProject = (a: Artifact, projectId: string) => membership(a, projectId) !== null;

export function projectArtifacts(projectId: string): Artifact[] {
  return db.all('artifacts').filter((a) => inProject(a, projectId));
}

export function addToProject(projectId: string, refType: 'source' | 'artifact', refId: string) {
  db.batch('add to project', () => {
    const cur = sel(projectId, refType, refId);
    const linked = refType === 'source' && inLinkedCollection(db.get('sources', refId), db.get('projects', projectId));
    if (cur) {
      // back to "through the collection" when it is in the linked collection anyway
      if (cur.excluded && linked) db.remove('selections', cur.id);
      else if (cur.excluded) db.update('selections', cur.id, { excluded: false });
    } else if (!linked) db.create('selections', { projectId, refType, refId });
    // choosing a whole source re-includes its hidden items
    if (refType === 'source')
      for (const x of db.all('selections'))
        if (x.projectId === projectId && x.refType === 'artifact' && x.excluded && db.get('artifacts', x.refId)?.sourceId === refId) db.remove('selections', x.id);
  });
}

/** Remove an item from the selection (placements stay; use them to keep it). */
export function removeFromProject(projectId: string, a: Artifact) {
  db.batch('remove from project', () => {
    const own = sel(projectId, 'artifact', a.id);
    if (a.sourceId && sourceSelected(a.sourceId, projectId)) {
      if (own) db.update('selections', own.id, { excluded: true });
      else db.create('selections', { projectId, refType: 'artifact', refId: a.id, excluded: true });
    } else if (own) db.remove('selections', own.id);
  });
}

export function removeSourceFromProject(projectId: string, sourceId: string) {
  db.batch('remove source from project', () => {
    for (const x of db.all('selections')) {
      if (x.projectId !== projectId) continue;
      if (x.refType === 'source' && x.refId === sourceId) db.remove('selections', x.id);
      else if (x.refType === 'artifact' && x.excluded && db.get('artifacts', x.refId)?.sourceId === sourceId) db.remove('selections', x.id);
    }
    // in the linked Zotero collection: remember that it is not wanted here
    if (inLinkedCollection(db.get('sources', sourceId), db.get('projects', projectId)))
      db.create('selections', { projectId, refType: 'source', refId: sourceId, excluded: true });
  });
}

/** Projects an item is part of (placed or selected), for the library overview. */
export function projectsOf(a: Artifact) {
  return db.all('projects').filter((p) => inProject(a, p.id));
}

// ---------------- labels ----------------
export function nameStr(n: CSLName): string {
  return n.literal ?? [n.given, n.family].filter(Boolean).join(' ');
}
export function familyStr(n: CSLName): string {
  return n.literal ?? n.family ?? n.given ?? '';
}
export function authorsShort(c: CSLItem): string {
  const a = c.author?.length ? c.author : (c.editor ?? []);
  if (!a.length) return '';
  if (a.length === 1) return familyStr(a[0]);
  if (a.length === 2) return `${familyStr(a[0])} & ${familyStr(a[1])}`;
  return `${familyStr(a[0])} et al.`;
}
export function authorsFull(c: CSLItem): string {
  const a = c.author?.length ? c.author : (c.editor ?? []);
  return a.map(nameStr).join('; ');
}
export function yearOf(c: CSLItem): string {
  const d = c.issued;
  if (!d) return '';
  const y = d['date-parts']?.[0]?.[0];
  if (y) return String(y);
  const m = (d.raw ?? d.literal ?? '').match(/\d{4}/);
  return m ? m[0] : '';
}
export function sourceLabel(s: Source | undefined): string {
  if (!s) return '';
  const a = authorsShort(s.csl);
  const y = yearOf(s.csl);
  if (a || y) return `${a || s.csl.title?.slice(0, 30) || '?'}${y ? ' ' + y : ''}`;
  return s.csl.title ?? '(untitled)';
}
/** Short forms of the locator labels, as shown in the app ("p. 12", "col. 1121"). */
const LABEL_SHORT: Record<string, [string, string]> = {
  column: ['col.', 'cols.'],
  paragraph: ['para.', 'paras.'],
  section: ['sec.', 'secs.'],
  line: ['l.', 'll.'],
  chapter: ['ch.', 'chs.'],
  volume: ['vol.', 'vols.'],
  folio: ['fol.', 'fols.'],
  note: ['n.', 'nn.'],
  number: ['no.', 'nos.'],
  verse: ['v.', 'vv.'],
  'sub-verbo': ['s.v.', 's.vv.'],
  figure: ['fig.', 'figs.'],
  table: ['tbl.', 'tbls.']
};
export function locatorText(page: string | undefined, label?: LocatorLabel): string {
  if (!page?.trim()) return '';
  const many = /[-–,&]/.test(page);
  const l = !label || label === 'page' ? (many ? t('pp.') : t('p.')) : t(LABEL_SHORT[label]?.[many ? 1 : 0] ?? label);
  return `${l} ${page.trim()}`;
}
export function shortCite(a: Artifact): string {
  const s = db.get('sources', a.sourceId);
  if (!s) return '';
  const loc = locatorText(a.page, a.pageLabel);
  const main = loc ? `${sourceLabel(s)}, ${loc}` : sourceLabel(s);
  const o = a.original ? db.get('sources', a.original.sourceId) : undefined;
  if (!o) return main;
  const oloc = locatorText(a.original!.page, a.original!.pageLabel);
  return `${sourceLabel(o)}${oloc ? ', ' + oloc : ''}, ${t('cited in')} ${main}`;
}
/** Sources a quote stands for in a bibliography: its source and, if wanted, the original it quotes. */
export function sourcesOf(a: Artifact, withOriginal = settings.secondaryInBib): Source[] {
  const out = [db.get('sources', a.sourceId), withOriginal && a.original ? db.get('sources', a.original.sourceId) : undefined];
  return out.filter((s): s is Source => !!s);
}
export function artifactLabel(a: Artifact, n = 90): string {
  const t = (a.title || a.text || a.comment || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// ---------------- stats ----------------
export function wordCount(s: string): number {
  const m = s.replace(/[#>*_`~\-[\]()]/g, ' ').match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}
export function headingWords(projectId: string, h: Heading): number {
  return [h, ...descendants(projectId, h.id)].reduce((n, x) => n + wordCount(x.body), 0);
}

// ---------------- tags ----------------
/** Bookkeeping tags the app sets itself (the demo's marker); never shown. */
const HIDDEN_TAGS = new Set(['structed-demo']);
export const visibleTags = (tags: string[] | undefined) => (tags ?? []).filter((x) => !HIDDEN_TAGS.has(x));

export function allTagNames(): string[] {
  const s = new Set<string>();
  for (const a of db.all('artifacts')) a.tags?.forEach((t) => s.add(t));
  for (const x of db.all('sources')) x.tags?.forEach((t) => s.add(t));
  for (const t of db.all('tags')) s.add(t.name);
  return [...s].filter((x) => !HIDDEN_TAGS.has(x)).sort((a, b) => a.localeCompare(b));
}
export function tagColor(name: string): string | undefined {
  return db.all('tags').find((t) => t.name === name)?.color;
}
export function setTagColor(name: string, color: string) {
  const t = db.all('tags').find((x) => x.name === name);
  if (t) db.update('tags', t.id, { color });
  else db.create('tags', { name, color });
}

export function emptySourceCsl(): CSLItem {
  return { id: '', type: 'book', title: '', author: [] };
}
