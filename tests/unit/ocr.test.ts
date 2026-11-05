import { describe, expect, it } from 'vitest';
import { cleanText, defaultClean } from '../../src/lib/ocr';

describe('cleanText (PDF/OCR cleanup)', () => {
  it('joins hyphenated words across line breaks', () => {
    expect(cleanText('the recon-\nstruction of memory')).toBe('the reconstruction of memory');
    expect(cleanText('recon- struction')).toBe('reconstruction');
  });
  it('keeps real hyphens in compounds and before capitals', () => {
    expect(cleanText('well-known and Nord-\nSüd')).toBe('well-known and Nord- Süd');
  });
  it('replaces ligatures', () => {
    expect(cleanText('ﬁnal ﬂow eﬀect')).toBe('final flow effect');
  });
  it('joins single line breaks but keeps paragraphs', () => {
    expect(cleanText('line one\nline two\n\nnew paragraph')).toBe('line one line two\n\nnew paragraph');
  });
  it('normalises whitespace and spacing before punctuation', () => {
    expect(cleanText('too   many  spaces , here .')).toBe('too many spaces, here.');
    expect(cleanText('( spaced )')).toBe('(spaced)');
  });
  it('strips soft hyphens and zero-width characters', () => {
    expect(cleanText('Ge­dächt​nis')).toBe('Gedächtnis');
  });
  it('strips wrapping quotation marks', () => {
    expect(cleanText('“Quoted text”')).toBe('Quoted text');
    expect(cleanText('„Zitat“')).toBe('Zitat');
  });
  it('respects disabled options', () => {
    const o = { ...defaultClean, joinLines: false, quotes: false };
    expect(cleanText('“a\nb”', o)).toBe('“a\nb”');
  });
  it('is idempotent', () => {
    const once = cleanText('recon-\nstruc tion ﬁ  .');
    expect(cleanText(once)).toBe(once);
  });
});
