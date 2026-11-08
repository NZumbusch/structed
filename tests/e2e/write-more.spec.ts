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

test('comment on a passage: write it, find it again, resolve it', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Check this source later.');
  // select "this source"
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 11; i++) await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('this source');
  await page.keyboard.press('Control+Alt+m');
  const card = page.getByRole('group', { name: 'Comment' });
  await card.getByRole('textbox').fill('Is the page right?');
  await card.getByRole('textbox').press('Control+Enter');
  await expect(card).toHaveCount(0);
  await expect(ed.locator('.tc')).toHaveText('this source');
  await expect(ed.locator('.tc')).toHaveAttribute('title', 'Is the page right?');
  // back in the passage: the card shows the comment
  await ed.locator('.tc').click();
  await expect(card.getByRole('textbox')).toHaveValue('Is the page right?');
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(ed.locator('.tc')).toHaveCount(0);
  await expect(ed).toContainText('Check this source later.');
  // an empty comment is dropped again when left
  await ed.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Check this source later.');
  await page.keyboard.press('Control+Alt+m');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Close' }).click();
  await expect(ed.locator('.tc')).toHaveCount(0);
});

test('earlier versions of a section: slide back, see the change, restore', async ({ page }) => {
  test.skip(!!(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) && page.viewportSize()!.width <= 700, 'same on phones');
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('First sentence.');
  await page.waitForTimeout(3600); // a finished sentence after more than 3 s: a new version
  await page.keyboard.type(' Second sentence.');
  await page.waitForTimeout(600);
  await page.locator('.compose .sec').first().locator('.ht').hover();
  await page.getByRole('button', { name: /Earlier versions of this section: Introduction/ }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('First sentence.')).toBeVisible();
  await expect(dlg.locator('ins')).toContainText('First sentence.');
  await dlg.getByRole('button', { name: 'Restore this version' }).click();
  await expect(ed).toHaveText('First sentence.');
  await expect(ed).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(ed).toContainText('Second sentence.');
});

test('readability hints mark repeated words and long sentences', async ({ page }) => {
  await page.evaluate(() => ((window as any).__structed.settings.writeHints = true));
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Das Gedächtnis ist sozial und das Gedächtnis ist medial.');
  await expect(ed.locator('.hint-rep')).toHaveCount(2);
  await page.evaluate(() => ((window as any).__structed.settings.writeHints = false));
  await expect(ed.locator('.hint-rep')).toHaveCount(0);
});

test('printing shows only the text, with the footnotes at the end', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Printed text.');
  await page.keyboard.press('Control+Alt+f');
  await page.locator('.fed .ProseMirror').click();
  await page.keyboard.type('A note.');
  await page.keyboard.press('Control+Enter'); // saves
  await page.waitForTimeout(400);
  await expect(page.locator('.print-notes')).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.top')).toBeHidden();
  await expect(page.locator('.compose .bar')).toBeHidden();
  await expect(page.locator('.print-notes li')).toHaveText(['A note.']);
  await expect(ed).toContainText('Printed text.');
});

test('footnotes save themselves: closing in any way keeps the text', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Text.');
  await page.keyboard.press('Control+Alt+f');
  const fed = page.locator('.modal .fed .ProseMirror');
  await expect(fed).toBeFocused();
  await page.keyboard.type('Kept after Esc.');
  // saved while typing, before the dialog is closed
  await expect(ed.locator('sup.fn')).toHaveAttribute('title', 'Kept after Esc.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(ed.locator('sup.fn')).toHaveAttribute('title', 'Kept after Esc.');
  // switching to another stage while editing keeps it too
  await ed.locator('sup.fn').click();
  await fed.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' And more.');
  // closing the browser tab without closing the footnote: still saved
  await page.waitForTimeout(1500); // footnote → section → storage
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(ed.locator('sup.fn')).toHaveAttribute('title', 'Kept after Esc. And more.');
  // a new footnote left empty is removed again
  await ed.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Alt+f');
  await expect(fed).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ed.locator('sup.fn')).toHaveCount(1);
});
