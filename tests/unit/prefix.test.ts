import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db.svelte';
import { convertDraft, migratePrefixes, prefixText } from '../../src/lib/citePrefix';
import { createProject } from '../../src/lib/ops';
import { draftText } from '../../src/lib/draft';
import { footnotePlain, toClipboard, type PMNode } from '../../src/lib/footnote';

const q = (prefix?: string) => ({ type: 'quoteRef', attrs: { id: 'A', mode: 'cite', ...(prefix ? { prefix } : {}) } });
const txt = (text: string, marks?: { type: string }[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = (...paras: PMNode[][]) => JSON.stringify({ type: 'doc', content: paras.map((c) => ({ type: 'paragraph', content: c })) });

describe('word in front of a citation', () => {
  it('is shown as written, with a capital at the start or after a full stop', () => {
    expect(prefixText('vgl.', '')).toBe('Vgl. ');
    expect(prefixText('vgl.', 'dazu ')).toBe('vgl. ');
    expect(prefixText('vgl.', 'Ende. ')).toBe('Vgl. ');
    expect(prefixText('Vgl.', 'mitten ')).toBe('Vgl. '); // never lowered
    expect(prefixText('s.', null)).toBe('s. ');
    expect(prefixText(null, '')).toBe('');
  });
  it('converts "Vgl. ", "vgl. ", "s. ", "cf. " … in front of citations, in text and footnotes, exactly as written', () => {
    const before = doc(
      [txt('Wie gesagt, vgl. '), q(), txt('; ferner s. '), q()],
      [txt('Text'), { type: 'footnote', attrs: { content: [txt('Vgl. '), q(), txt('; cf. '), q()] } }],
      [txt('Siehe auch '), q(), txt(' und '), txt('vgl. ', [{ type: 'italic' }]), q()]
    );
    const r = convertDraft(before)!;
    expect(r.n).toBe(4);
    const d = JSON.parse(r.draft);
    expect(d.content[0].content).toEqual([txt('Wie gesagt, '), q('vgl.'), txt('; ferner '), q('s.')]);
    expect(d.content[1].content[1].attrs.content).toEqual([q('Vgl.'), txt('; '), q('cf.')]);
    // "Siehe auch" is no prefix directly in front; italic "vgl." keeps its formatting as text
    expect(d.content[2].content).toEqual(JSON.parse(before).content[2].content);
    // nothing left to convert: the same again does nothing
    expect(convertDraft(r.draft)).toBeNull();
  });
  it('looks exactly the same after converting (footnote, copy, word count)', () => {
    const p = createProject('P');
    const src = db.create('sources', { csl: { id: 'S', type: 'book', title: 'T', author: [{ family: 'Assmann' }], issued: { 'date-parts': [[2011]] } }, tags: [] });
    const a = db.create('artifacts', { kind: 'quote', sourceId: src.id, text: 'Erinnerung', page: '18', tags: [] });
    const note = (c: PMNode[]) => footnotePlain(c);
    const old = [txt('Vgl. '), { type: 'quoteRef', attrs: { id: a.id, mode: 'cite' } }, txt('; s. '), { type: 'quoteRef', attrs: { id: a.id, mode: 'cite' } }];
    const json = doc([txt('Vgl. '), { type: 'quoteRef', attrs: { id: a.id, mode: 'cite' } }, { type: 'footnote', attrs: { content: old } }]);
    const h = db.create('headings', { projectId: p.id, parentId: null, order: 1, title: 'H', body: '', draft: json });
    const plainBefore = note(old);
    const clipBefore = toClipboard(JSON.parse(json).content);
    const countBefore = draftText(json).split(/\s+/).filter(Boolean).length;
    const snaps = db.all('snapshots').length;
    expect(migratePrefixes()).toBe(3);
    expect(db.all('snapshots').length).toBe(snaps + 1); // a snapshot first
    const now = db.get('headings', h.id)!.draft!;
    expect(JSON.parse(now).content[0].content[0]).toEqual({ type: 'quoteRef', attrs: { id: a.id, mode: 'cite', prefix: 'Vgl.' } });
    expect(note(JSON.parse(now).content[0].content[1].attrs.content)).toBe(plainBefore);
    expect(toClipboard(JSON.parse(now).content)).toEqual(clipBefore);
    expect(draftText(now).split(/\s+/).filter(Boolean).length).toBe(countBefore);
    expect(migratePrefixes()).toBe(0); // only once
  });
});
