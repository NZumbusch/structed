// Readability hints (off by default): very long sentences, a word repeated close by, and
// sentences in a row that start alike or say exactly the same. Small words ("der", "ist",
// "the") never count. Only shown in the editor; nothing is changed in the text.
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { settings } from './settings.svelte';
import { t } from './i18n';

/** words in a sentence from which it counts as long */
export const LONG_SENTENCE = 40;
/** a word counts as repeated when it comes back within this many words */
const NEAR = 25;

const STOP = new Set(
  (
    // German
    'aber als also am an auch auf aus bei beim bin bis bist da dabei damit dann dar darauf daran darum das dass dem den denn der des dessen deshalb die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen einer eines einige er es etwa etwas euch euer für gegen hat hatte hatten hier hin hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer ihres im immer in ins ist ja jede jedem jeden jeder jedes jedoch jene jenem jenen jener jenes kann kein keine keinem keinen keiner können könnte man manche mehr mein meine mich mir mit muss müssen nach nicht nichts noch nun nur ob oder ohne sehr sein seine seinem seinen seiner seines selbst sich sie sind so solche soll sollen sondern sowie über um und uns unser unter viel vom von vor wann war waren warum was weil welche welchem welchen welcher welches wenn wer werden wie wieder wir wird wo wurde wurden zu zum zur zwar zwischen sowohl bzw usw vgl etc '
    // English
    + 'a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your'
  ).split(/\s+/)
);

interface Word {
  w: string;
  from: number;
  to: number;
}
interface Sentence {
  words: Word[];
  text: string;
  from: number;
  to: number;
}

const key = (w: string) => {
  const l = w.toLowerCase();
  return l.length >= 7 ? l.slice(0, 6) : l; // "Gesellschaft" ~ "gesellschaftlich"
};

/** Sentences of one paragraph with document positions. */
function sentences(block: PMNode, start: number): Sentence[] {
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
      text += ' '; // a quote or footnote: not counted
    }
  });
  const out: Sentence[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["“”»«')\]]*|$)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const s0 = (m.index ?? 0) + lead;
    const body = raw.trim();
    if (!body) continue;
    const words: Word[] = [];
    for (const w of body.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
      const i = s0 + (w.index ?? 0);
      words.push({ w: w[0], from: at[i], to: at[i + w[0].length - 1] + 1 });
    }
    if (words.length) out.push({ words, text: body.toLowerCase().replace(/\s+/g, ' '), from: at[s0], to: at[s0 + body.length - 1] + 1 });
  }
  // abbreviations ("z. B.", "S. 12", "Dr.") end no sentence: join a "sentence" of one or two short words to the next
  const joined: Sentence[] = [];
  for (const s of out) {
    const prev = joined[joined.length - 1];
    if (prev && (prev.words.length <= 2 && prev.words.every((w) => w.w.length <= 3))) {
      joined[joined.length - 1] = { words: [...prev.words, ...s.words], text: prev.text + ' ' + s.text, from: prev.from, to: s.to };
    } else joined.push(s);
  }
  return joined;
}

export function hintDecorations(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  const seenSentence = new Map<string, number>();
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true;
    const ss = sentences(block, pos);
    // long sentences
    for (const s of ss)
      if (s.words.length >= LONG_SENTENCE) out.push(Decoration.inline(s.from, s.to, { class: 'hint-long', title: t('Long sentence ({n} words)', { n: s.words.length }) }));
    // the same sentence twice in the section
    for (const s of ss) {
      if (s.words.length < 4) continue;
      const first = seenSentence.get(s.text);
      if (first != null) out.push(Decoration.inline(s.from, s.to, { class: 'hint-rep', title: t('This sentence is already in the section') }));
      else seenSentence.set(s.text, s.from);
    }
    // three sentences in a row starting with the same word
    for (let i = 2; i < ss.length; i++) {
      const a = ss[i - 2].words[0], b = ss[i - 1].words[0], c = ss[i].words[0];
      if (key(a.w) === key(b.w) && key(b.w) === key(c.w))
        for (const w of [a, b, c]) out.push(Decoration.inline(w.from, w.to, { class: 'hint-rep', title: t('Several sentences in a row start with “{w}”', { w: c.w }) }));
    }
    // a word repeated close by (within the paragraph)
    const words = ss.flatMap((s) => s.words);
    const last = new Map<string, number>();
    const marked = new Set<number>();
    words.forEach((w, i) => {
      const l = w.w.toLowerCase();
      if (l.length < 4 || STOP.has(l) || /^\d/.test(l)) return;
      const k = key(w.w);
      const j = last.get(k);
      if (j != null && i - j <= NEAR) {
        for (const x of [j, i])
          if (!marked.has(x)) {
            marked.add(x);
            out.push(Decoration.inline(words[x].from, words[x].to, { class: 'hint-rep', title: t('“{w}” is repeated close by', { w: words[x].w }) }));
          }
      }
      last.set(k, i);
    });
    return false;
  });
  return out.length ? DecorationSet.create(doc, out) : DecorationSet.empty;
}

export const hintsKey = new PluginKey<DecorationSet>('hints');

/** Shows the hints while `settings.writeHints` is on; dispatch `hintsKey` meta to refresh after toggling. */
export const ReadabilityHints = Extension.create({
  name: 'readabilityHints',
  addProseMirrorPlugins() {
    const compute = (doc: PMNode) => (settings.writeHints ? hintDecorations(doc) : DecorationSet.empty);
    return [
      new Plugin<DecorationSet>({
        key: hintsKey,
        state: {
          init: (_, { doc }) => compute(doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(hintsKey) ? compute(tr.doc) : old)
        },
        props: {
          decorations(state) {
            return hintsKey.getState(state);
          }
        }
      })
    ];
  }
});
