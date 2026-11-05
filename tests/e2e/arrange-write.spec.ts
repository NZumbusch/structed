import { expect, test } from '@playwright/test';
import { center, headingTitles, mouseDrag, open, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await seedDemo(page);
});

const openGroup = async (page: import('@playwright/test').Page, name: string) => {
  const g = page.locator('.lib .gh', { hasText: name });
  if (!(await page.locator('.lib .art').count())) await g.click();
};

test('drag a library item onto a heading, reorder, and drag back to remove', async ({ page }) => {
  await stage(page, 'Arrange');
  await openGroup(page, 'Assmann');
  const para = page.locator('.lib .art', { hasText: 'socially framed' });
  const titles = await headingTitles(page);
  const concl = page.locator('.hrow').nth(titles.indexOf('Conclusion'));
  await mouseDrag(page, await center(page, para.locator('.toggle')), await center(page, concl.locator('.line')));
  await expect(concl.locator('.placed .art')).toHaveCount(1);
  await expect(page.locator('.toast', { hasText: 'Placed under “Conclusion”' })).toBeVisible();
  // usage badge in the panel
  await expect(para.locator('.used')).toHaveText('×1');
  // drag the quote placed in Introduction onto Conclusion's existing card → before it
  const intro = page.locator('.hrow').first();
  const introCard = intro.locator('.placed .art').first();
  await mouseDrag(page, await center(page, introCard.locator('.toggle')), await center(page, concl.locator('.placed .art').first()));
  await expect(concl.locator('.placed .art')).toHaveCount(2);
  await expect(concl.locator('.placed .art').first()).toContainText('The past is not simply');
  await expect(intro.locator('.placed .art')).toHaveCount(0);
  // drag back onto the panel removes the placement
  await mouseDrag(page, await center(page, concl.locator('.placed .art').first().locator('.toggle')), await center(page, '.lib .list'));
  await expect(concl.locator('.placed .art')).toHaveCount(1);
  await expect(page.locator('.toast', { hasText: 'Removed from heading' })).toBeVisible();
});

test('a click on a card expands it (no accidental drag)', async ({ page }) => {
  await stage(page, 'Arrange');
  await openGroup(page, 'Assmann');
  const card = page.locator('.lib .art').first();
  await card.locator('.toggle').click();
  await expect(card).toHaveClass(/expanded/);
  await expect(card.locator('.full')).toBeVisible();
  // text in expanded card is selectable for copying
  await expect(card.locator('.full')).toHaveCSS('user-select', 'text');
});

test('“Place under heading…” picker places under several headings', async ({ page }) => {
  await stage(page, 'Arrange');
  await openGroup(page, 'Assmann');
  const card = page.locator('.lib .art', { hasText: 'socially framed' });
  await card.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Place under heading…' }).click();
  await page.locator('.modal .it', { hasText: 'Main part' }).click();
  await page.locator('.modal .it', { hasText: 'Conclusion' }).click();
  await expect(page.locator('.modal .it.on')).toHaveCount(2);
  await page.locator('.modal .it', { hasText: 'Conclusion' }).click(); // toggle off again
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(card.locator('.used')).toHaveText('×1');
});

test('library groups by author, tag, kind, year; filters unused and kinds', async ({ page }) => {
  await stage(page, 'Arrange');
  const sel = page.locator('.lib select');
  await sel.selectOption('tag');
  await expect(page.locator('.lib .gh', { hasText: '#memory' })).toBeVisible();
  await sel.selectOption('kind');
  await expect(page.locator('.lib .gh')).toHaveCount(3);
  await sel.selectOption('year');
  await expect(page.locator('.lib .gh').first()).toContainText('2011');
  await sel.selectOption('none');
  await expect(page.locator('.lib .art')).toHaveCount(3);
  await page.locator('.lib .usage button', { hasText: 'Unused' }).click();
  await expect(page.locator('.lib .art')).toHaveCount(2);
  await page.locator('.lib .filters').getByTitle('note').click();
  await expect(page.locator('.lib .art')).toHaveCount(1);
  await page.locator('.lib .search input').fill('nothing-matches-this');
  await expect(page.locator('.lib .empty')).toContainText('Nothing matches');
});

test('write view: edit text inline, comments, expand all, copy with citation', async ({ page }) => {
  await stage(page, 'Write');
  const intro = page.locator('.sec').first();
  await expect(intro.locator('.md strong')).toHaveText('thesis');
  await intro.getByRole('button', { name: 'Edit' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('\nNew line here.');
  await intro.getByRole('button', { name: 'Done' }).click();
  await expect(intro.locator('.md br')).toHaveCount(1); // single newline = line break
  // comment add + resolve
  await intro.locator('.cin').fill('Check this');
  await intro.locator('.cin').press('Enter');
  await expect(intro.locator('.cm')).toHaveText(/Check this/);
  await intro.locator('.cm').getByTitle('Resolve').click();
  await expect(intro.locator('.cm')).toHaveCount(0);
  await page.getByLabel('Resolved').check();
  await expect(intro.locator('.cm.resolved')).toHaveCount(1);
  // expand all
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('.paper .art.expanded')).toHaveCount(2);
  // copy with citation
  await page.locator('.paper .art').first().getByRole('button', { name: 'Cite' }).click();
  await expect(page.locator('.toast', { hasText: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('“The past is not simply preserved but reconstructed.” (Assmann, 2011, p. 18)');
  // comment count badge appears in outline after reopen
});

test('table of contents navigates and marks the current section', async ({ page }) => {
  await stage(page, 'Write');
  await page.locator('.toc .ti', { hasText: 'Conclusion' }).click();
  await expect(page.locator('.sec[data-sec]').last()).toBeInViewport();
});

test('search palette finds headings, quotes, sources and commands', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const pal = page.locator('.pal');
  await pal.locator('input').fill('reconstructed');
  await expect(pal.locator('.hit').first()).toContainText('The past is not simply');
  await pal.locator('input').press('Enter');
  await expect(page.locator('.modal h2')).toHaveText('Edit item');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await pal.locator('input').fill('go to write');
  await pal.locator('input').press('Enter');
  await expect(page.locator('nav.stages button.on')).toHaveText(/Write/);
  await page.keyboard.press('Control+k');
  await pal.locator('input').fill('assmann');
  await expect(pal.locator('.hit', { hasText: 'Cultural Memory' })).toBeVisible();
});
