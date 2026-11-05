import { expect, test } from '@playwright/test';
import { headingTitles, newProject, numbers, open } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await newProject(page, 'Outline test', 'Blank');
});

test('builds a nested outline with the keyboard', async ({ page }) => {
  const first = page.locator('textarea.title').first();
  await first.fill('Introduction');
  await first.press('Enter');
  await page.keyboard.type('Question');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Relevance');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Main part');
  await page.keyboard.press('Shift+Tab');
  expect(await headingTitles(page)).toEqual(['Introduction', 'Question', 'Relevance', 'Main part']);
  expect(await numbers(page)).toEqual(['1', '1.1', '1.2', '2']);
  // move up with Alt+Up: Main part swaps with Introduction
  await page.keyboard.press('Alt+ArrowUp');
  expect(await headingTitles(page)).toEqual(['Main part', 'Introduction', 'Question', 'Relevance']);
  // arrow navigation
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('textarea.title').nth(1)).toBeFocused();
});

test('Enter splits a title at the caret; Backspace on empty removes', async ({ page }) => {
  const first = page.locator('textarea.title').first();
  await first.fill('HelloWorld');
  await first.press('Home');
  for (let i = 0; i < 5; i++) await first.press('ArrowRight');
  await first.press('Enter');
  expect(await headingTitles(page)).toEqual(['Hello', 'World']);
  await expect(page.locator('textarea.title').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await headingTitles(page)).toHaveLength(3);
  await page.keyboard.press('Backspace');
  expect(await headingTitles(page)).toEqual(['Hello', 'World']);
});

test('notes editor, status, word target and collapse', async ({ page }) => {
  const first = page.locator('textarea.title').first();
  await first.fill('Chapter');
  await first.press('Shift+Enter');
  await expect(page.locator('.hrow .cm-content').first()).toBeFocused();
  await page.keyboard.type('The **gist** of this chapter.');
  await expect(page.locator('.hrow .wc').first()).toHaveText(/5 words/);
  // status cycles idea → draft → revise → done
  const st = page.locator('.hrow .status').first();
  for (const s of ['draft', 'revise', 'done']) {
    await st.click();
    await expect(st).toHaveAttribute('title', new RegExp(s));
  }
  // add subheading via menu, then collapse
  await page.locator('.hrow').first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Add subheading' }).click();
  await page.keyboard.type('Sub');
  expect(await numbers(page)).toEqual(['1', '1.1']);
  await page.locator('.hrow .tw').first().click();
  expect(await numbers(page)).toEqual(['1']);
});

test('delete heading shows undo toast that restores it', async ({ page }) => {
  await page.locator('textarea.title').first().fill('Keep me');
  await page.locator('.hrow').first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete heading' }).click();
  await expect(page.locator('textarea.title')).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('textarea.title').first()).toHaveValue('Keep me');
});

test('drag a heading to reorder and nest', async ({ page }) => {
  const first = page.locator('textarea.title').first();
  await first.fill('A');
  await first.press('Enter');
  await page.keyboard.type('B');
  await page.keyboard.press('Enter');
  await page.keyboard.type('C');
  const grip = page.locator('.hrow').nth(2).locator('.grip');
  await page.locator('.hrow').nth(2).hover();
  const g = (await grip.boundingBox())!;
  const target = (await page.locator('.hrow').nth(0).boundingBox())!;
  await page.mouse.move(g.x + 5, g.y + 5);
  await page.mouse.down();
  await page.mouse.move(g.x + 20, g.y + 5, { steps: 3 });
  await page.mouse.move(target.x + 200, target.y + target.height / 2, { steps: 12 }); // middle → inside
  await page.mouse.up();
  expect(await headingTitles(page)).toEqual(['A', 'C', 'B']);
  expect(await numbers(page)).toEqual(['1', '1.1', '2']);
});

test('outline persists across reloads', async ({ page }) => {
  await page.locator('textarea.title').first().fill('Persistent heading');
  await page.locator('textarea.psub').fill('My research question');
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('textarea.title').first()).toHaveValue('Persistent heading');
  await expect(page.locator('textarea.psub')).toHaveValue('My research question');
});

test('global undo via keyboard outside inputs', async ({ page }) => {
  await page.locator('.hrow').first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Add heading below' }).click();
  await expect(page.locator('textarea.title')).toHaveCount(2);
  await page.locator('.ph .stats').click(); // blur
  await page.keyboard.press('Control+z');
  await expect(page.locator('textarea.title')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('textarea.title')).toHaveCount(2);
});
