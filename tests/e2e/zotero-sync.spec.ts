import { expect, test } from '@playwright/test';
import { open, settingsTab } from './helpers';

const book = (key: string, title: string, version: number, family = 'Nora') => ({
  key,
  version,
  data: { itemType: 'book', title, tags: [{ tag: 'memory' }] },
  csljson: { id: '1/' + key, type: 'book', title, author: [{ family }], issued: { 'date-parts': [[1984]] } },
  meta: { creatorSummary: family, parsedDate: '1984', numChildren: 0 }
});

test('Zotero sources stay in sync automatically, fetching only what changed', async ({ page }) => {
  // the "Zotero server": a list of items with library versions
  let lib = [book('A', 'Les lieux de mémoire', 5), book('B', 'Das kulturelle Gedächtnis', 7, 'Assmann')];
  const members: Record<string, Set<string>> = { C1: new Set(['A']), C2: new Set(), C3: new Set() };
  const requests: string[] = [];
  await page.route('https://api.zotero.org/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const json = (body: unknown[]) => route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: { 'Total-Results': String(body.length) } });
    if (p === '/users/1/groups') return json([]);
    if (p === '/users/1/collections')
      return json([
        { key: 'C1', data: { name: 'Thesis', parentCollection: false }, meta: { numItems: 1 } },
        { key: 'C2', data: { name: 'Reading list', parentCollection: false }, meta: { numItems: 0 } },
        { key: 'C3', data: { name: 'Chapter 2', parentCollection: 'C1' }, meta: { numItems: 0 } }
      ]);
    if (p.endsWith('/items/top')) {
      requests.push(p + u.search);
      const since = Number(u.searchParams.get('since') ?? 0);
      const col = p.match(/\/collections\/(\w+)\//)?.[1];
      const scope = col ? lib.filter((x) => members[col].has(x.key)) : lib;
      return json([...scope.filter((x) => x.version > since), { key: 'PDF', version: 99, data: { itemType: 'attachment' }, csljson: {}, meta: {} }].filter((x) => x.version > since));
    }
    return route.fulfill({ status: 404, body: 'not mocked ' + p });
  });
  await open(page);
  await page.evaluate(() => Object.assign((window as any).__structed.settings, { zoteroUserId: '1', zoteroApiKey: 'KEY' }));
  const titles = () => page.evaluate(() => (window as any).__structed.db.all('sources').map((s: any) => s.csl.title).sort());

  // switch it on in the settings
  await page.getByTitle('Settings').click();
  await settingsTab(page, 'Zotero');
  await page.getByLabel(/Sync automatically/).check();
  await expect(page.locator('.zs').getByRole('combobox', { name: 'Library', exact: true })).toHaveValue('users/1');
  // the first run takes over the whole library (attachments are skipped)
  await expect.poll(titles).toEqual(['Das kulturelle Gedächtnis', 'Les lieux de mémoire']);
  await expect(page.locator('.toast', { hasText: 'Zotero: 2 new sources' })).toBeVisible();
  await expect(page.locator('.zs')).toContainText('Last checked');

  // a book added and one renamed in Zotero → only the changes are fetched
  lib = [...lib.map((x) => (x.key === 'A' ? book('A', 'Les lieux de mémoire (Bd. 1)', 120) : x)), book('C', 'Geschichte und Gedächtnis', 121, 'Le Goff')];
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect.poll(titles).toEqual(['Das kulturelle Gedächtnis', 'Geschichte und Gedächtnis', 'Les lieux de mémoire (Bd. 1)']);
  expect(requests.at(-1)).toContain('since=7');
  await expect(page.locator('.toast', { hasText: 'Zotero: 1 new sources' })).toBeVisible();

  // nothing new → one cheap request, no duplicates
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.locator('.toast', { hasText: 'everything up to date' }).first()).toBeVisible();
  expect(requests.at(-1)).toContain('since=121');
  expect(await titles()).toHaveLength(3);

  // a source deleted here does not come back, not even when it changes in Zotero
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    db.remove('sources', db.all('sources').find((s: any) => s.zoteroKey === 'B').id);
  });
  lib = lib.map((x) => (x.key === 'B' ? book('B', 'Das kulturelle Gedächtnis (2. Aufl.)', 125, 'Assmann') : x));
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.locator('.toast', { hasText: 'everything up to date' }).first()).toBeVisible();
  expect(await titles()).toEqual(['Geschichte und Gedächtnis', 'Les lieux de mémoire (Bd. 1)']);
  // …and it survives purging old deleted records
  await page.evaluate(() => (window as any).__structed.db.compact(0));
  expect(await page.evaluate(() => (window as any).__structed.db.deletedOf('sources').map((s: any) => s.zoteroKey))).toEqual(['B']);

  // several collections: ticking "Thesis" also ticks its subcollection "Chapter 2"
  const zs = page.locator('.zs');
  await zs.getByLabel('Only these collections').check();
  const box = (name: string) => zs.getByRole('group', { name: 'Collections' }).getByRole('checkbox', { name });
  await box('Thesis').check();
  await expect(box('Chapter 2')).toBeChecked();
  await expect(box('Reading list')).not.toBeChecked();
  await box('Reading list').check();
  await box('Chapter 2').uncheck();
  expect(await page.evaluate(() => [...(window as any).__structed.settings.zoteroSyncCollections].sort())).toEqual(['C1', 'C2']);
  // each chosen collection starts from scratch
  await zs.getByRole('button', { name: 'Check now' }).click();
  await expect.poll(() => requests.some((r) => r.startsWith('/users/1/collections/C2/items/top') && !r.includes('since='))).toBe(true);
  await expect.poll(() => requests.some((r) => r.startsWith('/users/1/collections/C1/items/top'))).toBe(true);
  expect(requests.some((r) => r.startsWith('/users/1/collections/C3/'))).toBe(false);

  // it also runs on its own when the app starts; a book in both collections comes once
  lib = [...lib, book('D', 'Gedächtnisräume', 130, 'Assmann')];
  members.C1.add('D');
  members.C2.add('D');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect.poll(titles, { timeout: 10_000 }).toContain('Gedächtnisräume');
  expect(await titles()).toHaveLength(3);
  expect(await titles()).not.toContain('Das kulturelle Gedächtnis (2. Aufl.)');
  // back to the whole library
  await page.getByTitle('Settings').click();
  await settingsTab(page, 'Zotero');
  await expect(page.locator('.zs').getByLabel('Only these collections')).toBeChecked();
  await page.locator('.zs').getByLabel('Whole library').check();
  expect(await page.evaluate(() => (window as any).__structed.settings.zoteroSyncCollections)).toEqual([]);
});

