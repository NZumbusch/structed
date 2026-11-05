// Demo content used by the guided tour when the user has no project yet.
import { db } from './db.svelte';
import { createProject, children, place, addChildHeading } from './ops';

export const DEMO_TAG = 'structed-demo';

export function createDemo(lang: 'en' | 'de'): string {
  return db.batch('demo project', () => {
    const p = createProject(lang === 'de' ? 'Demo: Erinnerung & Medien' : 'Demo: Memory & Media', 'essay', lang);
    db.update('projects', p.id, {
      kind: DEMO_TAG,
      subtitle: lang === 'de' ? 'Wie prägen Medien das kollektive Gedächtnis?' : 'How do media shape collective memory?'
    });
    const [intro, main] = children(p.id, null);
    db.update('headings', intro.id, {
      body: lang === 'de' ? 'Ausgangsfrage und **These** skizzieren.' : 'Sketch the starting question and the **thesis**.',
      status: 'draft'
    });
    const sub = addChildHeading(main, lang === 'de' ? 'Kulturelles Gedächtnis' : 'Cultural memory');
    const s = db.create('sources', {
      csl: {
        id: 'assmann2011',
        type: 'book',
        title: 'Cultural Memory and Early Civilization',
        author: [{ family: 'Assmann', given: 'Jan' }],
        issued: { 'date-parts': [[2011]] },
        publisher: 'Cambridge University Press',
        'publisher-place': 'Cambridge'
      },
      tags: [DEMO_TAG]
    });
    const q1 = db.create('artifacts', {
      kind: 'quote',
      sourceId: s.id,
      text: 'The past is not simply preserved but reconstructed.',
      page: '18',
      tags: ['memory', DEMO_TAG],
      comment: lang === 'de' ? 'Gut für die Einleitung.' : 'Good opener.'
    });
    db.create('artifacts', {
      kind: 'paraphrase',
      sourceId: s.id,
      text: lang === 'de' ? 'Erinnerung ist sozial gerahmt und medial vermittelt.' : 'Memory is socially framed and mediated.',
      page: '22–23',
      tags: ['media', DEMO_TAG]
    });
    db.create('artifacts', {
      kind: 'note',
      sourceId: null,
      text: lang === 'de' ? 'Eigene Idee: Vergleich mit Social Media.' : 'Own idea: compare with social media.',
      tags: [DEMO_TAG]
    });
    place(p.id, intro.id, q1.id);
    place(p.id, sub.id, q1.id);
    return p.id;
  });
}

export function removeDemo() {
  db.batch('remove demo', () => {
    for (const p of db.all('projects')) {
      if (p.kind !== DEMO_TAG) continue;
      for (const t of ['headings', 'placements', 'comments', 'snapshots'] as const)
        for (const e of db.all(t)) if (e.projectId === p.id) db.remove(t, e.id);
      db.remove('projects', p.id);
    }
    for (const a of db.all('artifacts')) if (a.tags.includes(DEMO_TAG)) db.remove('artifacts', a.id);
    for (const s of db.all('sources')) if (s.tags.includes(DEMO_TAG)) db.remove('sources', s.id);
  });
}

export const hasDemo = () => db.all('projects').some((p) => p.kind === DEMO_TAG);
