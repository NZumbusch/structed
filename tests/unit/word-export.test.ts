import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { db } from '../../src/lib/db.svelte';
import { settings } from '../../src/lib/settings.svelte';
import { children, createProject, addChildHeading } from '../../src/lib/ops';
import { buildWordDocument, rpr, esc } from '../../src/lib/word/export';

const tpl = readFileSync(process.cwd() + '/public/word/seminararbeit.docx');
const bytes = tpl.buffer.slice(tpl.byteOffset, tpl.byteOffset + tpl.byteLength);

function setup() {
  const p = createProject('Szenen aus Bachs Arbeitswelt', 'blank', 'de');
  const [h] = children(p.id, null);
  db.update('headings', h.id, { title: 'Einleitung' });
  const sub = addChildHeading(db.get('headings', h.id)!, 'Bachs Kantatenschaffen');
  const zs = db.create('sources', {
    csl: { id: 'X', type: 'book', title: 'Die Kantaten von Johann Sebastian Bach', author: [{ family: 'Dürr', given: 'Alfred' }], issued: { 'date-parts': [[1971]] }, publisher: 'Bärenreiter' },
    tags: [],
    zoteroKey: 'ABCD1234',
    zoteroLibrary: 'users/42'
  });
  const own = db.create('sources', { csl: { id: 'Y', type: 'book', title: 'Zufällige Gedancken', author: [{ family: 'Scheibel', given: 'Gottfried' }], issued: { 'date-parts': [[1721]] } }, tags: [] });
  const q1 = db.create('artifacts', { kind: 'quote', text: 'Bach gibt seiner Komposition den Titel Motetto', page: '797', tags: [], sourceId: zs.id });
  const q2 = db.create('artifacts', { kind: 'quote', text: 'Es bleibt ein Affect', page: '34', tags: [], sourceId: own.id });
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Normal, ' },
          { type: 'text', text: 'fett', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' und ' },
          { type: 'text', text: 'kursiv & <sicher>', marks: [{ type: 'italic' }] },
          { type: 'text', text: ': ' },
          { type: 'quoteRef', attrs: { id: q1.id, mode: 'inline' } },
          { type: 'text', text: '.' },
          { type: 'footnote', attrs: { before: 'Vgl.', quoteId: q2.id, after: 'Hervorhebung original.' } }
        ]
      },
      { type: 'quoteBlock', attrs: { id: q1.id } }
    ]
  };
  db.update('headings', sub.id, { draft: JSON.stringify(doc) });
  db.update('projects', p.id, { cover: { workType: 'Seminararbeit', module: 'im Modul „Bach“', institution: '', supervisor: '', title: 'Szenen aus Bachs Arbeitswelt', author: 'vorgelegt von:\nMax Muster', placeDate: 'Luzern, den 1.1.2027' } });
  return db.get('projects', p.id)!;
}

async function unzip(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return {
    zip,
    doc: await zip.file('word/document.xml')!.async('string'),
    fn: await zip.file('word/footnotes.xml')!.async('string'),
    settings: await zip.file('word/settings.xml')!.async('string')
  };
}
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

