import { expect, test, type Page } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

/** Cited / source / tag sit behind the "Filter" button of the quote search. */
async function openFilter(dlg: Locator) {
  if (!(await dlg.locator('.fpop').isVisible())) await dlg.getByRole('button', { name: /^Filter/ }).click();
}

async function setup(page: Page) {
  await open(page);
  await seedDemo(page);
  await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const nora = db.create('sources', { csl: { id: 'n', type: 'book', title: 'Les lieux de mémoire', author: [{ family: 'Nora' }], issued: { 'date-parts': [[1984]] } }, tags: [] });
    const q = db.create('artifacts', { kind: 'quote', sourceId: nora.id, text: 'Lieux de mémoire are remains', page: '12', tags: ['places'], comment: 'Central definition' });
    db.create('selections', { projectId: ui.projectId, refType: 'source', refId: nora.id });
    // a source NOT selected for the project
    const beish = db.create('sources', { csl: { id: 'b', type: 'article-journal', title: 'Chaos and Control', author: [{ family: 'Beish' }], issued: { 'date-parts': [[1992]] } }, tags: [] });
    db.create('artifacts', { kind: 'quote', sourceId: beish.id, text: 'The first was Andreas Karlstadt', page: '44', tags: [] });
    return q.id;
  });
  await stage(page, 'Write');
  await expect(page.locator('.compose .ProseMirror').first()).toBeVisible();
}

test('the library panel is off in Write by default, and a setting brings it back', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.app .panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Library panel/ })).toHaveCount(0);
  await page.locator('.compose .ProseMirror').first().click();
  await page.keyboard.press('Control+\\');
  await expect(page.locator('.toast', { hasText: 'Insert quote' })).toBeVisible();
  await page.evaluate(() => ((window as any).__structed.settings.writePanel = true));
  await page.getByRole('button', { name: /^Library panel/ }).click();
  await expect(page.locator('.app .panel')).toBeVisible();
});

