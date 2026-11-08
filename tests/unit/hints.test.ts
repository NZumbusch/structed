import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { hintDecorations } from '../../src/lib/hints';

const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' } } });
const doc = (...ps: string[]) => schema.node('doc', null, ps.map((p) => schema.node('paragraph', null, p ? [schema.text(p)] : [])));
const found = (d: ReturnType<typeof doc>) =>
  hintDecorations(d)
    .find()
    .map((x) => ({ cls: (x as unknown as { type: { attrs: { class: string } } }).type.attrs.class, text: d.textBetween(x.from, x.to) }));

describe('readability hints', () => {
  it('marks a content word repeated close by, never small words', () => {
    const hs = found(doc('Das Gedächtnis ist sozial, und das Gedächtnis ist medial.'));
    expect(hs.filter((h) => h.cls === 'hint-rep').map((h) => h.text)).toEqual(['Gedächtnis', 'Gedächtnis']);
  });
  it('treats word forms alike ("Gesellschaft" / "gesellschaftlich")', () => {
    expect(found(doc('Die Gesellschaft erinnert gesellschaftlich.')).map((h) => h.text)).toEqual(['Gesellschaft', 'gesellschaftlich']);
  });
  it('marks very long sentences', () => {
    const long = Array.from({ length: 45 }, (_, i) => 'wort' + String.fromCharCode(97 + (i % 26)) + i).join(' ') + '.';
    expect(found(doc(long)).some((h) => h.cls === 'hint-long')).toBe(true);
  });
  it('marks a sentence that is already in the section and three starts alike; abbreviations end no sentence', () => {
    const hs = found(doc('Erinnerung braucht Medien hier.', 'Erinnerung braucht Medien hier.'));
    expect(hs.some((h) => h.text === 'Erinnerung braucht Medien hier.')).toBe(true);
    const starts = found(doc('Dann kam Assmann. Dann kam Nora. Dann kam Halbwachs.'));
    expect(starts.filter((h) => h.text === 'Dann')).toHaveLength(3);
    expect(found(doc('Das steht z. B. auf S. 12 im Buch.'))).toHaveLength(0);
  });
});
