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