test('a single collection chosen in an earlier version is taken over', async ({ page }) => {
  await open(page, { settings: { zoteroSyncCollection: 'C9' } });
  expect(await page.evaluate(() => (window as any).__structed.settings.zoteroSyncCollections)).toEqual(['C9']);
  expect(await page.evaluate(() => 'zoteroSyncCollection' in (window as any).__structed.settings)).toBe(false);
});

test('automatic Zotero sync is off until switched on', async ({ page }) => {
  let calls = 0;
  await page.route('https://api.zotero.org/**', (route) => {
    calls++;
    return route.fulfill({ body: '[]', contentType: 'application/json' });
  });
  await open(page, { settings: { zoteroUserId: '1', zoteroApiKey: 'KEY' } });
  await page.waitForTimeout(2500);
  expect(calls).toBe(0);
});

test('Zotero import dialog: deleted sources are marked and skipped by “Import all”, but can be picked', async ({ page }) => {
  await page.route('https://api.zotero.org/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body: unknown[]) => route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: { 'Total-Results': String(body.length) } });
    if (p === '/users/1/groups' || p === '/users/1/collections') return json([]);
    if (p.endsWith('/items/top')) return json([book('A', 'Les lieux de mémoire', 5), book('B', 'Das kulturelle Gedächtnis', 7, 'Assmann')]);
    if (p.endsWith('/children')) return json([]);
    return route.fulfill({ status: 404, body: 'not mocked ' + p });
  });
  await open(page, { settings: { zoteroUserId: '1', zoteroApiKey: 'KEY' } });
  // B was imported once and then deleted
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const s = db.create('sources', { csl: { id: 'B', type: 'book', title: 'Das kulturelle Gedächtnis' }, tags: [], zoteroKey: 'B', zoteroLibrary: 'users/1' });
    db.remove('sources', s.id);
  });
  const titles = () => page.evaluate(() => (window as any).__structed.db.all('sources').map((s: any) => s.csl.title).sort());
  await page.evaluate(() => ((window as any).__structed.ui.dialog = 'zotero'));
  const m = page.locator('.modal');
  await expect(m.locator('.it', { hasText: 'Das kulturelle Gedächtnis' })).toContainText('deleted here – tick to import again');
  await m.getByRole('button', { name: /Import all/ }).click();
  await expect.poll(titles).toEqual(['Les lieux de mémoire']);
  // picked explicitly, it comes back
  await m.getByRole('button', { name: 'Close' }).click().catch(() => {});
  await page.evaluate(() => ((window as any).__structed.ui.dialog = 'zotero'));
  await page.locator('.modal .it', { hasText: 'Das kulturelle Gedächtnis' }).locator('input').check();
  await page.locator('.modal').getByRole('button', { name: 'Import selected' }).click();
  await expect.poll(titles).toEqual(['Das kulturelle Gedächtnis', 'Les lieux de mémoire']);
});