describe('Word export with the Seminararbeit template', () => {
  it('produces well-formed XML with styles, title page, TOC, footnotes and Zotero fields', async () => {
    settings.exportZotero = true;
    const p = setup();
    const { doc, fn, settings: st, zip } = await unzip(await buildWordDocument(p, { templateBytes: bytes, template: 'seminararbeit' }));
    expect(parse(doc).getElementsByTagName('parsererror')).toHaveLength(0);
    expect(parse(fn).getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc).not.toContain('{{');
    expect(fn).not.toContain('{{');
    // title page
    expect(doc).toContain('im Modul „Bach“');
    expect(doc).toContain('Max Muster');
    // headings with template styles and TOC field + bookmarks
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>');
    expect(doc).toMatch(/TOC \\o "1-3"/);
    expect(doc).toMatch(/w:name="_TocS1"/);
    expect(st).toContain('<w:updateFields w:val="true"/>');
    // formatting and escaping
    expect(doc).toMatch(/<w:b\/><w:bCs\/>.*?<w:t xml:space="preserve">fett<\/w:t>/s);
    expect(doc).toContain('kursiv &amp; &lt;sicher&gt;');
    // Zotero: linked item with URI for Zotero sources, embedded item otherwise
    expect(doc).toContain('ADDIN ZOTERO_ITEM CSL_CITATION');
    expect(doc).toContain('http://zotero.org/users/42/items/ABCD1234');
    expect(doc).toContain('&quot;locator&quot;:&quot;797&quot;');
    expect(fn).toContain('ADDIN ZOTERO_ITEM CSL_CITATION');
    expect(fn).toContain('&quot;noteIndex&quot;:1');
    expect(fn).not.toContain('zotero.org/users'); // Scheibel is not a Zotero item
    expect(fn).toContain('Hervorhebung original.');
    expect(doc).toContain('<w:footnoteReference w:id="1"/>');
    // block quote in the "Quote" style + centered citation
    expect(doc).toContain('<w:pStyle w:val="Quote"/>');
    // bibliography field with entries
    expect(doc).toContain('ADDIN ZOTERO_BIBL');
    expect(doc).toContain('<w:pStyle w:val="Bibliography"/>');
    expect(doc).toMatch(/Dürr, A\. \(1971\)/);
    // Zotero document preferences and template styles are kept
    expect(await zip.file('docProps/custom.xml')!.async('string')).toContain('ZOTERO_PREF_1');
    expect(await zip.file('word/styles.xml')!.async('string')).toContain('STIX Two Text');
  });

  it('can export plain citations instead of Zotero fields and skip parts', async () => {
    settings.exportZotero = false;
    const p = setup();
    const { doc } = await unzip(await buildWordDocument(p, { templateBytes: bytes, cover: false, toc: false, bibliography: false }));
    expect(doc).not.toContain('ZOTERO_ITEM');
    expect(doc).not.toContain('TOC \\o');
    expect(doc).not.toContain('Max Muster');
    expect(doc).toMatch(/\(Dürr, 1971, S\. 797\)/);
    settings.exportZotero = true;
  });

  it('exports an edited (shortened) quote as italic text with a live Zotero citation', async () => {
    settings.exportZotero = true;
    const p = setup();
    const sub = db.all('headings').find((h) => h.title === 'Bachs Kantatenschaffen')!;
    const q = db.all('artifacts').find((a) => a.page === '797')!;
    db.update('headings', sub.id, {
      draft: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '„' }, { type: 'text', text: 'Bach gibt […] den Titel Motetto', marks: [{ type: 'italic' }] }, { type: 'text', text: '“ ' }, { type: 'quoteRef', attrs: { id: q.id, mode: 'cite' } }] }]
      })
    });
    const { doc } = await unzip(await buildWordDocument(p, { templateBytes: bytes, cover: false, toc: false, bibliography: false }));
    expect(doc).toMatch(/<w:i\/><w:iCs\/>.*?Bach gibt \[…\] den Titel Motetto/s);
    expect(doc).not.toContain('Bach gibt seiner Komposition'); // the edited version, not the original
    expect(doc).toContain('ADDIN ZOTERO_ITEM CSL_CITATION');
    expect(doc).toContain('&quot;locator&quot;:&quot;797&quot;');
  });

  it('rpr merges formatting in schema order', () => {
    const base = '<w:rPr><w:rFonts w:ascii="X"/><w:lang w:eastAsia="de-DE"/></w:rPr>';
    expect(rpr(base, { b: true, i: true, u: true })).toBe('<w:rPr><w:rFonts w:ascii="X"/><w:b/><w:bCs/><w:i/><w:iCs/><w:u w:val="single"/><w:lang w:eastAsia="de-DE"/></w:rPr>');
    expect(rpr('', {})).toBe('');
    expect(esc('a<&>"')).toBe('a&lt;&amp;&gt;&quot;');
  });
});
