import { expect, test } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page, { settings: { language: 'en' } });
  await seedDemo(page);
  await stage(page, 'Write');
  await expect(page.locator('.compose .ProseMirror').first()).toBeVisible();
});

const firstEditor = (page: import('@playwright/test').Page) => page.locator('.compose .ProseMirror').first();

test('typographic quotes, ellipsis and non-breaking spaces while typing', async ({ page }) => {
  const ed = firstEditor(page);
  await ed.click();
  await page.keyboard.type('Er sagt "ja" und it\'s gut... vgl. S. 12, z. B. § 5');
  const text = await ed.evaluate((el) => el.textContent ?? '');
  expect(text).toContain('Er sagt „ja“ und it’s gut…');
  expect(text).toContain('S. 12');
  expect(text).toContain('z. B.');
  expect(text).toContain('§ 5');
  await expect(ed.locator('.nbsp')).toHaveCount(3);
  // Backspace right after a change brings the plain character back
  await page.keyboard.type(' "');
  await page.keyboard.press('Backspace');
  expect(await ed.evaluate((el) => el.textContent ?? '')).toMatch(/5 "$/);
  // Ctrl+Shift+Space inserts a non-breaking space
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+Shift+Space');
  await expect(ed.locator('.nbsp')).toHaveCount(4);
});

test('numbered list from the toolbar and from "1. "', async ({ page }) => {
  test.skip(page.viewportSize()!.width <= 700, 'toolbar row scrolls on phones');
  const ed = firstEditor(page);
  await ed.click();
  await page.getByRole('button', { name: 'Numbered list' }).click();
  await page.keyboard.type('Eins');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Zwei');
  await expect(ed.locator('ol > li')).toHaveCount(2);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // leave the list
  await page.keyboard.type('1. Neu');
  await expect(ed.locator('ol')).toHaveCount(2);
});

test('word count: selection and characters with spaces', async ({ page }) => {
  test.skip(page.viewportSize()!.width <= 700, 'the counter is hidden on phones');
  const ed = firstEditor(page);
  await ed.click();
  await page.keyboard.type('Eins zwei drei vier');
  const wc = page.locator('.bar .wc');
  await expect(wc).toHaveText(/^4 words$/);
  await page.keyboard.press('Shift+Home');
  await expect(wc).toHaveText('4 of 4 words');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(wc).toHaveText('1 of 4 words');
  await wc.click();
  await expect(wc).toHaveText('19 characters');
  await wc.click();
  await expect(wc).toHaveText('4 words');
});

test('find and replace across sections', async ({ page }) => {
  const eds = page.locator('.compose .ProseMirror');
  await eds.nth(0).click();
  await page.keyboard.type('Die Taufe ist alt. Taufe!');
  await eds.nth(1).click();
  await page.keyboard.type('Noch eine taufe.');
  await page.keyboard.press('Control+f');
  const q = page.getByRole('textbox', { name: 'Find in the text' });
  await expect(q).toBeFocused();
  await q.fill('Taufe');
  await expect(page.locator('.find .count')).toHaveText('1/3');
  await expect(page.locator('.compose .find-hit')).toHaveCount(3);
  await expect(page.locator('.compose .find-cur')).toHaveCount(1);
  await q.press('Enter');
  await expect(page.locator('.find .count')).toHaveText('2/3');
  await page.getByRole('button', { name: 'Match case' }).click();
  await expect(page.locator('.find .count')).toHaveText('1/2');
  // replace one, then the rest
  await page.getByRole('button', { name: 'Replace', exact: true }).first().click();
  const r = page.getByRole('textbox', { name: 'Replace with' });
  await r.fill('Weihe');
  await r.press('Enter');
  await expect(eds.nth(0)).toContainText('Die Weihe ist alt. Taufe!');
  await expect(page.locator('.find .count')).toHaveText('1/1');
  await page.getByRole('button', { name: 'Replace all' }).click();
  await expect(eds.nth(0)).toContainText('Die Weihe ist alt. Weihe!');
  await expect(eds.nth(1)).toContainText('Noch eine taufe.'); // case-sensitive
  await expect(page.locator('.find .count')).toHaveText('No results');
  // undo in the section brings the text back
  await q.press('Escape');
  await expect(page.locator('.find')).toHaveCount(0);
  await expect(page.locator('.compose .find-hit')).toHaveCount(0);
});
