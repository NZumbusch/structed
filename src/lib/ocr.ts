// Clean-up for text copied/extracted from PDFs (Zotero highlights, OCR).
export interface CleanOptions {
  dehyphenate: boolean; // "exam-\nple" / "exam- ple" -> "example"
  joinLines: boolean; // single line breaks -> spaces
  ligatures: boolean; // ﬁ -> fi ...
  whitespace: boolean; // collapse spaces, fix " ," etc.
  quotes: boolean; // strip wrapping quotation marks
}

export const defaultClean: CleanOptions = {
  dehyphenate: true,
  joinLines: true,
  ligatures: true,
  whitespace: true,
  quotes: true
};

const LIG: Record<string, string> = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st', 'Ĳ': 'IJ', 'ĳ': 'ij'
};

export function cleanText(input: string, o: CleanOptions = defaultClean): string {
  let s = input ?? '';
  s = s.replace(/\r\n?/g, '\n').replace(/­/g, '').replace(/[​﻿]/g, '');
  if (o.ligatures) s = s.replace(/[ﬀﬁﬂﬃﬄﬅﬆĲĳ]/g, (c) => LIG[c] ?? c);
  if (o.dehyphenate) s = s.replace(/(\p{Ll})[-‐‑¬]\s*\n\s*(\p{Ll})/gu, '$1$2').replace(/(\p{Ll})[-‐‑¬] (\p{Ll})/gu, '$1$2');
  if (o.joinLines) s = s.replace(/([^\n])\n(?!\n)/g, '$1 ');
  if (o.whitespace) {
    s = s
      .replace(/[ \t ]+/g, ' ')
      .replace(/ +([,.;:!?)\]»”])/g, '$1')
      .replace(/([(\[«„“]) +/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/ *\n */g, '\n');
  }
  s = s.trim();
  if (o.quotes) {
    const m = s.match(/^["“„«»‚‘'](.*)["”“»«‘’']$/s);
    if (m) s = m[1].trim();
  }
  return s;
}

/**
 * Text pasted from a PDF breaks every line and hyphenates across lines. When the text looks
 * like that (long lines, most not ending a sentence), join the lines of each paragraph and
 * undo the line-end hyphenation; blank lines stay paragraph breaks. Short lines (a list,
 * an address) are left as they are.
 */
export function joinPdfLines(input: string): string {
  const s = input.replace(/\r\n?/g, '\n');
  const lines = s.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return input;
  const avg = lines.reduce((n, l) => n + l.trim().length, 0) / lines.length;
  const open = lines.slice(0, -1).filter((l) => !/[.!?:;]["“”»«')\]]?\s*$/.test(l)).length / (lines.length - 1);
  if (avg < 35 || open < 0.5) return input;
  return cleanText(s, { dehyphenate: true, joinLines: true, ligatures: true, whitespace: false, quotes: false }).replace(/[ \t]{2,}/g, ' ');
}
