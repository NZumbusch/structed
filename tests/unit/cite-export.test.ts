import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db.svelte';
import { citeArtifact, parseBibliography, toBibtex } from '../../src/lib/cite';
import { defaultMd, toMarkdown } from '../../src/lib/export';
import { children, createProject, place } from '../../src/lib/ops';
import { canHaveAnnotations, findDuplicate } from '../../src/lib/zotero';

const assmann = {
  id: 'assmann',
  type: 'book',
  title: 'Cultural Memory and Early Civilization',
  author: [{ family: 'Assmann', given: 'Jan' }],
  issued: { 'date-parts': [[2011]] },
  publisher: 'Cambridge University Press'
};

describe('bibliography parsing', () => {
  it('parses BibTeX', async () => {
    const items = await parseBibliography('@book{nora, author={Nora, Pierre}, title={Les lieux de mémoire}, publisher={Gallimard}, year={1984}}');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Les lieux de mémoire');
    expect(items[0].author?.[0].family).toBe('Nora');
  });
  it('parses RIS', async () => {
    const items = await parseBibliography('TY  - JOUR\nAU  - Halbwachs, Maurice\nTI  - On Collective Memory\nPY  - 1992\nER  - \n');
    expect(items[0].title).toBe('On Collective Memory');
  });
  it('accepts CSL-JSON arrays', async () => {
    const items = await parseBibliography(JSON.stringify([assmann]));
    expect(items[0].publisher).toBe('Cambridge University Press');
  });
  it('detects duplicates by DOI or title+year', () => {
    db.create('sources', { csl: { ...assmann, DOI: '10.1/ABC' }, tags: [] });
    expect(findDuplicate({ id: 'x', type: 'book', DOI: '10.1/abc' })).toBeDefined();
    expect(findDuplicate({ ...assmann, id: 'y' })).toBeDefined();
    expect(findDuplicate({ id: 'z', type: 'book', title: 'Other' })).toBeUndefined();
  });
});

