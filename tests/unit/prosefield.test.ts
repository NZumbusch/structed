import { beforeEach, describe, expect, it } from 'vitest';
import { settings } from '../../src/lib/settings.svelte';
import { autoType, fixSegments, fixTypography } from '../../src/lib/prosefield';
import { quoteInner } from '../../src/lib/citecache.svelte';
import { fixDraft } from '../../src/lib/fixall';

/** Type `s` character by character, as the text fields do. */
function typed(s: string, opts: { markdown?: boolean } = {}): string {
  let v = '';
  for (const ch of s) {
    const r = autoType(v, ch, opts);
    v = r ? v.slice(0, r.from) + r.insert : v + ch;
  }
  return v;
}

beforeEach(() => {
  settings.quoteMarks = 'de';
  settings.nestedQuoteMarks = 'auto';
  settings.editorSmartQuotes = true;
  settings.editorAutoDash = true;
  settings.editorNbsp = true;
});

describe('typing helpers in plain text fields', () => {
  it('quotes, apostrophes, ellipsis, dash and non-breaking spaces', () => {
    expect(typed('Er sagt "ja" und it\'s gut... vgl. S. 12, z. B. ein Wort - kurz.')).toBe('Er sagt „ja“ und it’s gut… vgl. S. 12, z. B. ein Wort – kurz.');
  });
  it('follows the quotation marks setting and the switches', () => {
    settings.quoteMarks = 'ch';
    expect(typed('"x"')).toBe('«x»');
    settings.editorSmartQuotes = false;
    expect(typed('"x"...')).toBe('"x"...');
  });
  it('keeps a markdown list a list', () => {
    expect(typed(' - Punkt eins ', { markdown: true })).toBe(' - Punkt eins ');
    expect(typed('a - b ', { markdown: true })).toBe('a – b ');
  });
});

describe('fixing whole texts', () => {
  const samples = ['Er sagt "ja" und it\'s gut... vgl. S. 12, z. B. ein Wort - kurz.', 'Zeile "eins"\nZeile \'zwei\' - drei.', '"Am Anfang"', '§ 5 und Nr. 3'];
  it('gives exactly what typing gives', () => {
    for (const s of samples) expect(fixTypography(s)).toBe(typed(s));
  });
  it('is idempotent', () => {
    for (const s of samples) expect(fixTypography(fixTypography(s))).toBe(fixTypography(s));
  });
  it('sets quotation marks of other styles anew', () => {
    expect(fixTypography('Er sagt “ja” und »nein«.')).toBe('Er sagt „ja“ und „nein“.');
  });
  it('sets the dash before the last word too', () => {
    expect(fixTypography('Freud - Lacan')).toBe('Freud – Lacan');
  });
  it('keeps text pieces and objects apart', () => {
    expect(fixSegments(['Er sagt "', 'ja', '" ', '￼', ' und ...'])).toEqual(['Er sagt „', 'ja', '“ ', '￼', ' und …']);
  });
  it('fixes a section text with its footnotes, leaving linked quotes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Er sagt "ja" ' },
            { type: 'quoteRef', attrs: { id: 'q1', mode: 'inline' } },
            { type: 'footnote', attrs: { content: [{ type: 'text', text: 'Vgl. S. 12...' }] } }
          ]
        }
      ]
    };
    const out = JSON.parse(fixDraft(JSON.stringify(doc))!);
    const c = out.content[0].content;
    expect(c[0].text).toBe('Er sagt „ja“ ');
    expect(c[1]).toEqual(doc.content[0].content[1]);
    expect(c[2].attrs.content[0].text).toBe('Vgl. S. 12…');
    expect(fixDraft(JSON.stringify(out))).toBeNull();
  });
});

describe('quotes inside a quote', () => {
  it('become nested marks inside the outer ones', () => {
    expect(quoteInner('Er sagt „ja“ dazu.')).toBe('Er sagt ‚ja‘ dazu.');
    expect(quoteInner('Er sagt "ja" dazu.')).toBe('Er sagt ‚ja‘ dazu.');
    expect(quoteInner('„Ich“ sagte er.')).toBe('‚Ich‘ sagte er.');
  });
  it('a quote in single marks gets the double ones in turn', () => {
    expect(quoteInner('Sie schreibt „er sagt ‚ja‘“.')).toBe('Sie schreibt ‚er sagt „ja“‘.');
  });
  it('follows the settings', () => {
    settings.nestedQuoteMarks = 'ch';
    expect(quoteInner('Er sagt „ja“.')).toBe('Er sagt ‹ja›.');
    settings.quoteMarks = 'en';
    settings.nestedQuoteMarks = 'auto';
    expect(quoteInner('He said “yes”.')).toBe('He said ‘yes’.');
    settings.nestedQuoteMarks = 'keep';
    expect(quoteInner('He said “yes”.')).toBe('He said “yes”.');
    settings.quoteMarks = 'none';
    settings.nestedQuoteMarks = 'auto';
    expect(quoteInner('Er sagt „ja“.')).toBe('Er sagt „ja“.');
  });
  it('leaves apostrophes alone', () => {
    expect(quoteInner('it’s „ok“')).toBe('it’s ‚ok‘');
  });
});
