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
