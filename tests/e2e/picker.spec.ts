import { expect, test, type Page } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

/** Cited / source / tag sit behind the "Filter" button of the quote search. */
async function openFilter(dlg: Locator) {
  if (!(await dlg.locator('.fpop').isVisible())) await dlg.getByRole('button', { name: /^Filter/ }).click();
}

/** Many quotes in several sources, all part of the demo project. */
async function seedMany(page: Page) {
  await seedDemo(page);
  await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const mk = (family: string, year: number, title: string) =>
      db.create('sources', { csl: { id: family, type: 'book', title, author: [{ family }], issued: { 'date-parts': [[year]] } }, tags: [] });
    const nora = mk('Nora', 1984, 'Les lieux de mémoire');
    const halb = mk('Halbwachs', 1925, 'Les cadres sociaux');
    for (let i = 1; i <= 120; i++) {
      const src = i % 2 ? nora : halb;
      const a = db.create('artifacts', { kind: i % 5 ? 'quote' : 'paraphrase', sourceId: src.id, text: `${src.csl.author[0].family} statement number ${i}` + (i === 77 ? ' about lieux' : ''), page: String(i), tags: i === 42 ? ['key'] : [] });
      db.create('selections', { projectId: ui.projectId, refType: 'artifact', refId: a.id });
      db.t.artifacts[a.id].createdAt = 1_700_000_000_000 + i * 1000; // added one after another
    }
  });
}

test('insert a quote: search, filter, sort, keyboard; the choices are remembered and can be reset', async ({ page }) => {
  await open(page);
  await seedMany(page);
  await stage(page, 'Write');
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('As shown ');
  await page.locator('.bar').getByRole('button', { name: /Insert quote/ }).click();
  const dlg = page.locator('.modal');
  const list = dlg.getByRole('listbox');
  const count = dlg.locator('.count');
  await expect(dlg.getByLabel('Search quotes')).toBeFocused();
  // only the first ones are drawn; more on request
  await expect(count).toContainText(/1\d\d found/);
  await expect(list.getByRole('option')).toHaveCount(80);
  await list.getByRole('button', { name: /Show \d+ more/ }).click();
  await expect(list.getByRole('option').first()).toBeVisible();

  // search: several words, across text, author and page
  await dlg.getByLabel('Search quotes').fill('nora lieux'); // the title of Nora's book has "lieux"
  await expect(count).toContainText(/^60 found/);
  await dlg.getByLabel('Search quotes').fill('nora about lieux');
  await expect(count).toContainText(/^1 found/);
  await page.keyboard.press('Enter');
  await expect(dlg).toHaveCount(0);
  await expect(ed.locator('.qref')).toContainText('Nora statement number 77 about lieux');

  // filter by source and type, sort by recently used – then reopen: still set
  await page.locator('.bar').getByRole('button', { name: /Insert quote/ }).click();
  await openFilter(dlg);
  await dlg.getByLabel('Source').selectOption({ label: 'Halbwachs 1925 – Les cadres sociaux' });
  await dlg.getByRole('button', { name: 'quote', exact: true }).click(); // paraphrases only now
  await expect(count).toContainText(/^12 found/);
  await expect(list.getByRole('option').first()).toContainText('Halbwachs statement number 10');
  await dlg.getByLabel('Sort').selectOption('added');
  await expect(list.getByRole('option').first()).toContainText('Halbwachs statement number 120');
  // arrow keys move, Enter inserts the active one
  await dlg.getByLabel('Search quotes').press('ArrowDown');
  await dlg.getByLabel('Search quotes').press('Enter');
  // a paraphrase goes in as your own text with its citation
  await expect(ed).toContainText('Halbwachs statement number 110 (Halbwachs, 1925, p. 110)');

  await page.locator('.bar').getByRole('button', { name: /Insert quote/ }).click();
  await expect(count).toContainText(/^12 found/); // remembered
  await expect(dlg.getByLabel('Sort')).toHaveValue('added');
  await dlg.getByLabel('Sort').selectOption('recent');
  await expect(list.getByRole('option').first()).toContainText('Halbwachs statement number 110'); // used last
  await dlg.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(count).toContainText(/1\d\d found/);
  await expect(dlg.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0);

  // "this section": only what is placed under the heading being written
  await dlg.getByRole('button', { name: 'Section' }).click();
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option')).toContainText('The past is not simply');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
});

test('the footnote dialog uses the same search', async ({ page }) => {
  await open(page);
  await seedMany(page);
  await stage(page, 'Write');
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.locator('.bar').getByRole('button', { name: /Footnote/ }).click();
  const dlg = page.locator('.modal');
  await expect(dlg.locator('.fed .ProseMirror')).toBeFocused();
  await page.keyboard.type('Vgl. ');
  await dlg.getByRole('button', { name: /Insert citation/ }).click();
  await dlg.getByLabel('Search quotes').fill('statement number 42');
  await dlg.getByLabel('Search quotes').press('Enter');
  await expect(dlg.getByRole('listbox')).toHaveCount(0); // closes after picking
  await page.keyboard.type('; ferner ');
  await dlg.getByRole('button', { name: /Insert citation/ }).click();
  await dlg.getByLabel('Search quotes').fill('key'); // tags are searched too
  await expect(dlg.locator('.count')).toContainText(/^1 found/);
  // Esc closes only the search, not the footnote
  await dlg.getByLabel('Search quotes').press('Escape');
  await expect(dlg.getByRole('listbox')).toHaveCount(0);
  await expect(dlg.locator('h2')).toHaveText('Footnote');
  await expect(dlg.locator('.fed')).toContainText('Vgl. (Halbwachs, 1925, p. 42); ferner');
});
