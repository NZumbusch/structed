import { expect, test } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page, { settings: { language: 'en' } });
  await seedDemo(page);
  await stage(page, 'Write');
  await expect(page.locator('.compose .ProseMirror').first()).toBeVisible();
});

test('one undo history across sections, with a redo button', async ({ page }) => {
  const eds = page.locator('.compose .ProseMirror');
  await eds.nth(0).click();
  await page.keyboard.type('First section.');
  await eds.nth(1).click();
  await page.keyboard.type('Second section.');
  await page.waitForTimeout(600); // a new undo step
  await page.keyboard.press('Control+z');
  await expect(eds.nth(1)).not.toContainText('Second section.');
  // the next undo goes back to the first section, even though the cursor is in the second
  await page.keyboard.press('Control+z');
  await expect(eds.nth(0)).not.toContainText('First section.');
  test.skip(page.viewportSize()!.width <= 700, 'redo lives in the More menu on phones');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(eds.nth(0)).toContainText('First section.');
  await page.keyboard.press('Control+Shift+z');
  await expect(eds.nth(1)).toContainText('Second section.');
});

test('Ctrl+K finds places in the text and puts the cursor there', async ({ page }) => {
  const eds = page.locator('.compose .ProseMirror');
  await eds.nth(2).click();
  await page.keyboard.type('Memory is always mediated by technology.');
  await page.waitForTimeout(400);
  await stage(page, 'Outline');
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Search headings, quotes, sources, commands…');
  await input.fill('me');
  await expect(page.locator('.pal').getByText('Memory is always mediated')).toHaveCount(0); // too short to search the text
  await input.fill('mediated by');
  await page.locator('.pal').getByText('Memory is always mediated', { exact: false }).first().click();
  await expect(page.locator('.compose')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('mediated by');
});

test('cross-reference to a section follows the outline numbering', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('See section ');
  await page.keyboard.press('Control+Alt+r');
  await page.locator('.cmenu').getByRole('menuitem', { name: /2\.1\s+Cultural memory/ }).click();
  const x = page.locator('.compose .xref'); // its section moves too
  await expect(x).toHaveText('2.1');
  // renumber: move "Main part" (2) above "Introduction" (1) in the data
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const hs = db.all('headings');
    const intro = hs.find((h: any) => h.title === 'Introduction');
    const main = hs.find((h: any) => h.title === 'Main part');
    db.update('headings', main.id, { order: intro.order - 1 });
  });
  await expect(x).toHaveText('1.1');
});

test('copy the whole text with citations from the command palette', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const eds = page.locator('.compose .ProseMirror');
  await eds.nth(0).click();
  await page.keyboard.type('Intro text.');
  await eds.nth(3).click();
  await page.keyboard.type('Final words.');
  await page.waitForTimeout(400); // saved
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search headings, quotes, sources, commands…').fill('copy whole');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Whole text copied with citations and footnotes')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('1 Introduction\n\nIntro text.');
  expect(text).toContain('3 Conclusion\n\nFinal words.');
});

test('the cursor comes back where you stopped writing', async ({ page }) => {
  test.skip(page.viewportSize()!.width <= 700 || !!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)), 'not on touch devices');
  const eds = page.locator('.compose .ProseMirror');
  await eds.nth(1).click();
  await page.keyboard.type('Hello there');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(eds.nth(1)).toBeFocused();
  await page.keyboard.type('X');
  await expect(eds.nth(1)).toContainText('Hello theXre');
});
