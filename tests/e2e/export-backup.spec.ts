import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { open, seedDemo } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await seedDemo(page);
});

test('exports Markdown, Word and BibTeX', async ({ page }) => {
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  const pv = page.locator('pre.pv');
  await expect(pv).toContainText('> [!quote]- (Assmann, 2011, p. 18)');
  await expect(pv).toContainText('## References');
  await page.getByLabel('Quote style').selectOption('blockquote');
  await expect(pv).toContainText('> — (Assmann, 2011, p. 18)');

  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown (.md)' }).click()]);
  expect(md.suggestedFilename()).toBe('Demo Memory & Media.md');
  const mdText = readFileSync((await md.path())!, 'utf8');
  expect(mdText).toContain('# Demo: Memory & Media');

  const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word (.docx)' }).click()]);
  expect(readFileSync((await docx.path())!).subarray(0, 2).toString()).toBe('PK');

  const [bib] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'BibTeX (.bib)' }).click()]);
  expect(readFileSync((await bib.path())!, 'utf8')).toMatch(/@book\{.*\n[\s\S]*Assmann/);
});

test('full backup round-trip: download, wipe, restore', async ({ page }) => {
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'Backup & data' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download full backup (.json)' }).click()]);
  const path = (await dl.path())!;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  expect(data.format).toBe('structed');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete all local data' }).click();
  await expect(page.locator('.modal')).toContainText('0 projects');
  page.once('dialog', (d) => d.accept());
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Restore backup (replace)' }).click()]);
  await chooser.setFiles(path);
  await expect(page.locator('.modal')).toContainText('1 projects · 1 sources · 3 items');
});

test('snapshots save and restore the outline', async ({ page }) => {
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'Snapshots' }).click();
  await page.getByPlaceholder(/Name \(optional\)/).fill('before');
  await page.getByRole('button', { name: 'Save snapshot' }).click();
  await page.keyboard.press('Escape');
  await page.locator('textarea.title').first().fill('Changed title');
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'Snapshots' }).click();
  page.once('dialog', (d) => d.accept());
  await page.locator('.sn', { hasText: 'before' }).getByRole('button', { name: 'Restore' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('textarea.title').first()).toHaveValue('Introduction');
  // an automatic safety snapshot was created
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'Snapshots' }).click();
  await expect(page.locator('.sn')).toHaveCount(2);
});
