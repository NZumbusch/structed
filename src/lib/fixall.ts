// Fixing the typography of text written or imported before the typing helpers covered it:
// every text field of the library and the projects, as if it were typed now (see prosefield.ts).
// Nothing is changed until the user applies it; all of it is one undo step.
import { db } from './db.svelte';
import { fixSegments, fixTypography } from './prosefield';
import { footnoteContent, type PMNode } from './footnote';
import { artifactLabel } from './ops';
import type { TableName } from './types';

export type FixGroup = 'quotes' | 'notes' | 'outline' | 'text';
export interface FixChange {
  group: FixGroup;
  table: TableName;
  id: string;
  label: string;
  patch: Record<string, unknown>;
  /** one changed passage: [before, after] */
  example: [string, string];
}

/** The passage around the first change, before and after. */
function example(a: string, b: string): [string, string] {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let ea = a.length;
  let eb = b.length;
  while (ea > i && eb > i && a[ea - 1] === b[eb - 1]) ea--, eb--;
  const from = Math.max(0, i - 30);
  const cut = (s: string, end: number) => (from ? '…' : '') + s.slice(from, Math.min(s.length, end + 30)).replace(/\s+/g, ' ') + (end + 30 < s.length ? '…' : '');
  return [cut(a, ea), cut(b, eb)];
}

/** Inline nodes (a paragraph's content or a footnote's) with the typography fixed; null = unchanged. */
function fixInline(list: PMNode[]): PMNode[] | null {
  const parts = list.map((n) => (n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : '￼'));
  const fixed = fixSegments(parts, { end: true });
  let changed = false;
  const out: PMNode[] = [];
  list.forEach((n, i) => {
    if (n.type === 'text') {
      if (fixed[i] !== parts[i]) changed = true;
      if (fixed[i]) out.push({ ...n, text: fixed[i] });
      return;
    }
    if (n.type === 'footnote') {
      const inner = fixInline(footnoteContent(n.attrs ?? {}));
      if (inner) {
        changed = true;
        out.push({ ...n, attrs: { ...n.attrs, content: inner, before: '', quoteId: null, quoteText: null, after: '' } });
        return;
      }
    }
    out.push(n);
  });
  return changed ? out : null;
}

/** A section text (ProseMirror JSON) with the typography fixed; null = unchanged. */
export function fixDraft(json: string): string | null {
  let doc: PMNode;
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  let changed = false;
  const walk = (n: PMNode): PMNode => {
    if (!n.content) return n;
    if (n.type === 'paragraph' || n.type === 'heading') {
      const c = fixInline(n.content);
      if (!c) return n;
      changed = true;
      return { ...n, content: c };
    }
    return { ...n, content: n.content.map(walk) };
  };
  const out = walk(doc);
  return changed ? JSON.stringify(out) : null;
}

/** Plain text of a draft, for the example (text and footnotes). */
function draftPlain(json: string): string {
  let s = '';
  const walk = (n: PMNode) => {
    if (n.type === 'text') s += n.text ?? '';
    if (n.type === 'footnote') {
      s += ' [';
      footnoteContent(n.attrs ?? {}).forEach(walk);
      s += '] ';
    }
    n.content?.forEach(walk);
    if (n.type === 'paragraph') s += '\n';
  };
  try {
    walk(JSON.parse(json));
  } catch {
    /* not JSON */
  }
  return s;
}

/** Everything that would change, field by field. */
export function scanTypography(): FixChange[] {
  const out: FixChange[] = [];
  const add = (group: FixGroup, table: TableName, id: string, label: string, fields: Record<string, string | undefined>, md: string[] = []) => {
    const patch: Record<string, unknown> = {};
    let ex: [string, string] | null = null;
    for (const [k, v] of Object.entries(fields)) {
      if (!v) continue;
      const f = fixTypography(v, { markdown: md.includes(k) });
      if (f !== v) {
        patch[k] = f;
        ex ??= example(v, f);
      }
    }
    if (ex) out.push({ group, table, id, label, patch, example: ex });
  };
  for (const a of db.all('artifacts')) {
    if (!a.text && !a.comment) continue;
    const verbatim = a.kind === 'quote' || a.kind === 'paraphrase';
    add(verbatim ? 'quotes' : 'notes', 'artifacts', a.id, artifactLabel(a), verbatim ? { text: a.text, fullText: a.fullText } : { text: a.text }, a.kind === 'note' ? ['text'] : []);
    add('notes', 'artifacts', a.id, artifactLabel(a), { comment: a.comment, title: a.title });
  }
  for (const s of db.all('sources')) add('notes', 'sources', s.id, String(s.csl?.title ?? ''), { note: s.note });
  for (const c of db.all('comments')) add('notes', 'comments', c.id, c.text, { text: c.text });
  for (const p of db.all('placements')) add('notes', 'placements', p.id, p.note ?? '', { note: p.note });
  for (const p of db.all('projects')) {
    add('outline', 'projects', p.id, p.title, { title: p.title, subtitle: p.subtitle });
    if (p.cover) {
      const cover: Record<string, string> = {};
      let ex: [string, string] | null = null;
      for (const [k, v] of Object.entries(p.cover)) {
        cover[k] = v ? fixTypography(v) : v;
        if (cover[k] !== v) ex ??= example(v, cover[k]);
      }
      if (ex) out.push({ group: 'outline', table: 'projects', id: p.id, label: p.title, patch: { cover }, example: ex });
    }
  }
  for (const h of db.all('headings')) {
    add('outline', 'headings', h.id, h.title, { title: h.title, body: h.body }, ['body']);
    if (h.draft) {
      const d = fixDraft(h.draft);
      if (d) out.push({ group: 'text', table: 'headings', id: h.id, label: h.title, patch: { draft: d }, example: example(draftPlain(h.draft), draftPlain(d)) });
    }
  }
  return out;
}

/** Apply the chosen changes as one undo step; returns how many items changed. */
export function applyTypography(changes: FixChange[]): number {
  const merged = new Map<string, FixChange>();
  for (const c of changes) {
    const k = c.table + '/' + c.id;
    const m = merged.get(k);
    merged.set(k, m ? { ...m, patch: { ...m.patch, ...c.patch } } : c);
  }
  db.batch('fix typography', () => {
    for (const c of merged.values()) db.update(c.table, c.id, c.patch as never);
  });
  return merged.size;
}
