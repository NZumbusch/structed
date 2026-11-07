// Footnote content and linked-quote snippets, kept free of the editor library so the
// Word export can use them without loading TipTap.
import { db } from './db.svelte';
import { settings } from './settings.svelte';
import { citeText, marks, oneLine } from './citecache.svelte';

/** ProseMirror JSON, as stored in drafts. */
export interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: PMNode[];
}

/**
 * A quote as normal, editable text („…“, italic per settings) followed by a linked
 * citation – for shortened or adapted quotes ([…], [sic], own additions).
 */
export function editableQuote(id: string, text?: string): PMNode[] {
  const a = db.get('artifacts', id);
  const [l, r] = marks();
  const q = oneLine(text ?? a?.text ?? '');
  const italic = settings.quoteItalic ? [{ type: 'italic' }] : [];
  return [
    { type: 'text', text: l },
    ...(q ? [{ type: 'text', text: q, marks: italic }] : []),
    { type: 'text', text: r + ' ' },
    ...(a?.sourceId ? [{ type: 'quoteRef', attrs: { id, mode: 'cite' } }] : [])
  ];
}

/**
 * The inline content of a footnote: free text with any number of linked quotes and
 * citations. Footnotes from before (text before, one quote, text after) are converted.
 */
export function footnoteContent(attrs: Record<string, unknown> | undefined): PMNode[] {
  if (Array.isArray(attrs?.content)) return attrs.content as PMNode[];
  const out: PMNode[] = [];
  const before = String(attrs?.before ?? '').trim();
  const after = String(attrs?.after ?? '').trim();
  const id = attrs?.quoteId ? String(attrs.quoteId) : '';
  if (before) out.push({ type: 'text', text: before + (id ? ' ' : '') });
  if (id) {
    if (attrs?.quoteText) out.push(...editableQuote(id, String(attrs.quoteText)));
    else out.push({ type: 'quoteRef', attrs: { id, mode: 'inline' } });
  }
  if (after) out.push({ type: 'text', text: (id || before ? ' ' : '') + after });
  return out;
}