test('quote search: preview, groups, tag and "already in the text" filters, edit, new quote, Ctrl+Enter, library hint', async ({ page }) => {
  await setup(page);
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.press('Control+Alt+z'); // the shortcut opens it
  const dlg = page.locator('.modal');
  await expect(dlg.getByLabel('Search quotes')).toBeFocused();
  // preview of the marked quote: full text, comment, source
  await dlg.getByLabel('Search quotes').fill('remains');
  const pv = dlg.getByRole('complementary', { name: 'Preview' });
  await expect(pv).toContainText('Lieux de mémoire are remains');
  await expect(pv).toContainText('Central definition');
  await expect(pv).toContainText('Les lieux de mémoire · p. 12');
  // Ctrl+Enter inserts and keeps the search open; the item is now marked "in text"
  await dlg.getByLabel('Search quotes').press('Control+Enter');
  await expect(dlg).toBeVisible();
  await expect(ed.locator('.qref')).toHaveCount(1);
  await expect(dlg.getByRole('listbox', { name: 'Quotes' }).getByRole('option').first()).toContainText('in text');
  await openFilter(dlg);
  await dlg.getByLabel('Cited in the text').selectOption('unused');
  await expect(dlg.locator('.count')).toContainText(/^0 found/);
  await dlg.getByLabel('Cited in the text').selectOption('all');
  // a quote from a source not selected for the project: pointed out, one click away
  await dlg.getByLabel('Search quotes').fill('karlstadt');
  await expect(dlg.locator('.count')).toContainText('0 found');
  await dlg.getByRole('button', { name: /1 more in the library/ }).click();
  await expect(dlg.getByRole('listbox', { name: 'Quotes' }).getByRole('option')).toHaveCount(1);
  await expect(dlg.getByRole('listbox', { name: 'Quotes' }).getByRole('option')).toContainText('Beish 1992');
  // groups and tag filter
  await dlg.getByLabel('Search quotes').fill('');
  await dlg.getByLabel('Group by').selectOption('source');
  await expect(dlg.locator('.gh').first()).toBeVisible();
  await expect(dlg.locator('.gh', { hasText: 'Nora 1984' })).toBeVisible();
  await openFilter(dlg);
  await dlg.getByLabel('Tag').selectOption('places');
  await expect(dlg.getByRole('listbox', { name: 'Quotes' }).getByRole('option')).toHaveCount(1);
  await dlg.getByRole('button', { name: 'Reset', exact: true }).click();
  // edit the marked quote without losing the search; Esc closes only the editor
  await dlg.getByLabel('Search quotes').fill('remains');
  await pv.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('.modal h2', { hasText: 'Edit item' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal h2', { hasText: 'Edit item' })).toHaveCount(0);
  await expect(page.locator('.modal h2', { hasText: 'Insert quote' })).toBeVisible();
  // copy straight from the search
  await pv.getByRole('button', { name: 'Copy' }).click();
  await page.getByRole('menuitem', { name: 'Copy with citation' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^“Lieux de mémoire are remains” \(Nora, 1984, p\. 12\)$/);
  // a missing quote: add it, and it goes straight into the text
  await page.locator('.modal').getByRole('button', { name: 'New quote' }).first().click();
  const edit = page.locator('.modal', { has: page.locator('h2', { hasText: 'New item' }) });
  await edit.getByLabel(/^Quote/).fill('A brand-new quote');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(ed).toContainText('A brand-new quote');
});

test('@ in the text suggests citations and inserts (Name, year, page)', async ({ page }) => {
  await setup(page);
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('As argued ');
  await page.keyboard.type('@nora');
  const box = page.locator('.cite-suggest');
  await expect(box).toBeVisible();
  await expect(box.getByRole('option').first()).toContainText('(Nora, 1984, p. 12)');
  await expect(box.getByRole('option').first()).toContainText('Lieux de mémoire are remains'); // beginning of the quote
  await page.keyboard.type(' 12');
  await page.keyboard.press('Enter');
  await expect(box).toHaveCount(0);
  await expect(ed).toContainText('As argued (Nora, 1984, p. 12)');
  await expect(ed).not.toContainText('@');
  await page.keyboard.type(', also');
  await expect(ed).toContainText('(Nora, 1984, p. 12), also');
  // library items are offered too, marked as such; Esc closes and leaves the text
  await page.keyboard.type(' @karl');
  await expect(box.getByRole('option').first()).toContainText('library');
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(ed).toContainText('also @karl');
  // an e-mail address does not trigger it
  await page.keyboard.type(' mail me@example');
  await expect(box).toHaveCount(0);
  // in footnotes as well
  await page.locator('.bar').getByRole('button', { name: /Footnote/ }).click();
  const fed = page.locator('.modal .fed .ProseMirror');
  await expect(fed).toBeFocused();
  await page.keyboard.type('Vgl. @assmann');
  await expect(box.getByRole('option').first()).toContainText('Assmann');
  await page.keyboard.press('Tab');
  await expect(fed).toContainText('Vgl. (Assmann, 2011, p. 18)');
  await expect(page.locator('.modal h2')).toHaveText('Footnote'); // the dialog stayed
});

test('copying text takes the citations and footnotes along; pasting back keeps them linked', async ({ page }) => {
  await setup(page);
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Memory is social ');
  await page.keyboard.type('@nora');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' indeed.');
  // a footnote with a citation
  await page.locator('.bar').getByRole('button', { name: /Footnote/ }).click();
  await expect(page.locator('.modal .fed .ProseMirror')).toBeFocused();
  await page.keyboard.type('See @assmann');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.modal')).toHaveCount(0);
  await ed.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toBe('Memory is social (Nora, 1984, p.\u00a012) indeed.¹\n\n¹ See (Assmann, 2011, p.\u00a018)');
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return items[0].types.includes('text/html') ? await (await items[0].getType('text/html')).text() : '';
  });
  expect(html).toContain('<sup>1</sup>');
  expect(html).toContain('(Nora, 1984, p.&nbsp;12)');
  // paste into the next section: the citation stays a linked citation
  const ed2 = page.locator('.compose .ProseMirror').nth(1);
  await ed2.click();
  await page.keyboard.press('Control+v');
  await expect(ed2.locator('.qref')).toHaveCount(1);
  await expect(ed2.locator('sup.fn')).toHaveCount(1);
  await expect(ed2).toContainText('Memory is social (Nora, 1984, p. 12) indeed.');
});

test('group headings keep their height in a long list', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    for (const fam of ['Nora', 'Halbwachs', 'Assmann2']) {
      const s = db.create('sources', { csl: { id: fam, type: 'book', title: 'Book of ' + fam, author: [{ family: fam }], issued: { 'date-parts': [[1990]] } }, tags: [] });
      db.create('selections', { projectId: ui.projectId, refType: 'source', refId: s.id });
      for (let i = 0; i < 8; i++) db.create('artifacts', { kind: 'quote', sourceId: s.id, text: `${fam} quote ${i}`, page: String(i), tags: [] });
    }
  });
  await stage(page, 'Write');
  await page.locator('.compose .ProseMirror').first().click();
  await page.keyboard.press('Control+Alt+z');
  await page.locator('.modal').getByLabel('Group by').selectOption('source');
  const heights = await page.locator('.modal .gh').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(heights.length).toBe(4);
  for (const h of heights) expect(h).toBeGreaterThan(18);
});
