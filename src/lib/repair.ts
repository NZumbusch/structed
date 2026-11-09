// Repairing text taken from PDFs whose text layer is damaged: umlauts and ß read as "?"
// ("f?r" → "für"), words broken apart by spaced-out lettering ("bearbei tet" → "bearbeitet")
// and words run together ("zwischender" → "zwischen der"). Every repair is a suggestion with a
// level: "sure" (only one real word fits), "check" (a guess that needs a look) or "unsolved"
// (a "?" no word fits). Nothing is changed silently: the review shows every repair in colour.
import { settings } from './settings.svelte';

// ---------------- word list ----------------

export interface Dict {
  /** frequency class of a lower-case word: 0 = unknown, higher = more common (≈ log2 of its count + 1) */
  freq(word: string): number;
}

export function parseDict(text: string): Dict {
  const map = new Map<string, number>();
  let prev = '';
  for (const line of text.split('\n')) {
    if (line.length < 2) continue;
    const k = line.charCodeAt(0) - 48;
    const w = prev.slice(0, k) + line.slice(1, -1);
    map.set(w, line.charCodeAt(line.length - 1) - 64);
    prev = w;
  }
  return { freq: (w) => map.get(w.toLowerCase()) ?? 0 };
}

let loading: Promise<Dict | null> | null = null;
/** The German word list (about 0.7 MB, fetched the first time it is needed, then kept offline). */
export function loadDict(): Promise<Dict | null> {
  loading ??= fetch(`${import.meta.env.BASE_URL}dict/de.txt`)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then(parseDict)
    .catch(() => ((loading = null), null));
  return loading;
}

// ---------------- finding repairs ----------------

export type Level = 'sure' | 'check' | 'unsolved';
export interface Fix {
  /** range in the text it applies to */
  start: number;
  end: number;
  from: string;
  /** candidates, best first ([] = unsolved) */
  options: string[];
  level: Level;
  kind: 'umlaut' | 'join' | 'split' | 'learned';
}

const UML = ['ä', 'ö', 'ü', 'ß'];
const UML_UP = ['Ä', 'Ö', 'Ü'];
/** words that often get glued to their neighbour by OCR */
const SMALL = new Set(
  'der die das den dem des und oder in im zu zum zur von vom mit ist sind war sich ein eine einer einen eines einem auf aus bei nicht auch als wie so es sie er wir man noch nach unter vor durch für über an am'.split(' ')
);
const NOUN_END = /(keit|heit|ung|ungen|schaft|tum|nis|ität|ion|ismus|ler|ner)$/;

/** All ways to fill the "?" in a word with ä ö ü ß (Ä Ö Ü at the start), at most 4 of them. */
function fills(word: string): string[] {
  const qs = [...word].reduce<number[]>((a, c, i) => (c === '?' ? [...a, i] : a), []);
  if (!qs.length || qs.length > 4) return [];
  let out = [''];
  [...word].forEach((c, i) => {
    if (c !== '?') out = out.map((x) => x + c);
    else out = out.flatMap((x) => (i === 0 ? [...UML, ...UML_UP] : UML).map((u) => x + u));
  });
  return out;
}

/** Is the word, if not in the list itself, a compound of two words that are (with a linking s)? */
function compound(w: string, d: Dict): boolean {
  const l = w.toLowerCase();
  for (let i = 3; i <= l.length - 4; i++) {
    const a = l.slice(0, i);
    const b = l.slice(i);
    if (d.freq(b) >= 4 && (d.freq(a) >= 4 || (a.endsWith('s') && d.freq(a.slice(0, -1)) >= 4))) return true;
  }
  return false;
}

