import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/db.svelte';
import {
  addChildHeading,
  addHeading,
  artifactLabel,
  authorsShort,
  children,
  createProject,
  deleteArtifact,
  deleteHeading,
  deleteProject,
  deleteSource,
  flatten,
  indent,
  moveHeading,
  movePlacement,
  moveUpDown,
  outdent,
  place,
  placementsOf,
  shortCite,
  sourceLabel,
  splitHeading,
  usageCount,
  wordCount,
  yearOf
} from '../../src/lib/ops';
import { createDemo, removeDemo, hasDemo } from '../../src/lib/demo';

function setup() {
  const p = createProject('Test', 'blank', 'en');
  const [root] = children(p.id, null);
  db.update('headings', root.id, { title: 'A' });
  const b = addHeading(p.id, null, root.id, 'B');
  const c = addHeading(p.id, null, b.id, 'C');
  return { p, a: db.get('headings', root.id)!, b, c };
}
const titles = (pid: string) => flatten(pid).map((f) => `${f.num} ${f.h.title}`);

describe('projects & templates', () => {
  it('creates project from template in the chosen language', () => {
    const p = createProject('X', 'seminar', 'de');
    expect(children(p.id, null).map((h) => h.title)).toEqual(['Einleitung', 'Forschungsstand', 'Theorie & Methode', 'Analyse', 'Diskussion', 'Fazit']);
  });
  it('deletes project with its headings but keeps library', () => {
    const { p, a } = setup();
    const art = db.create('artifacts', { kind: 'quote', text: 'q', tags: [] });
    place(p.id, a.id, art.id);
    deleteProject(p.id);
    expect(db.all('headings').filter((h) => h.projectId === p.id)).toHaveLength(0);
    expect(db.all('placements')).toHaveLength(0);
    expect(db.get('artifacts', art.id)).toBeDefined();
  });
});

describe('heading tree', () => {
  it('flattens with hierarchical numbering', () => {
    const { p, b } = setup();
    addChildHeading(b, 'B1');
    const b2 = addChildHeading(b, 'B2');
    addChildHeading(b2, 'B2a');
    expect(titles(p.id)).toEqual(['1 A', '2 B', '2.1 B1', '2.2 B2', '2.2.1 B2a', '3 C']);
  });
  it('hides children of collapsed headings', () => {
    const { p, b } = setup();
    addChildHeading(b, 'B1');
    expect(flatten(p.id, new Set([b.id])).map((f) => f.h.title)).toEqual(['A', 'B', 'C']);
  });
  it('indents under previous sibling and outdents after parent', () => {
    const { p, b } = setup();
    expect(indent(b)).toBe(true);
    expect(titles(p.id)).toEqual(['1 A', '1.1 B', '2 C']);
    expect(outdent(db.get('headings', b.id)!)).toBe(true);
    expect(titles(p.id)).toEqual(['1 A', '2 B', '3 C']);
  });
  it('cannot indent the first sibling or outdent a root', () => {
    const { a } = setup();
    expect(indent(a)).toBe(false);
    expect(outdent(a)).toBe(false);
  });
  it('moves up and down among siblings', () => {
    const { p, c } = setup();
    moveUpDown(c, -1);
    expect(titles(p.id)).toEqual(['1 A', '2 C', '3 B']);
    moveUpDown(db.get('headings', c.id)!, -1);
    expect(titles(p.id)).toEqual(['1 C', '2 A', '3 B']);
  });
  it('moves before/after/inside and refuses cycles', () => {
    const { p, a, b, c } = setup();
    moveHeading(c.id, a.id, 'before');
    expect(titles(p.id)).toEqual(['1 C', '2 A', '3 B']);
    moveHeading(c.id, b.id, 'inside');
    expect(titles(p.id)).toEqual(['1 A', '2 B', '2.1 C']);
    moveHeading(b.id, c.id, 'inside'); // would create a cycle
    expect(titles(p.id)).toEqual(['1 A', '2 B', '2.1 C']);
    moveHeading(a.id, b.id, 'after');
    expect(titles(p.id)).toEqual(['1 B', '1.1 C', '2 A']);
  });
  it('splitHeading splits at the caret like an outliner', () => {
    const { p, a } = setup();
    db.update('headings', a.id, { title: 'HelloWorld' });
    const id = splitHeading(db.get('headings', a.id)!, 'HelloWorld', 5, false);
    expect(db.get('headings', id)?.title).toBe('World');
    expect(titles(p.id).slice(0, 2)).toEqual(['1 Hello', '2 World']);
  });
  it('splitHeading at start inserts an empty heading before', () => {
    const { p, a } = setup();
    const id = splitHeading(a, 'A', 0, false);
    expect(id).toBe(a.id);
    expect(titles(p.id).slice(0, 2)).toEqual(['1 ', '2 A']);
  });
  it('splitHeading at end with expanded children adds first child', () => {
    const { p, b } = setup();
    addChildHeading(b, 'B1');
    const id = splitHeading(b, 'B', 1, true);
    expect(db.get('headings', id)?.parentId).toBe(b.id);
    expect(titles(p.id)).toEqual(['1 A', '2 B', '2.1 ', '2.2 B1', '3 C']);
  });
  it('deletes heading subtree with placements and comments', () => {
    const { p, b } = setup();
    const b1 = addChildHeading(b, 'B1');
    const art = db.create('artifacts', { kind: 'note', text: 'n', tags: [] });
    place(p.id, b1.id, art.id);
    db.create('comments', { projectId: p.id, targetId: b1.id, text: 'c' });
    deleteHeading(b);
    expect(titles(p.id)).toEqual(['1 A', '2 C']);
    expect(db.all('placements')).toHaveLength(0);
    expect(db.all('comments')).toHaveLength(0);
    db.undo();
    expect(titles(p.id)).toEqual(['1 A', '2 B', '2.1 B1', '3 C']);
    expect(db.all('placements')).toHaveLength(1);
  });
});