/** Footnote as plain text (tooltip, search): quotes with their citations, live. */
export function footnotePlain(content: PMNode[]): string {
  const [l, r] = marks();
  return content
    .map((n) => {
      if (n.type === 'text') return n.text ?? '';
      if (n.type === 'hardBreak') return ' ';
      if (n.type === 'quoteRef') {
        const a = db.get('artifacts', String(n.attrs?.id));
        if (!a) return '';
        const c = citeText(a);
        return n.attrs?.mode === 'cite' ? c : `${l}${oneLine(a.text)}${r}${c ? ' ' + c : ''}`;
      }
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ids of the library items cited anywhere in a project's text (main text and footnotes). */
export function citedIds(projectId: string): Map<string, number> {
  const n = new Map<string, number>();
  const add = (id: unknown) => id && n.set(String(id), (n.get(String(id)) ?? 0) + 1);
  const walk = (x: PMNode) => {
    if (x.type === 'quoteRef' || x.type === 'quoteBlock') add(x.attrs?.id);
    if (x.type === 'footnote') footnoteContent(x.attrs).forEach(walk);
    x.content?.forEach(walk);
  };
  for (const h of db.all('headings'))
    if (h.projectId === projectId && h.draft)
      try {
        walk(JSON.parse(h.draft));
      } catch {
        /* malformed */
      }
  return n;
}

// ---------------- copying text out of the editor ----------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const supNum = (n: number) => String(n).split('').map((d) => SUP[+d]).join('');

/**
 * A selection as the clipboard gets it: quotes with their citations, footnotes numbered
 * with their text below – as formatted HTML (Word, mail, docs) and as plain text.
 */
export function toClipboard(nodes: PMNode[]): { html: string; text: string } {
  const notes: { html: string; text: string }[] = [];
  const [l, r] = marks();
  const inline = (list: PMNode[] | undefined): { html: string; text: string } => {
    let html = '';
    let text = '';
    for (const n of list ?? []) {
      if (n.type === 'text') {
        let h = esc(n.text ?? '');
        for (const m of n.marks ?? []) {
          if (m.type === 'bold') h = `<strong>${h}</strong>`;
          else if (m.type === 'italic') h = `<em>${h}</em>`;
          else if (m.type === 'underline') h = `<u>${h}</u>`;
        }
        html += h;
        text += n.text ?? '';
      } else if (n.type === 'hardBreak') {
        html += '<br>';
        text += '\n';
      } else if (n.type === 'quoteRef') {
        const a = db.get('artifacts', String(n.attrs?.id));
        if (!a) continue;
        const c = citeText(a);
        if (n.attrs?.mode === 'cite') {
          html += esc(c);
          text += c;
        } else {
          const q = oneLine(a.text);
          html += `${l}${settings.quoteItalic ? `<em>${esc(q)}</em>` : esc(q)}${r}${c ? ' ' + esc(c) : ''}`;
          text += `${l}${q}${r}${c ? ' ' + c : ''}`;
        }
      } else if (n.type === 'footnote') {
        const body = inline(footnoteContent(n.attrs));
        notes.push(body);
        html += `<sup>${notes.length}</sup>`;
        text += supNum(notes.length);
      }
    }
    return { html, text };
  };
  const htmlParts: string[] = [];
  const textParts: string[] = [];
  const block = (b: PMNode) => {
    if (b.type === 'paragraph') {
      const x = inline(b.content);
      htmlParts.push(`<p>${x.html}</p>`);
      textParts.push(x.text);
    } else if (b.type === 'blockquote') {
      const inner = (b.content ?? []).map((p) => inline(p.content));
      htmlParts.push(`<blockquote>${inner.map((x) => `<p>${x.html}</p>`).join('')}</blockquote>`);
      textParts.push(inner.map((x) => '    ' + x.text).join('\n'));
    } else if (b.type === 'bulletList' || b.type === 'orderedList') {
      const tag = b.type === 'bulletList' ? 'ul' : 'ol';
      const items = (b.content ?? []).map((li) => (li.content ?? []).map((p) => inline(p.content)));
      htmlParts.push(`<${tag}>${items.map((ps) => `<li>${ps.map((x) => x.html).join('<br>')}</li>`).join('')}</${tag}>`);
      textParts.push(items.map((ps, i) => `${b.type === 'bulletList' ? '•' : i + 1 + '.'} ${ps.map((x) => x.text).join(' ')}`).join('\n'));
    } else if (b.type === 'quoteBlock') {
      const a = db.get('artifacts', String(b.attrs?.id));
      if (!a) return;
      const c = citeText(a);
      htmlParts.push(`<blockquote><p>${l}${esc(a.text.trim())}${r}</p>${c ? `<p>${esc(c)}</p>` : ''}</blockquote>`);
      textParts.push(`    ${l}${a.text.trim()}${r}${c ? '\n    ' + c : ''}`);
    } else if (b.content) b.content.forEach(block);
  };
  // a selection inside one paragraph comes as inline nodes
  if (nodes.every((n) => n.type === 'text' || n.type === 'hardBreak' || n.type === 'quoteRef' || n.type === 'footnote')) {
    const x = inline(nodes);
    htmlParts.push(x.html);
    textParts.push(x.text);
  } else nodes.forEach(block);
  let html = htmlParts.join('');
  let text = textParts.join('\n\n');
  if (notes.length) {
    html += '<hr>' + notes.map((x, i) => `<p><sup>${i + 1}</sup> ${x.html}</p>`).join('');
    text += '\n\n' + notes.map((x, i) => `${supNum(i + 1)} ${x.text}`).join('\n');
  }
  return { html, text };
}

/** Ids of library items cited in any project's text. */
export function citedAnywhere(): Set<string> {
  const ids = new Set<string>();
  for (const p of db.all('projects')) for (const id of citedIds(p.id).keys()) ids.add(id);
  return ids;
}

/**
 * Quotes imported from Zotero highlights that are not used anywhere: not placed under a
 * heading, not cited in a text, not picked for a project one by one.
 */
export function unusedImported(sourceId?: string) {
  const placed = new Set(db.all('placements').map((p) => p.artifactId));
  const picked = new Set(db.all('selections').filter((x) => x.refType === 'artifact').map((x) => x.refId));
  const cited = citedAnywhere();
  return db.all('artifacts').filter((a) => a.zoteroKey && (!sourceId || a.sourceId === sourceId) && !placed.has(a.id) && !picked.has(a.id) && !cited.has(a.id));
}
