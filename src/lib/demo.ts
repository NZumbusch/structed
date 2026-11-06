// Demo content used by the guided tour when the user has no project yet.
import { db } from './db.svelte';
import { createProject, children, place, addChildHeading, addToProject } from './ops';
import { ui } from './ui.svelte';
import { t } from './i18n';

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
    const note = db.create('artifacts', {
      kind: 'note',
      sourceId: null,
      text: lang === 'de' ? 'Eigene Idee: Vergleich mit Social Media.' : 'Own idea: compare with social media.',
      tags: [DEMO_TAG]
    });
    addToProject(p.id, 'source', s.id);
    addToProject(p.id, 'artifact', note.id);
    place(p.id, intro.id, q1.id);
    place(p.id, sub.id, q1.id);
    return p.id;
  });
}

const demoProjects = () => db.all('projects').filter((p) => p.kind === DEMO_TAG);

/** Grace period after creating the demo: the tour itself changes nothing, so later edits are the user's. */
const GRACE = 60_000;

/**
 * Did the user work in the demo? True if anything belonging to it was changed or added
 * after it was created: its headings, placements, comments, or the sample items.
 */
export function demoEdited(): boolean {
  for (const p of demoProjects()) {
    const t0 = p.createdAt + GRACE;
    if (p.updatedAt > t0) return true;
    for (const t of ['headings', 'placements', 'comments', 'selections'] as const)
      if (db.all(t).some((e) => e.projectId === p.id && e.updatedAt > t0)) return true;
    // own items in the demo source, or edited sample items
    const demoSources = new Set(db.all('sources').filter((s) => s.tags.includes(DEMO_TAG)).map((s) => s.id));
    if (db.all('artifacts').some((a) => (a.tags.includes(DEMO_TAG) || (a.sourceId && demoSources.has(a.sourceId))) && a.updatedAt > t0)) return true;
  }
  return false;
}

/**
 * Remove the demo project and its sample sources and quotes. Never touches your own
 * data: a sample item placed or selected in one of your projects, or a sample source
 * that holds your own quotes, is kept (it just stops counting as demo content).
 * Returns how many sample items were kept that way.
 */
export function removeDemo(): { kept: number } {
  let kept = 0;
  db.batch('remove demo', () => {
    const demo = new Set(demoProjects().map((p) => p.id));
    const own = (projectId: string) => !demo.has(projectId);
    for (const id of demo) {
      for (const t of ['headings', 'placements', 'comments', 'snapshots', 'selections'] as const)
        for (const e of db.all(t)) if (e.projectId === id) db.remove(t, e.id);
      db.remove('projects', id);
    }
    const untag = (table: 'artifacts' | 'sources', id: string, tags: string[]) => {
      db.update(table, id, { tags: tags.filter((x) => x !== DEMO_TAG) });
      kept++;
    };
    for (const a of db.all('artifacts')) {
      if (!a.tags.includes(DEMO_TAG)) continue;
      const used =
        db.all('placements').some((p) => p.artifactId === a.id && own(p.projectId)) ||
        db.all('selections').some((x) => x.refType === 'artifact' && x.refId === a.id && own(x.projectId));
      if (used) untag('artifacts', a.id, a.tags);
      else db.remove('artifacts', a.id);
    }
    for (const s of db.all('sources')) {
      if (!s.tags.includes(DEMO_TAG)) continue;
      const used = db.all('artifacts').some((a) => a.sourceId === s.id) || db.all('selections').some((x) => x.refType === 'source' && x.refId === s.id && own(x.projectId));
      if (used) untag('sources', s.id, s.tags);
      else db.remove('sources', s.id);
    }
  });
  if (ui.projectId && !db.get('projects', ui.projectId)) ui.projectId = db.all('projects').sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
  return { kept };
}

/**
 * Ask, then remove the demo (with an Undo toast). `why` adds the reason shown first
 * (e.g. before the first Drive sync); `onlyIfEdited` skips the question when the demo
 * is untouched. Returns true when it was removed.
 */
export async function askRemoveDemo(why = '', onlyIfEdited = false): Promise<boolean> {
  if (!hasDemo()) return false;
  const edited = demoEdited();
  // an explicit "remove demo" click needs no second question – unless you worked in it
  const ok = (onlyIfEdited && !edited) || await ui.ask({
    title: t('Remove the demo project?'),
    text: [
      why,
      t('It contains the sample project “{name}” plus sample sources and quotes in your library.', { name: demoProjects()[0]?.title ?? 'Demo' }),
      edited ? t('You have changed or added things in the demo project – those changes will be removed too.') : '',
      t('Your own projects, sources and quotes stay untouched.')
    ]
      .filter(Boolean)
      .join('\n\n'),
    ok: t('Remove demo'),
    cancel: t('Keep demo'),
    danger: edited
  });
  if (!ok) return false;
  const { kept } = removeDemo();
  ui.toast(kept ? t('Demo removed. {n} sample items you use in your own projects were kept.', { n: kept }) : t('Demo removed.'), {
    kind: 'ok',
    action: { label: t('Undo'), run: () => db.undo() }
  });
  return true;
}

export const hasDemo = () => db.all('projects').some((p) => p.kind === DEMO_TAG);
