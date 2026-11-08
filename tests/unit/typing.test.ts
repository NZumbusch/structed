import { describe, expect, it } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { settings } from '../../src/lib/settings.svelte';
import { findIn, typedQuotes } from '../../src/lib/typing';
import { keepTogether } from '../../src/lib/citecache.svelte';
import { charCount } from '../../src/lib/editor.svelte';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    quoteRef: { group: 'inline', inline: true, atom: true }
  },
  marks: { bold: {} }
});
const p = (...c: ReturnType<typeof schema.text>[]) => schema.node('paragraph', null, c);

describe('find in the text', () => {
  const doc = schema.node('doc', null, [
    p(schema.text('Die Ta'), schema.text('ufe', [schema.mark('bold')]), schema.text(' und die Taufe.')),
    p(schema.text('Ein Zitat '), schema.node('quoteRef') as never, schema.text(' taufe'))
  ]);
  it('matches across formatting, ignores case unless asked', () => {
    const ms = findIn(doc, 'taufe');
    expect(ms).toHaveLength(3);
    expect(doc.textBetween(ms[0].from, ms[0].to)).toBe('Taufe');
    expect(findIn(doc, 'Taufe', true)).toHaveLength(2);
    expect(findIn(doc, '')).toHaveLength(0);
  });
  it('never matches across a linked quote', () => {
    expect(findIn(doc, 'Zitat  taufe')).toHaveLength(0);
    expect(findIn(doc, 'Zitat ')).toHaveLength(1);
  });
});

describe('typing helpers', () => {
  it('typed quotes follow the quotation-mark setting', () => {
    settings.quoteMarks = 'de';
    expect(typedQuotes()).toEqual(['„', '“', '‚', '‘']);
    settings.quoteMarks = 'en';
    expect(typedQuotes()[0]).toBe('“');
    settings.quoteMarks = 'ch';
    expect(typedQuotes()[1]).toBe('»');
    settings.quoteMarks = 'none';
    settings.editorLang = 'en';
    expect(typedQuotes()[0]).toBe('“');
    settings.editorLang = 'de';
    settings.quoteMarks = 'de';
  });
  it('keeps page labels with their numbers in citations', () => {
    expect(keepTogether('(Dürr, 1971, S. 797)')).toBe('(Dürr, 1971, S. 797)');
    expect(keepTogether('(Kaufmann, 1996, Sp. 1121, zit. nach Lotz, 2001, p. 3)')).toBe('(Kaufmann, 1996, Sp. 1121, zit. nach Lotz, 2001, p. 3)');
    expect(keepTogether('(Assmann, 2011, Seite 12)')).toBe('(Assmann, 2011, Seite 12)');
    expect(keepTogether('(Assmann, 2011)')).toBe('(Assmann, 2011)');
    settings.editorNbsp = false;
    expect(keepTogether('(Dürr, 1971, S. 797)')).toBe('(Dürr, 1971, S. 797)');
    settings.editorNbsp = true;
  });
  it('counts characters with spaces like Word (paragraph breaks do not count)', () => {
    expect(charCount('Ein Satz.\nZwei\n')).toBe('Ein Satz.Zwei'.length);
    expect(charCount('  a b  ')).toBe(3);
  });
});

import { joinPdfLines } from '../../src/lib/ocr';
describe('pasting text from a PDF', () => {
  it('joins broken lines and undoes line-end hyphenation, keeps paragraphs', () => {
    const pdf = 'Die Erinnerungskultur einer Gesellschaft ist nicht einfach\ngegeben, sondern wird in Ritualen und Medien immer wie-\nder neu hergestellt und verhandelt.\n\nZweiter Absatz mit einer weiteren langen Zeile hier\nund dem Ende des Satzes.';
    expect(joinPdfLines(pdf)).toBe(
      'Die Erinnerungskultur einer Gesellschaft ist nicht einfach gegeben, sondern wird in Ritualen und Medien immer wieder neu hergestellt und verhandelt.\n\nZweiter Absatz mit einer weiteren langen Zeile hier und dem Ende des Satzes.'
    );
  });
  it('leaves short lines and finished sentences alone', () => {
    expect(joinPdfLines('Milch\nEier\nMehl')).toBe('Milch\nEier\nMehl');
    const sentences = 'Das ist ein vollständiger Satz mit genug Länge hier.\nUnd das ist noch ein vollständiger Satz mit Länge.';
    expect(joinPdfLines(sentences)).toBe(sentences);
  });
});
