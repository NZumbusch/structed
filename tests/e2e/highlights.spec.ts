import { expect, test, type Page } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

/** A fake Zotero: one book with five highlights in its PDF, one with two. */
async function fakeZotero(page: Page, calls: string[] = []) {
  const ann = (key: string, text: string, page: string, sort: string, extra: Record<string, unknown> = {}) => ({
    key,
    data: { itemType: 'annotation', parentItem: key.startsWith('B') ? 'PDFB' : 'PDFA', annotationType: 'highlight', annotationText: text, annotationComment: '', annotationColor: '#ffd400', annotationPageLabel: page, annotationSortIndex: sort, tags: [], ...extra }
  });
  await page.route('https://api.zotero.org/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    calls.push(p + u.search);
    const json = (body: unknown[]) => route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: { 'Total-Results': String(body.length) } });
    if (p === '/users/1/items/A/children') return json([{ key: 'PDFA', data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file' } }]);
    if (p === '/users/1/items/B/children') return json([{ key: 'PDFB', data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file' } }]);
    if (p === '/users/1/items/PDFA/children')
      return json([
        ann('A1', 'Lieux de mé-\nmoire are remains', '12', '1', { annotationComment: 'key idea' }),
        ann('A2', 'just a half sentence', '13', '2'),
        ann('A3', 'another fragment', '14', '3'),
        ann('A4', 'memory is life, borne by living societies', '15', '4'),
        ann('A5', 'the last one', '16', '5')
      ]);
    if (p === '/users/1/items/PDFB/children') return json([ann('B1', 'Halbwachs first', '3', '1'), ann('B2', 'Halbwachs second', '4', '2')]);
    if (p.endsWith('/items/top')) return json([]);
    return route.fulfill({ status: 404, body: 'not mocked ' + p });
  });
  await page.evaluate(() => {
    const { db, settings } = (window as any).__structed;
    Object.assign(settings, { zoteroUserId: '1', zoteroApiKey: 'KEY' });
    db.create('sources', { csl: { id: 'A', type: 'book', title: 'Les lieux de mémoire', author: [{ family: 'Nora' }], issued: { 'date-parts': [[1984]] } }, tags: [], zoteroKey: 'A', zoteroLibrary: 'users/1' });
    db.create('sources', { csl: { id: 'B', type: 'book', title: 'La mémoire collective', author: [{ family: 'Halbwachs' }], issued: { 'date-parts': [[1950]] } }, tags: [], zoteroKey: 'B', zoteroLibrary: 'users/1' });
  });
}
const texts = (page: Page) => page.evaluate(() => (window as any).__structed.db.all('artifacts').filter((a: any) => a.zoteroKey).map((a: any) => `${a.kind}:${a.text}`).sort());

test('go through the highlights of a source one by one: take, skip, edit, paraphrase, back', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  await fakeZotero(page);
  await stage(page, 'Collect');
  await page.locator('.src', { hasText: 'Nora 1984' }).click();
  await page.getByRole('button', { name: 'Go through highlights…' }).click();
  const dlg = page.locator('.modal');
  await expect(dlg.locator('.txt')).toHaveText('Lieux de mémoire are remains'); // cleaned up (hyphenation)
  await expect(dlg).toContainText('key idea');
  await expect(dlg).toContainText('5 left');
  await page.keyboard.press('Enter'); // take
  await expect(dlg.locator('.txt')).toHaveText('just a half sentence');
  await page.keyboard.press('s'); // skip
  await page.keyboard.press('s');
  await expect(dlg.locator('.txt')).toHaveText('memory is life, borne by living societies');
  // edit before taking
  await page.keyboard.press('e');
  await dlg.getByLabel('Text').fill('memory is life […]');
  await dlg.getByLabel('Text').press('Control+Enter');
  await expect(dlg.locator('.txt')).toHaveText('the last one');
  await page.keyboard.press('p'); // as paraphrase
  await expect(dlg).toContainText('All highlights gone through: 3 taken, 2 skipped.');
  expect(await texts(page)).toEqual(['paraphrase:the last one', 'quote:Lieux de mémoire are remains', 'quote:memory is life […]']);
  // back steps undo the decisions
  await page.keyboard.press('z');
  await expect(dlg.locator('.txt')).toHaveText('the last one');
  await page.keyboard.press('Enter');
  expect(await texts(page)).toContain('quote:the last one');
  // the taken ones are part of the open project
  expect(await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const a = db.all('artifacts').find((x: any) => x.zoteroKey === 'A1');
    return db.all('selections').some((s: any) => s.projectId === ui.projectId && s.refId === a.id);
  })).toBe(true);
  await dlg.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.items .art')).toHaveCount(3);

  // again: nothing new; the skipped ones only on request
  await page.getByRole('button', { name: 'Go through highlights…' }).click();
  await expect(dlg).toContainText('No new highlights in these sources.');
  await dlg.getByRole('button', { name: 'Show the 2 skipped before again' }).click();
  await expect(dlg.locator('.txt')).toHaveText('just a half sentence');
  await expect(dlg).toContainText('skipped before');
});

