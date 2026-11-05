import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { open, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page, { settings: { language: 'en' } });
  await seedDemo(page);
  await stage(page, 'Write');
  await expect(page.locator('.compose .ProseMirror').first()).toBeVisible();
});

test('write text with formatting; sections follow the outline', async ({ page }) => {
  await expect(page.locator('.compose .sec .ht')).toHaveCount(4);
  await expect(page.locator('.compose .sec .ht').first()).toContainText('Introduction');
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Plain ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' text.');
  await expect(ed.locator('strong')).toHaveText('bold');
  await expect(page.locator('.bar .wc')).toContainText('3 words');
  // persisted
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('.compose .ProseMirror').first()).toContainText('Plain bold text.');
});

test('insert a linked quote from the panel; it updates when the library changes', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('As Assmann writes: ');
  await page.locator('.lib .gh').first().click().catch(() => {});
  const card = page.locator('.lib .art', { hasText: 'The past is not simply' });
  await card.getByRole('button', { name: 'Insert at cursor' }).click();
  const q = ed.locator('.qref');
  await expect(q).toContainText('„The past is not simply preserved but reconstructed.“');
  await expect(q.locator('em')).toHaveCount(1); // italic by default
  await expect(q).toContainText('(Assmann, 2011, p. 18)');
  // edit page and text in the library → editor updates live
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const a = db.all('artifacts').find((x: any) => x.text.startsWith('The past'));
    db.update('artifacts', a.id, { text: 'The past is reconstructed.', page: '19' });
  });
  await expect(q).toContainText('„The past is reconstructed.“');
  await expect(q).toContainText('p. 19');
  // block mode via the card menu (the card now shows the edited text)
  await page.locator('.lib .art', { hasText: 'The past is reconstructed.' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Insert as block quote' }).click();
  await expect(ed.locator('.qblock')).toContainText('The past is reconstructed.');
  await expect(ed.locator('.qblock .qb-cite')).toContainText('Assmann');
});

test('footnotes with a linked quote are numbered and editable', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('A sentence');
  await page.locator('.bar').getByRole('button', { name: /Footnote/ }).click();
  const dlg = page.locator('.modal');
  await expect(dlg.locator('h2')).toHaveText('Footnote');
  await dlg.getByLabel('Text before the quote').fill('See');
  await dlg.getByLabel('Quote (optional, stays linked)').selectOption({ index: 1 });
  await dlg.getByRole('button', { name: 'Save' }).click();
  const fn = ed.locator('sup.fn');
  await expect(fn).toHaveCount(1);
  expect(await fn.evaluate((e) => getComputedStyle(e, '::after').content)).toContain('counter(fn)'); // numbered via CSS counter
  await expect(fn).toHaveAttribute('title', /^See „/);
  // keyboard shortcut adds a second one
  await ed.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Alt+f');
  await expect(page.locator('.modal h2')).toHaveText('Footnote');
  await page.locator('.modal').getByRole('button', { name: 'Delete footnote' }).click();
  await expect(fn).toHaveCount(1);
});

test('Word export: title page fields, template, Zotero fields', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Intro text with a quote: ');
  await page.locator('.lib .gh').first().click();
  await page.locator('.lib .art', { hasText: 'The past is not simply' }).getByRole('button', { name: 'Insert at cursor' }).click();
  await page.locator('.bar').getByRole('button', { name: 'Word export' }).click();
  const m = page.locator('.modal');
  await m.getByLabel('Module / course').fill('im Seminar „Test“');
  await m.getByLabel('Author block').fill('vorgelegt von:\nMax Muster');
  const [dl] = await Promise.all([page.waitForEvent('download'), m.getByRole('button', { name: 'Create Word file' }).click()]);
  expect(dl.suggestedFilename()).toBe('Demo Memory & Media.docx');
  const zip = await JSZip.loadAsync(readFileSync((await dl.path())!));
  const doc = await zip.file('word/document.xml')!.async('string');
  expect(doc).toContain('im Seminar „Test“');
  expect(doc).toContain('Max Muster');
  expect(doc).toContain('Intro text with a quote:');
  expect(doc).toContain('ADDIN ZOTERO_ITEM CSL_CITATION');
  expect(doc).toContain('ADDIN ZOTERO_BIBL');
  expect(doc).toContain('TOC \\o');
  // cover fields are remembered for the next export
  await page.keyboard.press('Escape');
  await page.locator('.bar').getByRole('button', { name: 'Word export' }).click();
  await expect(page.locator('.modal').getByLabel('Module / course')).toHaveValue('im Seminar „Test“');
});
