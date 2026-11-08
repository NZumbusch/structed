// Small typing helpers for the Write editors, like the ones Word applies on its own:
// typographic quotes and ellipsis, non-breaking spaces after "S.", "§", inside "z. B.",
// and highlighting for the find bar. Backspace right after an automatic change undoes it.
import { Extension, InputRule } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { settings, textLang } from './settings.svelte';

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
}

/** All matches of `query` in the text of `doc`; quotes and footnotes are not part of the text. */
export function findIn(doc: PMNode, query: string, caseSensitive = false): Match[] {
  if (!query) return [];
  const q = caseSensitive ? query : query.toLowerCase();
  const out: Match[] = [];
  doc.descendants((block, start) => {
    if (!block.isTextblock) return true;
    let text = '';
    const at: number[] = [];
    block.forEach((child, offset) => {
      const p = start + 1 + offset;
      if (child.isText) {
        const s = child.text ?? '';
        for (let i = 0; i < s.length; i++) at.push(p + i);
        text += s;
      } else {
        at.push(p);
        text += '\ufffc';
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    if (hay.length !== text.length) return false; // rare case-mapping change of length: skip
    for (let i = hay.indexOf(q); i >= 0; i = hay.indexOf(q, i + Math.max(1, q.length))) out.push({ from: at[i], to: at[i + q.length - 1] + 1 });
    return false;
  });
  return out;
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
  return DecorationSet.create(
    doc,
    ms.map((m) => Decoration.inline(m.from, m.to, { class: s.current && m.from === s.current.from && m.to === s.current.to ? 'find-hit find-cur' : 'find-hit' }))
  );
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
            const cur = old.current && { from: tr.mapping.map(old.current.from), to: tr.mapping.map(old.current.to) };
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
