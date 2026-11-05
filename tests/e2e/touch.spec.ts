import { expect, test } from '@playwright/test';
import { center, headingTitles, open, seedDemo, stage, touchDrag } from './helpers';

test('@touch long-press drags an item onto a heading', async ({ page, context }) => {
  await open(page);
  await seedDemo(page);
  await stage(page, 'Arrange');
  await page.locator('.lib .gh').first().click();
  const titles = await headingTitles(page);
  const concl = page.locator('.hrow').nth(titles.indexOf('Conclusion'));
  const card = page.locator('.lib .art', { hasText: 'socially framed' });
  await touchDrag(page, context, await center(page, card.locator('.toggle')), await center(page, concl.locator('.line')));
  await expect(concl.locator('.placed .art')).toHaveCount(1);
});

test('@touch a quick swipe scrolls instead of dragging', async ({ page, context }) => {
  await open(page);
  await seedDemo(page);
  await stage(page, 'Arrange');
  await page.locator('.lib .gh').first().click();
  const before = await page.locator('.placed .art').count();
  const card = page.locator('.lib .art', { hasText: 'socially framed' });
  const titles = await headingTitles(page);
  await touchDrag(page, context, await center(page, card.locator('.toggle')), await center(page, page.locator('.hrow').nth(titles.indexOf('Conclusion'))), 30);
  await expect(page.locator('.dnd-ghost')).toHaveCount(0);
  expect(await page.locator('.placed .art').count()).toBe(before);
});

test('@phone library opens as a drawer; items can be placed via menu', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  await stage(page, 'Arrange');
  await page.getByTitle(/Library panel/).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  await drawer.locator('.gh').first().click();
  await drawer.locator('.art', { hasText: 'socially framed' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Place under heading…' }).click();
  await page.locator('.modal .it', { hasText: 'Conclusion' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.placed .art', { hasText: 'socially framed' })).toBeVisible();
});
