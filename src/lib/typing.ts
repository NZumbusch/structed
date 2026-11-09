// Small typing helpers for the Write editors, like the ones Word applies on its own:
// typographic quotes and ellipsis, non-breaking spaces after "S.", "§", inside "z. B.",
// and highlighting for the find bar. Backspace right after an automatic change undoes it.
import { Extension, InputRule } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { settings, textLang } from './settings.svelte';
import { footnoteContent } from './footnote';

export const NBSP = '\u00a0';

/** Quote characters for typing: [open double, close double, open single, close single]. */
export function typedQuotes(): [string, string, string, string] {
  let style: string = settings.quoteMarks;
  if (style === 'none') {
    const lang = textLang();
    style = lang.startsWith('en') ? 'en' : lang === 'de-CH' ? 'ch' : 'de';
  }
  if (style === 'en') return ['“', '”', '‘', '’'];
  if (style === 'ch') return ['«', '»', '‹', '›'];
  return ['„', '“', '‚', '‘'];
}

/** The character before `pos` in its textblock ('' at the start, U+FFFC for a quote or footnote). */
function charBefore(state: EditorState, pos: number): string {
  const $p = state.doc.resolve(pos);
  if ($p.parentOffset === 0) return '';
  return state.doc.textBetween(pos - 1, pos, '', '\ufffc');
}