describe('citations', () => {
  it('formats an APA in-text citation with page locator', async () => {
    const s = db.create('sources', { csl: assmann, tags: [] });
    const q = db.create('artifacts', { kind: 'quote', text: 'x', tags: [], sourceId: s.id, page: '18' });
    expect(await citeArtifact(q, { style: 'apa', locale: 'en-US' })).toBe('(Assmann, 2011, p. 18)');
  });
  it('exports BibTeX', async () => {
    const s = db.create('sources', { csl: assmann, tags: [] });
    const bib = await toBibtex([s]);
    expect(bib).toMatch(/@book\{/);
    expect(bib).toMatch(/Assmann/);
  });
});

describe('markdown export', () => {
  function project() {
    const p = createProject('Memory', 'essay', 'en');
    const [intro] = children(p.id, null);
    db.update('headings', intro.id, { body: 'First line\nsecond line' });
    const s = db.create('sources', { csl: assmann, tags: [] });
    const q = db.create('artifacts', { kind: 'quote', text: 'Line one\nLine two', tags: [], sourceId: s.id, page: '18', comment: 'nice' });
    place(p.id, intro.id, q.id);
    db.create('comments', { projectId: p.id, targetId: intro.id, text: 'Fix this' });
    return p;
  }
  it('renders headings, bodies, callouts, comments and keeps line breaks', async () => {
    const md = await toMarkdown(project(), { ...defaultMd, citations: 'short', bibliography: false });
    expect(md).toContain('title: "Memory"');
    expect(md).toContain('## 1 Introduction');
    expect(md).toContain('First line\nsecond line');
    expect(md).toContain('> [!quote]- Assmann 2011, p. 18\n> Line one\n> Line two');
    expect(md).toContain('> [!todo] Comment\n> Fix this');
    expect(md).toContain('*nice*');
    expect(md).not.toMatch(/\n{3,}/);
  });
  it('supports plain blockquotes, footnotes and no numbering', async () => {
    const md = await toMarkdown(project(), { ...defaultMd, citations: 'short', itemStyle: 'blockquote', numbering: false, frontmatter: false, comments: false, bibliography: false });
    expect(md.startsWith('# Memory')).toBe(true);
    expect(md).toContain('## Introduction');
    expect(md).toContain('> Line one\n> Line two\n> — Assmann 2011, p. 18');
    expect(md).not.toContain('Fix this');
    const fn = await toMarkdown(project(), { ...defaultMd, citations: 'footnotes', bibliography: false });
    expect(fn).toMatch(/\[\^1\]: \(Assmann, 2011, p\. 18\)/);
  });
  it('includes a formatted bibliography', async () => {
    const md = await toMarkdown(project(), { ...defaultMd, citations: 'short' });
    expect(md).toContain('## References');
    expect(md).toMatch(/Assmann, J\. \(2011\)\. Cultural Memory and Early Civilization/);
  });
});

describe('canHaveAnnotations', () => {
  it('only PDF, EPUB and snapshot attachments', () => {
    expect(canHaveAnnotations({ itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file' })).toBe(true);
    expect(canHaveAnnotations({ itemType: 'attachment', contentType: 'application/epub+zip', linkMode: 'linked_file' })).toBe(true);
    expect(canHaveAnnotations({ itemType: 'attachment', contentType: 'text/html', linkMode: 'imported_url' })).toBe(true);
    expect(canHaveAnnotations({ itemType: 'attachment', contentType: 'text/html', linkMode: 'linked_url' })).toBe(false);
    expect(canHaveAnnotations({ itemType: 'attachment', contentType: 'application/pdf', linkMode: 'linked_url' })).toBe(false);
    expect(canHaveAnnotations({ itemType: 'attachment', contentType: 'image/png', linkMode: 'imported_file' })).toBe(false);
    expect(canHaveAnnotations({ itemType: 'note' })).toBe(false);
  });
});

import { joinSecondary, secondaryPrefix } from '../../src/lib/cite';
import { shortCite, sourcesOf } from '../../src/lib/ops';
describe('secondary citations and locator labels', () => {
  function quote() {
    const kaufmann = db.create('sources', { csl: { id: 'k', type: 'entry-encyclopedia', title: 'Konfessionalisierung', author: [{ family: 'Kaufmann', given: 'Thomas' }], issued: { 'date-parts': [[1996]] }, 'container-title': 'RGG' }, tags: [] });
    const lotz = db.create('sources', { csl: { id: 'l', type: 'book', title: 'Der Umgang mit heiligen Quellen', author: [{ family: 'Lotz-Heumann', given: 'Ute' }], issued: { 'date-parts': [[2001]] } }, tags: [] });
    const q = db.create('artifacts', { kind: 'quote', text: 'x', tags: [], sourceId: lotz.id, page: '108', original: { sourceId: kaufmann.id, page: '1121', pageLabel: 'column' } });
    return { kaufmann, lotz, q };
  }
  it('joins original and source inside one pair of brackets', async () => {
    const { q } = quote();
    // APA 7 abbreviates only pages and paragraphs (APA 8.13)
    expect(await citeArtifact(q, { style: 'apa', locale: 'en-US' })).toBe('(Kaufmann, 1996, Column 1121, as cited in Lotz-Heumann, 2001, p. 108)');
    expect(await citeArtifact(q, { style: 'apa', locale: 'de-DE' })).toBe('(Kaufmann, 1996, Spalte 1121, zit. nach Lotz-Heumann, 2001, S. 108)');
    expect(await secondaryPrefix(q, { style: 'apa', locale: 'de-DE' })).toBe('Kaufmann, 1996, Spalte 1121, zit. nach');
    expect(shortCite(q)).toBe('Kaufmann 1996, col. 1121, cited in Lotz-Heumann 2001, p. 108');
  });
  it('note styles: the first citation loses its period', () => {
    expect(joinSecondary('Kaufmann, „Konfessionalisierung“, Sp. 1121.', 'Lotz-Heumann, Umgang, S. 108.', 'zit. nach')).toBe('Kaufmann, „Konfessionalisierung“, Sp. 1121, zit. nach Lotz-Heumann, Umgang, S. 108.');
    expect(joinSecondary('', '(B, 2001)', 'x')).toBe('(B, 2001)');
  });
  it('a label of its own for the location; the original goes into the bibliography', async () => {
    const { kaufmann, lotz, q } = quote();
    const c = db.create('artifacts', { kind: 'quote', text: 'y', tags: [], sourceId: kaufmann.id, page: '1121', pageLabel: 'column' });
    expect(await citeArtifact(c, { style: 'apa', locale: 'de-DE' })).toBe('(Kaufmann, 1996, Spalte 1121)');
    expect(await citeArtifact({ ...c, pageLabel: 'paragraph', page: '4' }, { style: 'apa', locale: 'de-DE' })).toBe('(Kaufmann, 1996, Abs. 4)');
    expect(sourcesOf(q).map((s) => s.id)).toEqual([lotz.id, kaufmann.id]);
    expect(sourcesOf(q, false).map((s) => s.id)).toEqual([lotz.id]);
  });
});

import { readFileSync } from 'node:fs';
describe('citation styles', () => {
  it('loads the bundled styles instead of falling back to APA', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      try {
        return new Response(readFileSync(process.cwd() + '/public/' + String(u).replace(/^.*?csl\//, 'csl/'), 'utf8'));
      } catch {
        return new Response('', { status: 404 });
      }
    }) as typeof fetch;
    try {
      const s = db.create('sources', { csl: { id: 'k', type: 'book', title: 'Konfessionalisierung', author: [{ family: 'Kaufmann', given: 'Thomas' }], issued: { 'date-parts': [[1996]] } }, tags: [] });
      const q = db.create('artifacts', { kind: 'quote', text: 'x', tags: [], sourceId: s.id, page: '1121', pageLabel: 'column' });
      expect(await citeArtifact(q, { style: 'din-1505-2', locale: 'de-DE' })).toBe('(Kaufmann, 1996, Sp. 1121)');
      expect(await citeArtifact(q, { style: 'chicago-author-date', locale: 'de-DE' })).toBe('(Kaufmann 1996, Sp. 1121)');
      expect(await citeArtifact(q, { style: 'chicago-notes-bibliography', locale: 'de-DE' })).toBe('Thomas Kaufmann, Konfessionalisierung (1996), Sp. 1121.');
      expect(await citeArtifact(q, { style: 'modern-language-association', locale: 'en-US' })).toBe('(Kaufmann, col. 1121)');
    } finally {
      globalThis.fetch = real;
    }
  });
});

import { noteCite, stripParens } from '../../src/lib/citecache.svelte';
import { settings as st } from '../../src/lib/settings.svelte';
describe('citations in footnotes', () => {
  it('drops the brackets around a whole citation only', () => {
    expect(stripParens('(Assmann, 2011, S. 18)')).toBe('Assmann, 2011, S. 18');
    expect(stripParens('(Kaufmann, 1996, Sp. 1121, zit. nach Lotz (Hg.), 2001)')).toBe('Kaufmann, 1996, Sp. 1121, zit. nach Lotz (Hg.), 2001');
    expect(stripParens('(Assmann, 2011) und (Nora, 1984)')).toBe('(Assmann, 2011) und (Nora, 1984)');
    expect(stripParens('Assmann 2011, 18.')).toBe('Assmann 2011, 18.');
  });
  it('follows the setting: citation alone (default), always, never', () => {
    st.noteParens = 'cite';
    expect(noteCite('(Assmann, 2011)', 'cite')).toBe('Assmann, 2011');
    expect(noteCite('(Assmann, 2011)', 'inline')).toBe('(Assmann, 2011)');
    // right after a quote in quotation marks, the brackets stay
    expect(noteCite('(Assmann, 2011)', 'cite', 'Vgl. „The past is […] reconstructed.“ ')).toBe('(Assmann, 2011)');
    expect(noteCite('(Assmann, 2011)', 'cite', 'Vgl. ')).toBe('Assmann, 2011');
    st.noteParens = 'all';
    expect(noteCite('(Assmann, 2011)', 'inline')).toBe('Assmann, 2011');
    st.noteParens = 'keep';
    expect(noteCite('(Assmann, 2011)', 'cite')).toBe('(Assmann, 2011)');
    st.noteParens = 'cite';
  });
});