test('several sources at once, from the selection; "skip the rest of this source"', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  await fakeZotero(page);
  await stage(page, 'Collect');
  await page.locator('.src', { hasText: 'Nora 1984' }).click({ modifiers: ['Control'] });
  await page.locator('.src', { hasText: 'Halbwachs 1950' }).click({ modifiers: ['Control'] });
  await page.getByRole('toolbar', { name: 'Selected sources' }).getByRole('button', { name: 'Actions for selected sources' }).click();
  await page.getByRole('menuitem', { name: 'Go through highlights…' }).click();
  const dlg = page.locator('.modal');
  // in the order of the list: Halbwachs, then Nora
  await expect(dlg).toContainText('Source 1 of 2');
  await expect(dlg.locator('.txt')).toHaveText('Halbwachs first');
  await page.keyboard.press('Enter');
  await page.keyboard.press('s');
  await expect(dlg).toContainText('Source 2 of 2');
  await expect(dlg.locator('.txt')).toHaveText('Lieux de mémoire are remains');
  await page.keyboard.press('Enter');
  await dlg.getByRole('button', { name: /Skip the remaining 4 of this source/ }).click();
  await expect(dlg).toContainText('2 taken, 5 skipped');
});

test('delete imported highlights nobody uses; they are not offered again', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  await fakeZotero(page);
  await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const a = db.all('sources').find((s: any) => s.zoteroKey === 'A');
    const mk = (key: string, text: string) => db.create('artifacts', { kind: 'quote', sourceId: a.id, text, page: '1', tags: [], zoteroKey: key });
    mk('A1', 'used one');
    mk('A2', 'fragment two');
    mk('A3', 'fragment three');
    const h = db.all('headings').find((x: any) => x.projectId === ui.projectId);
    db.create('placements', { projectId: ui.projectId, headingId: h.id, artifactId: db.all('artifacts').find((x: any) => x.text === 'used one').id, order: 'a' });
  });
  await stage(page, 'Collect');
  // the clean-up view lists them across all sources
  await page.locator('.src', { hasText: 'Unused Zotero highlights' }).click();
  await expect(page.locator('.items .art')).toHaveCount(2);
  await page.locator('.src', { hasText: 'Nora 1984' }).click();
  await page.getByRole('button', { name: 'Delete 2 unused highlights' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Delete 2' }).click();
  await expect(page.locator('.items .art')).toHaveCount(1);
  await expect(page.locator('.items .art')).toContainText('used one');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.items .art')).toHaveCount(3);
  await page.getByRole('button', { name: 'Delete 2 unused highlights' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Delete 2' }).click();
  // going through: the deleted ones count as skipped
  await page.getByRole('button', { name: 'Go through highlights…' }).click();
  const dlg = page.locator('.modal');
  await expect(dlg.locator('.txt')).toHaveText('memory is life, borne by living societies');
  await expect(dlg).toContainText('2 left');
});

test('opening the quote search checks Zotero for new sources in the background', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  const calls: string[] = [];
  await fakeZotero(page, calls);
  await page.evaluate(() => Object.assign((window as any).__structed.settings, { zoteroAutoSync: true, zoteroSyncLibrary: 'users/1' }));
  await stage(page, 'Write');
  await expect.poll(() => calls.filter((c) => c.includes('/items/top')).length).toBeGreaterThan(0); // the start-up check
  const n = calls.filter((c) => c.includes('/items/top')).length;
  await page.evaluate(() => ((window as any).__structed.settings.zoteroSyncVersions = {})); // pretend it was long ago…
  await page.locator('.compose .ProseMirror').first().click();
  await page.keyboard.press('Control+Alt+z');
  await expect(page.getByLabel('Search quotes')).toBeFocused();
  // …no: it ran just now (at start), so it waits 30 s – nothing extra
  await page.waitForTimeout(300);
  expect(calls.filter((c) => c.includes('/items/top')).length).toBe(n);
  await page.keyboard.press('Escape');
  // 30 s later, opening the search checks again
  await page.evaluate(() => ((window as any).__structed.zsync.lastRun -= 31_000));
  await page.keyboard.press('Control+Alt+z');
  await expect.poll(() => calls.filter((c) => c.includes('/items/top')).length).toBe(n + 1);
  await expect(page.locator('.modal .count')).toContainText('found');
});