/** After these a quote mark opens: start of the paragraph, spaces, brackets, dashes, other opening marks. */
const OPENS_AFTER = /^$|[\s([{\/\u2013\u2014-]|[„“‚‘«‹]/;

export const SmartQuotes = Extension.create({
  name: 'smartQuotes',
  addInputRules() {
    const quote = (single: boolean) =>
      new InputRule({
        find: single ? /'$/ : /"$/,
        handler: ({ state, range }) => {
          if (!settings.editorSmartQuotes) return null;
          const prev = charBefore(state, range.from);
          const [od, cd, os, cs] = typedQuotes();
          let q: string;
          if (single && /[\p{L}\p{N}]/u.test(prev)) q = '’'; // apostrophe: "don't", "Peter’s"
          else if (OPENS_AFTER.test(prev) && !(single ? [cs, '’'] : [cd]).includes(prev)) q = single ? os : od;
          else q = single ? cs : cd;
          state.tr.insertText(q, range.from, range.to);
        }
      });
    return [
      quote(false),
      quote(true),
      new InputRule({
        find: /\.\.\.$/,
        handler: ({ state, range }) => {
          if (!settings.editorSmartQuotes) return null;
          state.tr.insertText('…', range.from, range.to);
        }
      })
    ];
  }
});

/** Abbreviations that belong to the number or word after them ("S. 12", "§ 5", "Nr. 3"). */
const BEFORE = /(?<=^|[\s([„“"«‚‘‹])(?:S|Sp|Abs|Nr|Bd|Kap|Abb|Tab|Art|Anm|Bl|Hrsg|Jg|Vol|No|Fig|p|pp|ch)\. $|(?<=^|[\s([„“"«‚‘‹])§§? $/;
/** Two-part abbreviations: "z. B.", "d. h.", "u. a.", "i. d. R." */
const INNER = /(?<=^|[\s([„“"«‚‘‹])\p{L}\. \p{L}\.$/u;

export const NonBreaking = Extension.create({
  name: 'nonBreaking',
  addInputRules() {
    return [
      new InputRule({
        find: BEFORE,
        handler: ({ state, range }) => {
          if (!settings.editorNbsp) return null;
          state.tr.insertText(NBSP, range.to - 1, range.to); // the typed space (already in the range)
        }
      }),
      new InputRule({
        find: INNER,
        handler: ({ state, range }) => {
          if (!settings.editorNbsp) return null;
          state.tr.insertText(NBSP, range.from + 2, range.from + 3);
        }
      })
    ];
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-Space': () => this.editor.commands.insertContent(NBSP) };
  },
  addProseMirrorPlugins() {
    // a faint mark under each non-breaking space, so it can be told from a normal one
    return [
      new Plugin({
        key: new PluginKey('nbspMarks'),
        state: {
          init: (_, { doc }) => nbspDeco(doc),
          apply: (tr, old) => (tr.docChanged ? nbspDeco(tr.doc) : old)
        },
        props: {
          decorations(state) {
            return this.getState(state);
          }
        }
      })
    ];
  }
});

function nbspDeco(doc: PMNode) {
  const out: Decoration[] = [];
  doc.descendants((n, pos) => {
    if (!n.isText || !n.text?.includes(NBSP)) return;
    for (let i = n.text.indexOf(NBSP); i >= 0; i = n.text.indexOf(NBSP, i + 1)) out.push(Decoration.inline(pos + i, pos + i + 1, { class: 'nbsp' }));
  });
  return out.length ? DecorationSet.create(doc, out) : DecorationSet.empty;
}

// ---------------- find & replace ----------------

export interface Match {
  from: number;
  to: number;
  /** a hit inside the footnote at `from`: character range in the footnote's text */
  fn?: { start: number; end: number };
}

export const sameMatch = (a: Match | null | undefined, b: Match | null | undefined) =>
  !!a && !!b && a.from === b.from && a.to === b.to && a.fn?.start === b.fn?.start;

/** The footnote's text as one string, with each character's place (node index, offset); quotes are not text. */
function footnoteChars(content: PMNode[] | import('./footnote').PMNode[]) {
  let text = '';
  const at: [number, number][] = [];
  (content as import('./footnote').PMNode[]).forEach((n, i) => {
    if (n.type === 'text') {
      const s = n.text ?? '';
      for (let k = 0; k < s.length; k++) at.push([i, k]);
      text += s;
    } else {
      at.push([i, -1]);
      text += '\ufffc';
    }
  });
  return { text, at };
}

function indexesOf(hay: string, q: string): number[] {
  const out: number[] = [];
  for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + Math.max(1, q.length))) out.push(i);
  return out;
}

/**
 * All matches of `query` in the text of `doc`, in reading order: a footnote's hits come
 * where the footnote is. Linked quotes are not searched (their text lives in the library).
 */
export function findIn(doc: PMNode, query: string, caseSensitive = false): Match[] {
  if (!query) return [];
  const q = caseSensitive ? query : query.toLowerCase();
  const fold = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const out: Match[] = [];
  doc.descendants((block, start) => {
    if (!block.isTextblock) return true;
    let text = '';
    const at: number[] = [];
    /** footnote hits, by index in `text` */
    const notes: { i: number; hits: Match[] }[] = [];
    block.forEach((child, offset) => {
      const p = start + 1 + offset;
      if (child.isText) {
        const s = child.text ?? '';
        for (let i = 0; i < s.length; i++) at.push(p + i);
        text += s;
        return;
      }
      if (child.type.name === 'footnote') {
        const fc = footnoteChars(footnoteContent(child.attrs));
        const hay = fold(fc.text);
        if (hay.length === fc.text.length) {
          const hits = indexesOf(hay, q).map((i) => ({ from: p, to: p + 1, fn: { start: i, end: i + q.length } }));
          if (hits.length) notes.push({ i: text.length, hits });
        }
      }
      at.push(p);
      text += '\ufffc';
    });
    const hay = fold(text);
    if (hay.length !== text.length) return false; // rare case-mapping change of length: skip
    const mine = indexesOf(hay, q).map((i) => ({ i, m: { from: at[i], to: at[i + q.length - 1] + 1 } as Match }));
    const all = [...mine, ...notes.flatMap((n) => n.hits.map((m) => ({ i: n.i, m })))];
    all.sort((x, y) => x.i - y.i || (x.m.fn?.start ?? -1) - (y.m.fn?.start ?? -1));
    out.push(...all.map((x) => x.m));
    return false;
  });
  return out;
}

/** The footnote content with characters [start, end) of its text replaced (formatting of the first one kept). */
export function replaceInFootnote(content: import('./footnote').PMNode[], start: number, end: number, by: string) {
  const { at } = footnoteChars(content);
  const nodes = content.map((n) => ({ ...n }));
  const first = at[start];
  if (!first || first[1] < 0) return content;
  for (let k = end - 1; k >= start; k--) {
    const [i, off] = at[k];
    if (off < 0) continue;
    const t = nodes[i].text ?? '';
    nodes[i].text = t.slice(0, off) + (k === start ? by : '') + t.slice(off + 1);
  }
  return nodes.filter((n) => n.type !== 'text' || n.text);
}

/** Apply a replacement at a match (text or footnote) to a transaction. */
export function replaceMatch(tr: import('@tiptap/pm/state').Transaction, m: Match, by: string) {
  if (!m.fn) return tr.insertText(by, m.from, m.to);
  const node = tr.doc.nodeAt(m.from);
  if (!node || node.type.name !== 'footnote') return tr;
  const content = replaceInFootnote(footnoteContent(node.attrs), m.fn.start, m.fn.end, by);
  return tr.setNodeMarkup(m.from, undefined, { content, before: '', quoteId: null, quoteText: null, after: '' });
}

export const findKey = new PluginKey<FindState>('find');
interface FindState {
  query: string;
  caseSensitive: boolean;
  current: Match | null;
  deco: DecorationSet;
}

function findDeco(doc: PMNode, s: Omit<FindState, 'deco'>) {
  if (!s.query) return DecorationSet.empty;
  const ms = findIn(doc, s.query, s.caseSensitive);
  const out: Decoration[] = [];
  const notes = new Map<number, boolean>(); // footnote position → holds the current hit
  for (const m of ms) {
    const cur = sameMatch(m, s.current);
    if (m.fn) notes.set(m.from, (notes.get(m.from) ?? false) || cur);
    else out.push(Decoration.inline(m.from, m.to, { class: cur ? 'find-hit find-cur' : 'find-hit' }));
  }
  // a footnote with a hit: its marker is highlighted
  for (const [pos, cur] of notes) out.push(Decoration.node(pos, pos + 1, { class: cur ? 'find-fn find-cur' : 'find-fn' }));
  return DecorationSet.create(doc, out);
}

/** Highlights the find bar's matches; set the query with `setFind`. */
export const FindHighlight = Extension.create({
  name: 'findHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, current: null, deco: DecorationSet.empty }),
          apply(tr, old, _o, state) {
            const meta = tr.getMeta(findKey) as Omit<FindState, 'deco'> | undefined;
            if (meta) return { ...meta, deco: findDeco(state.doc, meta) };
            if (!tr.docChanged || !old.query) return old;
            const cur = old.current && { ...old.current, from: tr.mapping.map(old.current.from), to: tr.mapping.map(old.current.to) };
            const next = { ...old, current: cur };
            return { ...next, deco: findDeco(state.doc, next) };
          }
        },
        props: {
          decorations(state) {
            return findKey.getState(state)?.deco;
          }
        }
      })
    ];
  }
});
