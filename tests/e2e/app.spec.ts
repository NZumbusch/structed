import { expect, test } from '@playwright/test';
import { newProject, open, seedDemo, stage } from './helpers';

test('PWA: manifest, icons and service worker; works offline after first load', async ({ page, context }) => {
  await open(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await page.request.get(new URL(href!, page.url()).toString())).json();
  expect(manifest.name).toBe('Structed');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some((i: any) => i.sizes === '512x512')).toBe(true);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
  await newProject(page, 'Offline project');
  await page.waitForTimeout(600);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('textarea.ptitle')).toHaveValue('Offline project');
  await context.setOffline(false);
});

test('German UI translates all visible texts', async ({ page }) => {
  await open(page, { settings: { language: 'de' } });
  await seedDemo(page);
  await expect(page.locator('nav.stages')).toContainText('Gliederung');
  await expect(page.locator('nav.stages')).toContainText('Zuordnen');
  await stage(page, 'Zuordnen' as never).catch(() => page.locator('nav.stages button').nth(2).click());
  await expect(page.locator('.lib .search input')).toHaveAttribute('placeholder', 'Zitate, Notizen, Quellen suchen…');
  await page.getByTitle('Einstellungen').click();
  for (const tab of ['Darstellung', 'Zitation', 'Tastenkürzel', 'Synchronisation', 'Backup & Daten', 'Info & Hilfe']) {
    await page.locator('.modal nav button', { hasText: tab }).click();
  }
  await page.locator('.modal nav button', { hasText: 'Tastenkürzel' }).click();
  await expect(page.locator('[data-shortcut="search"]')).toContainText('Suche & Befehle');
});

test('settings: theme, contrast, accent, font size are applied and remembered', async ({ page }) => {
  await open(page);
  await page.getByTitle('Settings').click();
  await page.locator('.modal .seg button', { hasText: 'dark' }).click();
  await page.locator('.modal .seg button', { hasText: 'High' }).click();
  await page.locator('.modal input[type=range]').fill('19');
  await page.locator('.modal .seg button', { hasText: 'Serif' }).click();
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveAttribute('data-contrast', 'high');
  await expect(root).toHaveAttribute('data-font', 'serif');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await root.evaluate((e) => getComputedStyle(e).getPropertyValue('--fs').trim())).toBe('19px');
});

test('version is shown in About', async ({ page }) => {
  await open(page);
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'About & help' }).click();
  await expect(page.locator('.modal')).toContainText(/Version \d+\.\d+/);
});

test('projects: create from template, switch, delete with undo', async ({ page }) => {
  await open(page);
  await newProject(page, 'First', 'Journal article (IMRaD)');
  await expect(page.locator('textarea.title').first()).toHaveValue('Abstract');
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'All projects…' }).click();
  await page.getByPlaceholder('Working title').fill('Second');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('textarea.ptitle')).toHaveValue('Second');
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'All projects…' }).click();
  page.once('dialog', (d) => d.accept());
  await page.locator('.pr', { hasText: 'First' }).getByTitle('Delete').click();
  await expect(page.locator('.pr')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'All projects…' }).click();
  await expect(page.locator('.pr')).toHaveCount(2);
});
