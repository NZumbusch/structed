import { expect, test } from '@playwright/test';
import { headingTitles, numbers, open, seedDemo } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await seedDemo(page);
});

async function openShortcuts(page: import('@playwright/test').Page) {
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'Keyboard shortcuts' }).click();
}
const row = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-shortcut="${id}"]`);

test('lists defaults and unassigned extras', async ({ page }) => {
  await openShortcuts(page);
  await expect(row(page, 'search').locator('.key')).toHaveText('Ctrl+K');
  await expect(row(page, 'stageWrite').locator('.key')).toHaveText('Alt+5');
  await expect(row(page, 'newQuote').locator('.key')).toHaveText('Not set');
});

test('assigns an unassigned action and it works', async ({ page }) => {
  await openShortcuts(page);
  await row(page, 'newQuote').locator('.key').click();
  await expect(row(page, 'newQuote').locator('.key')).toHaveText('Press keys…');
  await page.keyboard.press('Alt+q');
  await expect(row(page, 'newQuote').locator('.key')).toHaveText('Alt+Q');
  await page.keyboard.press('Escape'); // closes settings
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.keyboard.press('Alt+q');
  await expect(page.locator('.modal h2')).toHaveText('New item');
});

test('Escape cancels recording without closing settings; Backspace clears', async ({ page }) => {
  await openShortcuts(page);
  await row(page, 'search').locator('.key').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toBeVisible();
  await expect(row(page, 'search').locator('.key')).toHaveText('Ctrl+K');
  await row(page, 'search').locator('.key').click();
  await page.keyboard.press('Backspace');
  await expect(row(page, 'search').locator('.key')).toHaveText('Not set');
  await row(page, 'search').getByTitle('Reset to default').click();
  await expect(row(page, 'search').locator('.key')).toHaveText('Ctrl+K');
});

test('conflicts warn and can be swapped', async ({ page }) => {
  await openShortcuts(page);
  await row(page, 'newNote').locator('.key').click();
  await page.keyboard.press('Control+k');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Ctrl+K is already used by “Search & commands”');
  await alert.getByRole('button', { name: 'Reassign' }).click();
  await expect(row(page, 'newNote').locator('.key')).toHaveText('Ctrl+K');
  await expect(row(page, 'search').locator('.key')).toHaveText('Not set');
  // cancel path
  await row(page, 'export').locator('.key').click();
  await page.keyboard.press('Alt+1');
  await alert.getByRole('button', { name: 'Cancel' }).click();
  await expect(row(page, 'export').locator('.key')).toHaveText('Not set');
  await expect(row(page, 'stageOutline').locator('.key')).toHaveText('Alt+1');
  await page.getByRole('button', { name: 'Reset all' }).click();
  await expect(row(page, 'search').locator('.key')).toHaveText('Ctrl+K');
});

test('rebound outline keys and stage keys take effect; persist after reload', async ({ page }) => {
  await openShortcuts(page);
  await row(page, 'outline.indent').locator('.key').click();
  await page.keyboard.press('Alt+ArrowRight');
  await row(page, 'stageWrite').locator('.key').click();
  await page.keyboard.press('Alt+w');
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  // Main part is the 2nd root; its first child "Cultural memory"
  const t = await headingTitles(page);
  const conclusion = page.locator('textarea.title').nth(t.indexOf('Conclusion'));
  await conclusion.focus();
  await page.keyboard.press('Tab'); // no longer indents
  expect(await numbers(page)).toEqual(['1', '2', '2.1', '3']);
  await conclusion.focus();
  await page.keyboard.press('Alt+ArrowRight');
  expect(await numbers(page)).toEqual(['1', '2', '2.1', '2.2']);
  await page.locator('.ph .stats').click();
  await page.keyboard.press('Alt+w');
  await expect(page.locator('nav.stages button.on')).toHaveText(/Write/);
});

test('tooltips show the current shortcut', async ({ page }) => {
  await expect(page.locator('[data-tour="search"]')).toHaveAttribute('title', 'Search (Ctrl+K)');
});

test('conflict warning appears next to the edited row; hint bar follows custom keys', async ({ page }) => {
  await openShortcuts(page);
  await row(page, 'outline.delete').locator('.key').click();
  await page.keyboard.press('Tab');
  const alert = page.getByRole('alert');
  await expect(alert).toBeInViewport();
  await alert.getByRole('button', { name: 'Reassign' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.keys')).not.toContainText('indent');
  await expect(page.locator('.keys')).toContainText('outdent');
});
