import { expect, test, type Page } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

const item = (key: string, title: string, collections: string[], family = 'Kant') => ({
  key,
  version: 10,
  data: { itemType: 'book', title, tags: [], collections },
  csljson: { id: '1/' + key, type: 'book', title, author: [{ family }], issued: { 'date-parts': [[1781]] } },
  meta: { creatorSummary: family, parsedDate: '1781', numChildren: 1 }
});

/** A small "Zotero server": collection Paper (C1) with subcollection Ch. 2 (C2), highlights on A's PDF. */
async function zotero(page: Page) {
  const members: Record<string, string[]> = { C1: ['A'], C2: ['B'], C3: [] };
  const items = [item('A', 'Kritik der reinen Vernunft', ['C1']), item('B', 'Prolegomena', ['C2'], 'Hume'), item('X', 'Unrelated', ['C3'], 'Other')];
  const anns = [
    { key: 'H1', data: { itemType: 'annotation', parentItem: 'ATT', annotationType: 'highlight', annotationText: 'Erste Markierung' } },
    { key: 'H2', data: { itemType: 'annotation', parentItem: 'ATT', annotationType: 'highlight', annotationText: 'Zweite Markierung' } },
    { key: 'H3', data: { itemType: 'annotation', parentItem: 'ATT', annotationType: 'ink' } }
  ];
  const calls: string[] = [];
  await page.route('https://api.zotero.org/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    calls.push(p + u.search);
    const json = (body: unknown, version = 50) =>
      route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: { 'Total-Results': String(Array.isArray(body) ? body.length : 1), 'Last-Modified-Version': String(version) } });
    if (p === '/users/1/groups') return json([]);
    if (p === '/users/1/collections')
      return json([
        { key: 'C1', data: { name: 'Paper', parentCollection: false }, meta: { numItems: 1 } },
        { key: 'C2', data: { name: 'Ch. 2', parentCollection: 'C1' }, meta: { numItems: 1 } },
        { key: 'C3', data: { name: 'Other', parentCollection: false }, meta: { numItems: 1 } }
      ]);
    const col = p.match(/^\/users\/1\/collections\/(\w+)\/items\/top$/)?.[1];
    if (col && u.searchParams.get('format') === 'keys') return route.fulfill({ body: members[col].join('\n'), contentType: 'text/plain' });
    if (p === '/users/1/items' && u.searchParams.get('itemType') === 'annotation') return json(Number(u.searchParams.get('since') ?? 0) >= 50 ? [] : anns);
    if (p === '/users/1/items' && u.searchParams.get('itemKey')) {
      const keys = u.searchParams.get('itemKey')!.split(',');
      return json([...items.filter((x) => keys.includes(x.key)), ...(keys.includes('ATT') ? [{ key: 'ATT', data: { itemType: 'attachment', parentItem: 'A', contentType: 'application/pdf' } }] : [])]);
    }
    if (p === '/users/1/items/ATT/children') return json(anns);
    if (p === '/users/1/deleted') return json({ items: [] });
    if (p === '/users/1/items/A/children') return json([{ key: 'ATT', data: { itemType: 'attachment', parentItem: 'A', contentType: 'application/pdf', linkMode: 'imported_file' } }]);
    return route.fulfill({ status: 404, body: 'not mocked ' + p });
  });
  return { calls, members };
}

test('a project linked to a Zotero collection: sources come in, new highlights, reading status, open in Zotero', async ({ page }) => {
  const z = await zotero(page);
  await open(page, { settings: { zoteroUserId: '1', zoteroApiKey: 'KEY' } });
  await seedDemo(page);
  await stage(page, 'Select');
  const right = page.locator('.col.proj');

  // link the collection "Paper": its items and those of its subcollection join the project
  await right.getByRole('button', { name: 'Link a Zotero collection…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Link a Zotero collection' });
  await dlg.getByLabel('Paper').check();
  await dlg.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(page.locator('.toast', { hasText: '2 sources from “Paper” are in this project' })).toBeVisible();
  await expect(right.locator('.zl')).toContainText('Zotero collection: Paper');
  const row = (name: string) => right.locator('.src', { hasText: name }).locator('.srow');
  await expect(row('Kant 1781').first()).toContainText('Zotero collection');
  await expect(right.locator('.src', { hasText: 'Other' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__structed.db.all('sources').filter((s: any) => s.zoteroKey).length)).toBe(2);

  // highlights not gone through yet: two with text (the ink drawing does not count)
  const a = right.locator('.src').filter({ has: page.locator('.hl') });
  await expect(a.locator('.hl')).toHaveText('2');
  await expect(right.getByRole('button', { name: '2 new highlights' })).toBeVisible();
  // skipping one in the review leaves one
  await a.locator('.hl').click();
  await expect(page.locator('.modal')).toContainText('Erste Markierung');
  await page.keyboard.press('s');
  await page.keyboard.press('Escape');
  await expect(a.locator('.hl')).toHaveText('1');

  // reading status: a quiet dot that cycles to read → reading → read → none
  const dot = a.locator('.rd');
  await expect(dot).toHaveAttribute('aria-label', 'Reading status: No reading status');
  await dot.click();
  await expect(dot).toHaveAttribute('aria-label', 'Reading status: To read');
  await dot.click();
  await dot.click();
  await expect(dot).toHaveAttribute('aria-label', 'Reading status: Read');
  await expect(right.locator('header')).toContainText('1 of 3 sources read');

  // open in Zotero (the app link)
  await a.getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Show in Zotero' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Open PDF in Zotero' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__structed.db.all('sources').find((s: any) => s.zoteroKey === 'A').reading)).toBe('read');

  // left out here although it is in the collection; and back again
  await row('Hume 1781').getByTitle('Remove source from project').click();
  await expect(right.locator('.src', { hasText: 'Hume 1781' })).toHaveCount(0);
  await page.locator('.col.lib .src', { hasText: 'Prolegomena' }).getByRole('button', { name: 'Source' }).click();
  await expect(row('Hume 1781')).toContainText('Zotero collection');

  // both can be switched off
  await page.evaluate(() => Object.assign((window as any).__structed.settings, { readingStatus: false, zoteroHighlightCounts: false }));
  await expect(right.locator('.rd')).toHaveCount(0);
  await expect(right.locator('.hl')).toHaveCount(0);
  expect(z.calls.some((c) => c.includes('format=keys'))).toBe(true);
});

test('things collected while a project is open belong to it', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  await stage(page, 'Collect');
  // a new source…
  await page.getByTitle('New source').click();
  const ed = page.locator('.modal');
  await ed.getByLabel('Title', { exact: true }).fill('Fresh find');
  await ed.getByRole('button', { name: 'Save' }).click();
  // …and a quick note without a source
  await page.locator('button.src.special', { hasText: 'Own notes' }).click();
  await page.locator('.capture textarea').fill('An idea while writing');
  await page.locator('.capture textarea').press('Control+Enter');
  const inProject = () =>
    page.evaluate(() => {
      const s = (window as any).__structed;
      const pid = s.ui.projectId;
      const src = s.db.all('sources').find((x: any) => x.csl.title === 'Fresh find');
      const note = s.db.all('artifacts').find((x: any) => x.text === 'An idea while writing');
      return [!!src && s.db.all('selections').some((x: any) => x.projectId === pid && x.refId === src.id), !!note && s.db.all('selections').some((x: any) => x.projectId === pid && x.refId === note.id)];
    });
  await expect.poll(inProject).toEqual([true, true]);
});
