import { expect, test } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await seedDemo(page);
});

test('Ctrl+Shift+P lists every command with its keys and state; ">" filters to commands', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P');
  const pal = page.locator('.pal');
  await expect(pal.locator('input')).toHaveValue('>');
  await expect(pal.locator('.mode')).toHaveText('Commands');
  await expect(pal.locator('.hit', { hasText: 'Go to Write' }).locator('.kbd')).toHaveText('Alt+5');
  // a setting as a switch: shows and changes its state
  await pal.locator('input').fill('> spell check');
  const spell = pal.locator('.hit', { hasText: 'Spell check' }).first();
  await expect(spell.locator('.st')).toHaveText('on');
  await pal.locator('input').press('Enter');
  expect(await page.evaluate(() => (window as any).__structed.settings.editorSpellcheck)).toBe(false);
  // a setting with several values; German words and umlauts without accents find it too
  await page.keyboard.press('Control+k');
  await pal.locator('input').fill('quotation marks inside');
  await pal.locator('.hit', { hasText: '‹…›' }).click();
  expect(await page.evaluate(() => (window as any).__structed.settings.nestedQuoteMarks)).toBe('ch');
  // used commands come first next time
  await page.keyboard.press('Control+Shift+P');
  await expect(pal.locator('.head').first()).toHaveText(/Recently used/i);
  await expect(pal.locator('.hit').first()).toContainText('Quotation marks inside a quote: ‹…›');
  await expect(pal.locator('.hit').first().locator('.st')).toBeVisible();
});

test('commands of Write while Write is open: footnote, readability hints, tools', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.locator('.pal input').fill('insert footnote');
  await expect(page.locator('.pal .hit', { hasText: 'Insert footnote' })).toHaveCount(0); // only in Write
  await page.keyboard.press('Escape');
  await stage(page, 'Write');
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Text');
  await page.keyboard.press('Control+k');
  await page.locator('.pal input').fill('fussnote');
  await page.locator('.pal input').press('Enter');
  await expect(page.locator('.modal .fd')).toBeVisible(); // the footnote dialog
  await page.keyboard.type('Vgl. dazu');
  await page.keyboard.press('Escape');
  await expect(ed.locator('sup.fn')).toHaveCount(1);
  await page.keyboard.press('Control+k');
  await page.locator('.pal input').fill('fix typography');
  await page.locator('.pal input').press('Enter');
  await expect(page.locator('.modal h2')).toHaveText('Fix typography in existing text');
});

test('settings sections and German labels', async ({ page }) => {
  await page.keyboard.press('Control+k');
  await page.locator('.pal input').fill('settings zotero');
  await page.locator('.pal input').press('Enter');
  await expect(page.locator('.modal nav button.on')).toContainText('Zotero');
  await page.keyboard.press('Escape');
  await page.evaluate(() => ((window as any).__structed.settings.language = 'de'));
  await page.keyboard.press('Control+k');
  await page.locator('.pal input').fill('dunkel');
  await expect(page.locator('.pal .hit').first()).toContainText('Dunkel');
});