const sentenceStart = (text: string, at: number) => /(^|[.!?:]["“”»«)]*\s+)$/.test(text.slice(Math.max(0, at - 6), at)) || at === 0;

/** Candidates for a word with "?" in it, best first, and how sure the best one is. */
function umlautOptions(word: string, text: string, at: number, d: Dict): { options: string[]; level: Level } {
  const learned = settings.repairLearned?.[word];
  if (learned) return { options: [learned], level: 'sure' };
  const all = fills(word);
  let known = all.map((w) => ({ w, f: d.freq(w) })).filter((x) => x.f > 0);
  let viaCompound = false;
  if (!known.length) {
    known = all.filter((w) => compound(w, d)).map((w) => ({ w, f: 1 }));
    viaCompound = true;
  }
  if (!known.length) return { options: [], level: 'unsolved' };
  // upper or lower case at the start of a word ("Über" / "über")
  if (word[0] === '?') {
    const upper = sentenceStart(text, at) || NOUN_END.test(known[0].w.toLowerCase());
    known = known.filter((x) => (upper ? x.w[0] === x.w[0].toUpperCase() : x.w[0] === x.w[0].toLowerCase()) || known.length === 1);
    if (!known.length) return { options: [], level: 'unsolved' };
  }
  known.sort((a, b) => b.f - a.f);
  const options = [...new Set(known.map((x) => x.w))];
  const clear = known.length === 1 || known[0].f - known[1].f >= 4; // 16 times more common
  return { options, level: viaCompound ? 'check' : clear ? 'sure' : 'check' };
}

const DE = new Set('der die das und ist nicht ein eine den dem des mit von zu auf sich auch als wie im sie er es wird wurde werden sind war hatte nach bei aus durch über für dass daß oder aber noch nur'.split(' '));
const EN = new Set('the and of to is in that it for with as was on by be this which are from at an or not have has were their they his her'.split(' '));
/** Does the text look German (more German than English small words)? Joining and splitting only run then. */
function german(words: string[]) {
  let de = 0;
  let en = 0;
  for (const w of words) {
    const l = w.toLowerCase();
    if (DE.has(l)) de++;
    if (EN.has(l)) en++;
  }
  return de > en;
}

const best = (w: string, text: string, at: number, d: Dict) => (w.includes('?') ? umlautOptions(w, text, at, d) : { options: d.freq(w) ? [w] : [], level: 'sure' as Level });

export function findFixes(text: string, d: Dict): Fix[] {
  const tokens = [...text.matchAll(/[\p{L}?]*\p{L}[\p{L}?]*|[\p{L}]*\?[\p{L}]+/gu)].map((m) => ({ w: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const fixes: Fix[] = [];
  const used = new Set<number>();
  const isGerman = german(tokens.map((x) => x.w));
  const broken = tokens.some((x) => /\p{L}\?\p{L}/u.test(x.w));

  // words broken apart: "bearbei tet", "ausgeh?hl ten", "Ge- schichte"
  if (isGerman)
    for (let i = 0; i + 1 < tokens.length; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      const gap = text.slice(a.end, b.start);
      if (!(gap === ' ' || gap === '- ') || !/^\p{Ll}/u.test(b.w)) continue;
      const joined = a.w + b.w;
      const j = best(joined, text, a.start, d);
      if (!j.options.length) continue;
      const jf = d.freq(j.options[0]) || 1;
      const fa = a.w.includes('?') ? Math.max(0, ...fills(a.w).map((w) => d.freq(w))) : d.freq(a.w);
      const fb = b.w.includes('?') ? Math.max(0, ...fills(b.w).map((w) => d.freq(w))) : d.freq(b.w);
      let level: Level;
      if (gap === '- ' || !fa || !fb) level = j.level === 'sure' ? 'sure' : 'check';
      else if (Math.min(fa, fb) < jf) level = 'check'; // "For men": both are words, but the joined one is more likely
      else continue;
      fixes.push({ start: a.start, end: b.end, from: text.slice(a.start, b.end), options: j.options, level, kind: 'join' });
      used.add(i).add(i + 1);
      i++;
    }

  tokens.forEach((tk, i) => {
    if (used.has(i)) return;
    const w = tk.w;
    if (w.includes('?')) {
      // a "?" at the end may be a real question mark: only when the next word goes on in lower case
      if (w.endsWith('?') && !/\p{L}\?\p{L}/u.test(w)) {
        const after = text.slice(tk.end, tk.end + 3);
        if (!broken || !/^\s\p{Ll}/u.test(after)) return;
      }
      const u = umlautOptions(w, text, tk.start, d);
      fixes.push({ start: tk.start, end: tk.end, from: w, options: u.options, level: u.level, kind: settings.repairLearned?.[w] ? 'learned' : 'umlaut' });
      return;
    }
    // words run together: "zwischender" → "zwischen der" (suggestion only)
    if (!isGerman || w.length < 6 || d.freq(w) || compound(w, d)) return;
    const l = w.toLowerCase();
    for (let k = 2; k <= l.length - 2; k++) {
      const a = l.slice(0, k);
      const b = l.slice(k);
      if ((SMALL.has(b) && d.freq(a) >= 4) || (SMALL.has(a) && d.freq(b) >= 4)) {
        fixes.push({ start: tk.start, end: tk.end, from: w, options: [w.slice(0, k) + ' ' + w.slice(k)], level: 'check', kind: 'split' });
        break;
      }
    }
  });
  return fixes.sort((x, y) => x.start - y.start);
}

/** The text with the chosen repairs (null = keep the original there). */
export function applyFixes(text: string, fixes: Fix[], chosen: (string | null)[]): string {
  let out = '';
  let at = 0;
  fixes.forEach((f, i) => {
    out += text.slice(at, f.start) + (chosen[i] ?? f.from);
    at = f.end;
  });
  return out + text.slice(at);
}

/**
 * Remember how "?" words were corrected by hand ("religi?sen" → "religiösen"), so the same
 * word is repaired by itself next time. Words are matched in order in the edited text.
 */
export function learnFromEdit(before: string, after: string): Record<string, string> {
  const found: Record<string, string> = {};
  let from = 0;
  for (const m of before.matchAll(/[\p{L}?]*\?[\p{L}?]*/gu)) {
    const w = m[0];
    if (!/\p{L}/u.test(w)) continue;
    const re = new RegExp('(?<![\\p{L}])' + [...w].map((c) => (c === '?' ? '([\\p{L}])' : c.replace(/[.*+^${}()|[\]\\]/g, '\\$&'))).join('') + '(?![\\p{L}])', 'u');
    const hit = re.exec(after.slice(from));
    if (!hit) continue;
    from += hit.index + hit[0].length;
    if (!hit[0].includes('?')) found[w] = hit[0];
  }
  return found;
}

export function remember(map: Record<string, string>) {
  if (Object.keys(map).length) settings.repairLearned = { ...(settings.repairLearned ?? {}), ...map };
}