describe('placements', () => {
  it('places items, keeps order, avoids duplicates, counts usage', () => {
    const { p, a, b } = setup();
    const x = db.create('artifacts', { kind: 'quote', text: 'x', tags: [] });
    const y = db.create('artifacts', { kind: 'quote', text: 'y', tags: [] });
    place(p.id, a.id, x.id);
    const py = place(p.id, a.id, y.id);
    place(p.id, a.id, x.id, py.id); // move x before y, no duplicate
    expect(placementsOf(a.id).map((pl) => pl.artifactId)).toEqual([x.id, y.id]);
    place(p.id, b.id, x.id); // same item under another heading
    expect(usageCount(x.id, p.id)).toBe(2);
  });
  it('moves placements between headings and merges duplicates', () => {
    const { p, a, b } = setup();
    const x = db.create('artifacts', { kind: 'quote', text: 'x', tags: [] });
    const pa = place(p.id, a.id, x.id);
    movePlacement(pa.id, b.id);
    expect(placementsOf(a.id)).toHaveLength(0);
    expect(placementsOf(b.id)).toHaveLength(1);
    const pa2 = place(p.id, a.id, x.id);
    movePlacement(pa2.id, b.id); // already there → removed
    expect(placementsOf(b.id)).toHaveLength(1);
    expect(placementsOf(a.id)).toHaveLength(0);
  });
  it('deleting an item removes its placements', () => {
    const { p, a } = setup();
    const x = db.create('artifacts', { kind: 'quote', text: 'x', tags: [] });
    place(p.id, a.id, x.id);
    deleteArtifact(x);
    expect(placementsOf(a.id)).toHaveLength(0);
  });
  it('deleting a source can keep or delete its items', () => {
    const s = db.create('sources', { csl: { id: 's', type: 'book', title: 'T' }, tags: [] });
    const x = db.create('artifacts', { kind: 'quote', text: 'x', tags: [], sourceId: s.id });
    deleteSource(s, false);
    expect(db.get('artifacts', x.id)?.sourceId).toBeNull();
    const s2 = db.create('sources', { csl: { id: 's2', type: 'book', title: 'T' }, tags: [] });
    const y = db.create('artifacts', { kind: 'quote', text: 'y', tags: [], sourceId: s2.id });
    deleteSource(s2, true);
    expect(db.get('artifacts', y.id)).toBeUndefined();
  });
});

describe('labels', () => {
  const csl = (n: number) => ({
    id: 'x',
    type: 'book',
    title: 'Title',
    author: [{ family: 'Assmann', given: 'Jan' }, { family: 'Assmann', given: 'Aleida' }, { family: 'Nora', given: 'Pierre' }].slice(0, n),
    issued: { 'date-parts': [[2011]] }
  });
  it('formats author lists', () => {
    expect(authorsShort(csl(1))).toBe('Assmann');
    expect(authorsShort(csl(2))).toBe('Assmann & Assmann');
    expect(authorsShort(csl(3))).toBe('Assmann et al.');
    expect(authorsShort({ id: 'x', type: 'book', editor: [{ literal: 'UNESCO' }] })).toBe('UNESCO');
  });
  it('extracts years from date-parts and raw dates', () => {
    expect(yearOf(csl(1))).toBe('2011');
    expect(yearOf({ id: 'x', type: 'book', issued: { raw: 'Spring 1998' } })).toBe('1998');
    expect(yearOf({ id: 'x', type: 'book' })).toBe('');
  });
  it('builds short citations with page or page range', () => {
    const s = db.create('sources', { csl: csl(1), tags: [] });
    expect(sourceLabel(s)).toBe('Assmann 2011');
    const q = db.create('artifacts', { kind: 'quote', text: 'x', tags: [], sourceId: s.id, page: '18' });
    expect(shortCite(q)).toBe('Assmann 2011, p. 18');
    db.update('artifacts', q.id, { page: '18–20' });
    expect(shortCite(db.get('artifacts', q.id)!)).toBe('Assmann 2011, pp. 18–20');
  });
  it('truncates artifact labels and collapses whitespace', () => {
    const a = db.create('artifacts', { kind: 'quote', text: 'a\n\nb   c '.repeat(30), tags: [] });
    const l = artifactLabel(a, 20);
    expect(l.length).toBe(20);
    expect(l.endsWith('…')).toBe(true);
    expect(l).not.toMatch(/\s\s/);
  });
  it('counts words in markdown, including umlauts', () => {
    expect(wordCount('**Kollektives** Gedächtnis – ist _sozial_.')).toBe(4);
    expect(wordCount('')).toBe(0);
  });
});

describe('demo content', () => {
  it('creates and fully removes the demo project', () => {
    const keep = db.create('sources', { csl: { id: 'mine', type: 'book', title: 'Mine' }, tags: [] });
    createDemo('en');
    expect(hasDemo()).toBe(true);
    expect(db.all('placements').length).toBeGreaterThan(0);
    removeDemo();
    expect(hasDemo()).toBe(false);
    expect(db.all('artifacts')).toHaveLength(0);
    expect(db.all('sources').map((s) => s.id)).toEqual([keep.id]);
  });
});
