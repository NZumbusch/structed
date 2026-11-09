// A word before a citation that belongs to it: "Vgl.", "s.", "siehe", "cf.", "see", "zit. nach"…
// It is stored on the citation (attribute `prefix` of a quoteRef) exactly as written, and shown
// in front of it everywhere (text, footnotes, copies, Word) – capitalised at the start of a
// footnote or sentence, never changed otherwise. Older texts that had the word as plain text
// in front of a citation are converted once (`migratePrefixes`), looking exactly the same after.
import { db } from './db.svelte';
import { takeSnapshot } from './backup';
import { t } from './i18n';
import { settings, textLang } from './settings.svelte';
import type { PMNode } from './footnote';

/** offered in the citation's menu (in the language of the citations) */
export function prefixChoices(): string[] {
  const de = (settings.citationLocale ?? 'de').startsWith('de') || textLang().startsWith('de');
  return de ? ['vgl.', 'siehe', 'ferner', 'zit. nach', 'ähnlich'] : ['cf.', 'see', 'see also', 'quoted in'];
}

/** The prefix as shown: with a capital at the start of a footnote/paragraph or after a full stop. */
export function prefixText(prefix: unknown, before: string | null): string {
  const p = typeof prefix === 'string' ? prefix.trim() : '';
  if (!p) return '';
  // '' = start of a paragraph or footnote; null = right after another citation or footnote
  const start = before === '' || (before != null && /[.!?…]["“”»«')\]]*\s*$/.test(before));
  return (start ? p[0].toUpperCase() + p.slice(1) : p) + ' ';
}

/** The text just before node `i` of an inline list ('' at the start, null after another node). */
export function textBefore(list: PMNode[], i: number): string | null {
  if (i === 0) return '';
  const p = list[i - 1];
  return p.type === 'text' ? (p.text ?? '') : null;
}

// ---------------- converting older texts ----------------

/** "Vgl. ", "vgl. ", "Vergleiche ", "siehe ", "s. ", "cf. ", "see " right before a citation */
const BEFORE = /(^|[\s(\[„“"‚'«»])(vgl\.|vergleiche|siehe|s\.|cf\.|see)(\s+)$/i;

/** "…, vgl. " → { keep: "…, ", prefix: "vgl." } when the text ends with such a word; else null */
export function splitPrefix(text: string): { keep: string; prefix: string } | null {
  const m = BEFORE.exec(text);
  return m ? { keep: text.slice(0, m.index + m[1].length), prefix: m[2] } : null;
}

function convertInline(list: PMNode[]): { list: PMNode[]; n: number } {
  let n = 0;
  const out: PMNode[] = [];
  for (const node of list) {
    let x = node;
    if (x.type === 'footnote' && Array.isArray(x.attrs?.content)) {
      const r = convertInline(x.attrs!.content as PMNode[]);
      if (r.n) {
        x = { ...x, attrs: { ...x.attrs, content: r.list } };
        n += r.n;
      }
    }
    const prev = out[out.length - 1];
    if (x.type === 'quoteRef' && x.attrs?.mode === 'cite' && !x.attrs?.prefix && prev?.type === 'text' && !prev.marks?.length) {
      const m = BEFORE.exec(prev.text ?? '');
      if (m) {
        const rest = (prev.text ?? '').slice(0, m.index + m[1].length);
        if (rest) out[out.length - 1] = { ...prev, text: rest };
        else out.pop();
        x = { ...x, attrs: { ...x.attrs, prefix: m[2] } };
        n++;
      }
    }
    out.push(x);
  }
  return { list: out, n };
}

function convertDoc(node: PMNode): { node: PMNode; n: number } {
  if (!node.content) return { node, n: 0 };
  const inline = node.content.some((c) => c.type === 'text' || c.type === 'quoteRef' || c.type === 'footnote' || c.type === 'hardBreak');
  if (inline) {
    const r = convertInline(node.content);
    return { node: r.n ? { ...node, content: r.list } : node, n: r.n };
  }
  let n = 0;
  const content = node.content.map((c) => {
    const r = convertDoc(c);
    n += r.n;
    return r.node;
  });
  return { node: n ? { ...node, content } : node, n };
}

/** Convert one draft (ProseMirror JSON); null when nothing changes. */
export function convertDraft(json: string): { draft: string; n: number } | null {
  try {
    const r = convertDoc(JSON.parse(json));
    return r.n ? { draft: JSON.stringify(r.node), n: r.n } : null;
  } catch {
    return null;
  }
}

/**
 * Once at start: in every project, a snapshot first, then words like "Vgl." in front of a
 * citation become its prefix. Nothing looks different afterwards. Returns how many citations.
 */
export function migratePrefixes(): number {
  const changes = db
    .all('headings')
    .map((h) => ({ h, r: h.draft ? convertDraft(h.draft) : null }))
    .filter((x) => x.r);
  if (!changes.length) return 0;
  let n = 0;
  db.batch('citation prefixes', () => {
    for (const pid of new Set(changes.map((x) => x.h.projectId))) takeSnapshot(pid, t('Before citation prefixes (automatic)'));
    for (const { h, r } of changes) {
      db.update('headings', h.id, { draft: r!.draft });
      n += r!.n;
    }
  });
  return n;
}
