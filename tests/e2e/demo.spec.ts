import { expect, test, type Page } from '@playwright/test';
import { open, seedDemo } from './helpers';

const S = (page: Page, fn: (s: any) => unknown) => page.evaluate(fn as any);
const restartTour = async (page: Page) => {
  await page.evaluate(() => ((window as any).__structed.ui.tour = true));
  const bubble = page.locator('.tour .bubble');
  await expect(bubble).toBeVisible();
  const total = Number((await bubble.locator('.tiny').textContent())!.split('/')[1]);
  for (let i = 1; i < total; i++) await bubble.getByRole('button', { name: 'Next' }).click();
  return bubble;
};

test('removing the demo never touches your own data', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  // own work next to the demo: an own project that uses a demo quote, an own quote in the demo source
  await S(page, () => {
    const { db } = (window as any).__structed;
    const demoQuote = db.all('artifacts').find((a: any) => a.text.startsWith('The past'));
    const demoSource = db.all('sources').find((s: any) => s.tags.includes('structed-demo'));
    const p = db.create('projects', { title: 'My thesis', kind: 'thesis' });
    const h = db.create('headings', { projectId: p.id, parentId: null, title: 'Chapter 1', body: '', order: 'a' });
    db.create('placements', { projectId: p.id, headingId: h.id, artifactId: demoQuote.id, order: 'a' });
    db.create('artifacts', { kind: 'quote', sourceId: demoSource.id, text: 'My own quote from Assmann', tags: [] });
    db.create('artifacts', { kind: 'note', sourceId: null, text: 'Unrelated own note', tags: [] });
  });
  // restarting the tour later offers the removal with a clear button
  const bubble = await restartTour(page);
  await expect(bubble).toContainText('Start with a clean slate?');
  await expect(bubble).toContainText('your own projects, sources and quotes stay');
  await bubble.getByRole('button', { name: 'Remove demo & start fresh' }).click();
  // you worked next to the demo, but not *in* it → no extra question
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.toast', { hasText: 'Demo removed. 2 sample items you use in your own projects were kept.' })).toBeVisible();

  const state = await S(page, () => {
    const { db } = (window as any).__structed;
    return {
      projects: db.all('projects').map((p: any) => p.title),
      artifacts: db.all('artifacts').map((a: any) => a.text).sort(),
      sources: db.all('sources').map((s: any) => s.csl.title),
      tagged: db.all('artifacts').concat(db.all('sources')).filter((x: any) => x.tags.includes('structed-demo')).length
    };
  });
  expect(state.projects).toEqual(['My thesis']);
  // kept: the demo quote placed in "My thesis", the source holding my own quote, my own items
  expect(state.artifacts).toEqual(['My own quote from Assmann', 'The past is not simply preserved but reconstructed.', 'Unrelated own note']);
  expect(state.sources).toEqual(['Cultural Memory and Early Civilization']);
  expect(state.tagged).toBe(0); // they are your items now

  // and it can be undone
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => S(page, () => (window as any).__structed.db.all('projects').length)).toBe(2);
});

test('if you worked in the demo project, removing it asks first', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  await S(page, () => {
    const { db, ui } = (window as any).__structed;
    db.t.projects[ui.projectId].createdAt -= 5 * 60_000; // the demo was created a while ago…
    const h = db.all('headings').find((x: any) => x.projectId === ui.projectId);
    db.update('headings', h.id, { body: 'My real thoughts, written into the demo' }); // …and then used
  });
  const bubble = await restartTour(page);
  await bubble.getByRole('button', { name: 'Remove demo & start fresh' }).click();
  const dlg = page.locator('.modal');
  await expect(dlg).toContainText('You have changed or added things in the demo project');
  await dlg.getByRole('button', { name: 'Keep demo' }).click();
  expect(await S(page, () => (window as any).__structed.db.all('projects').length)).toBe(1);
  // the project menu offers it again
  await page.getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'Remove demo project…' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Remove demo' }).click();
  await expect.poll(() => S(page, () => (window as any).__structed.db.all('projects').length)).toBe(0);
});

test('a tour started later with your own projects creates and removes nothing', async ({ page }) => {
  await open(page);
  await S(page, () => {
    const { db, ui } = (window as any).__structed;
    const p = db.create('projects', { title: 'My thesis', kind: 'thesis' });
    db.create('sources', { csl: { id: 'x', type: 'book', title: 'Own book' }, tags: [] });
    ui.projectId = p.id;
  });
  const bubble = await restartTour(page);
  await expect(bubble.getByRole('button', { name: /Remove demo/ })).toHaveCount(0);
  await expect(bubble).not.toContainText('clean slate');
  await bubble.getByRole('button', { name: 'Done' }).click();
  const n = await S(page, () => {
    const { db } = (window as any).__structed;
    return [db.all('projects').length, db.all('sources').length, db.all('artifacts').length];
  });
  expect(n).toEqual([1, 1, 0]);
});
