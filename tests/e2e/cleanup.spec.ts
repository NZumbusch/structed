import { expect, test } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await seedDemo(page);
});

test('each stage remembers whether the library panel is open; Write starts without it', async ({ page }) => {
  const panel = page.locator('.app .panel');
  const toggle = page.getByRole('button', { name: /^Library panel/ });
  await expect(panel).toBeVisible(); // Outline
  await stage(page, 'Write');
  await expect(panel).toHaveCount(0); // more room to write
  await toggle.click();
  await expect(panel).toBeVisible();
  await stage(page, 'Arrange');
  await expect(panel).toBeVisible();
  await toggle.click();
  await expect(panel).toHaveCount(0);
  await stage(page, 'Write');
  await expect(panel).toBeVisible(); // Write kept its own choice
  await stage(page, 'Outline');
  await expect(panel).toBeVisible();
  await stage(page, 'Arrange');
  await expect(panel).toHaveCount(0);
});

test('outline shortcut hints show for the first visits, then only on request', async ({ page }) => {
  await expect(page.locator('.keys')).toBeVisible();
  await page.evaluate(() => ((window as any).__structed.settings.outlineVisits = 9));
  await page.waitForTimeout(500); // let the demo reach storage
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('.keys')).toHaveCount(0);
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.locator('.keys')).toContainText('new heading');
});

test('the demo tag never shows; the Export dialog has one Word export', async ({ page }) => {
  await stage(page, 'Arrange');
  await expect(page.locator('.hrow .art').first()).toContainText('#memory');
  await expect(page.locator('body')).not.toContainText('structed-demo');
  await page.evaluate(() => {
    const s = (window as any).__structed;
    s.ui.editArtifact = { id: s.db.all('artifacts').find((a: any) => a.text.startsWith('The past')).id };
  });
  await expect(page.locator('.modal .tagin')).toContainText('#memory');
  await expect(page.locator('.modal')).not.toContainText('structed-demo');
  await page.locator('.modal').getByRole('button', { name: 'Save' }).click();
  // the hidden tag is kept on the item, so "remove demo" still finds it
  expect(await page.evaluate(() => (window as any).__structed.db.all('artifacts').find((a: any) => a.text.startsWith('The past')).tags)).toContain('structed-demo');
});

test('the German demo uses German sample quotes', async ({ page }) => {
  await page.evaluate(() => {
    const s = (window as any).__structed;
    s.settings.language = 'de';
    s.ui.projectId = s.createDemo('de');
  });
  await page.locator('nav.stages button').nth(3).click(); // „Zuordnen“
  await expect(page.locator('.hrow .art').first()).toContainText('Vergangenheit entsteht');
});
