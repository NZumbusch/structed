import { expect, test, type Page } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

/** A quote with a quote in it, linked in the text of the project's first section. */
async function nestedQuoteInText(page: Page) {
  await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const src = db.all('sources')[0];
    const q = db.create('artifacts', { kind: 'quote', sourceId: src.id, text: 'Er sagt „ja“ dazu', page: '5', tags: [] });
    const h = db.all('headings').filter((x: any) => x.projectId === ui.projectId).sort((a: any, b: any) => a.order - b.order)[0];
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Davor ' }, { type: 'quoteRef', attrs: { id: q.id, mode: 'inline' } }] }] };
    db.update('headings', h.id, { draft: JSON.stringify(doc) });
  });
}

test.beforeEach(async ({ page }) => {
  await open(page);
  await seedDemo(page);
});

test('a quote inside a quote gets nested quotation marks in the text, as set', async ({ page }) => {
  await nestedQuoteInText(page);
  await stage(page, 'Write');
  const q = page.locator('.compose .qref').first();
  await expect(q).toContainText('„Er sagt ‚ja‘ dazu“');
  await page.evaluate(() => ((window as any).__structed.settings.nestedQuoteMarks = 'ch'));
  await expect(q).toContainText('„Er sagt ‹ja› dazu“');
  await page.evaluate(() => ((window as any).__structed.settings.nestedQuoteMarks = 'keep'));
  await expect(q).toContainText('„Er sagt „ja“ dazu“');
});

test('pasted text gets the typography of typed text, in Write and in text fields', async ({ page }) => {
  await stage(page, 'Write');
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.press('End');
  await page.evaluate(() => navigator.clipboard.writeText(' Er sagt "ja"... vgl. S. 12'));
  await page.keyboard.press('Control+v');
  await expect(ed).toContainText('Er sagt „ja“… vgl. S. 12');
  await stage(page, 'Outline');
  const title = page.locator('textarea.title').first();
  await title.click();
  await page.keyboard.press('End');
  await page.evaluate(() => navigator.clipboard.writeText(' "neu"'));
  await page.keyboard.press('Control+v');
  await expect(title).toHaveValue(/ „neu“$/);
});

test('fix typography in existing text: shows the changes by kind, applies them in one undo step', async ({ page }) => {
  const id = await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const a = db.create('artifacts', { kind: 'quote', sourceId: null, text: 'Er sagt "ja"... S. 12', tags: [], comment: 'Wichtig - sehr' });
    const h = db.all('headings').find((x: any) => x.projectId === ui.projectId);
    db.update('headings', h.id, { body: 'Notiz "alt"' });
    ui.dialog = 'settings';
    ui.settingsTab = 'editor';
    return a.id;
  });
  await page.getByRole('button', { name: 'Fix typography in existing text…' }).click();
  const m = page.locator('.modal');
  await expect(m.getByText('Quotes and paraphrases in the library')).toBeVisible();
  await m.locator('.grp', { hasText: 'Quotes and paraphrases' }).getByRole('button', { name: 'Show changes' }).click();
  await expect(m.locator('.now').first()).toContainText('Er sagt „ja“… S. 12');
  // without the quotes: only the rest is changed
  await m.locator('.grp', { hasText: 'Quotes and paraphrases' }).getByRole('checkbox').uncheck();
  await m.getByRole('button', { name: /^Fix \d+ items$/ }).click();
  const read = () => page.evaluate((i) => {
    const { db, ui } = (window as any).__structed;
    return { a: db.get('artifacts', i), body: db.all('headings').find((x: any) => x.projectId === ui.projectId).body };
  }, id);
  let r = await read();
  expect(r.a.text).toBe('Er sagt "ja"... S. 12');
  expect(r.a.comment).toBe('Wichtig – sehr');
  expect(r.body).toBe('Notiz „alt“');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  r = await read();
  expect(r.a.comment).toBe('Wichtig - sehr');
  expect(r.body).toBe('Notiz "alt"');
});
