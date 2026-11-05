import { expect, test, type Page } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

async function seed(page: Page) {
  await open(page);
  await seedDemo(page);
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
      const s = db.create('sources', { csl: { id: n, type: 'book', title: n + ' Book', author: [{ family: n }], issued: { 'date-parts': [[2000]] } }, tags: [] });
      db.create('artifacts', { kind: 'quote', text: n + ' quote', tags: [], sourceId: s.id, page: '1' });
    }
  });
  await stage(page, 'Collect');
}
const row = (page: Page, name: string) => page.locator('.slist .src', { hasText: name });
const count = (page: Page, t: 'sources' | 'artifacts') => page.evaluate((t) => (window as any).__structed.db.all(t).length, t);

test('Ctrl/Shift-click selects several sources; delete keeps or removes items; undo', async ({ page }) => {
  await seed(page);
  // sorted by author: Alpha, Assmann (demo), Beta, Delta, Gamma
  await row(page, 'Alpha 2000').click();
  await row(page, 'Beta 2000').click({ modifiers: ['Shift'] });
  await expect(page.locator('.pickbar')).toContainText('3 selected');
  await row(page, 'Assmann 2011').click({ modifiers: ['Control'] }); // deselect the demo source
  await expect(page.locator('.pickbar')).toContainText('2 selected');
  const n = 2;
  const before = await count(page, 'sources');
  await page.locator('.pickbar').getByRole('button', { name: 'Delete selected sources' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Delete, keep items' }).click();
  expect(await count(page, 'sources')).toBe(before - n);
  expect(await count(page, 'artifacts')).toBe(7); // items kept (now without source)
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  expect(await count(page, 'sources')).toBe(before);
  // delete with items via keyboard
  await row(page, 'Beta 2000').click({ modifiers: ['Control'] });
  await row(page, 'Delta 2000').click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await page.locator('.modal').getByRole('button', { name: 'Delete with items' }).click();
  expect(await count(page, 'artifacts')).toBe(5);
});

test('right-click menu on a source and on a quote card', async ({ page }) => {
  await seed(page);
  await row(page, 'Beta 2000').click({ button: 'right' });
  const cm = page.locator('.cmenu');
  await expect(cm).toBeVisible();
  await expect(cm.locator('.ttl')).toHaveText('Beta 2000');
  await cm.getByRole('menuitem', { name: 'Add to “Demo: Memory & Media”' }).click();
  await expect(page.locator('.toast', { hasText: '1 sources added' })).toBeVisible();
  // menu is fully on screen, Escape closes
  await row(page, 'Gamma 2000').click({ button: 'right' });
  const b = (await cm.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press('Escape');
  await expect(cm).toHaveCount(0);
  // merge two sources via context menu (Gamma is already selected by the right-click)
  await row(page, 'Alpha 2000').click({ modifiers: ['Control'] });
  await row(page, 'Gamma 2000').click({ button: 'right' });
  await cm.getByRole('menuitem', { name: 'Merge all into “Alpha 2000”' }).click();
  await expect(row(page, 'Gamma 2000')).toHaveCount(0);
  await expect(page.locator('.items .art')).toHaveCount(2);
  // right-click on a quote card opens its actions
  await page.locator('.items .art').first().click({ button: 'right' });
  await expect(cm.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
  await cm.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.locator('.modal h2')).toHaveText('Edit item');
});

test('"Select" button shows checkboxes for touch; Ctrl+A selects all', async ({ page }) => {
  await seed(page);
  await page.locator('.stop').getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('.pickbar')).toContainText('0 selected');
  await row(page, 'Alpha 2000').click();
  await row(page, 'Beta 2000').click();
  await expect(page.locator('.pickbar')).toContainText('2 selected');
  await row(page, 'Beta 2000').focus();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.pickbar')).toContainText('5 selected');
  await page.locator('.pickbar').getByRole('button', { name: 'End selection' }).click();
  await expect(page.locator('.pickbar')).toHaveCount(0);
});
