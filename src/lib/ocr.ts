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
