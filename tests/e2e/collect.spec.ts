import { expect, test } from '@playwright/test';
import { newProject, open, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await newProject(page);
  await stage(page, 'Collect');
});

async function addSource(page: import('@playwright/test').Page) {
  await page.getByTitle('New source').click();
  const m = page.locator('.modal');
  await m.getByLabel('Title').fill('Cultural Memory and Early Civilization');
  await m.getByLabel('Authors (one per line: Family, Given)').fill('Assmann, Jan');
  await m.getByLabel('Year').fill('2011');
  await m.getByLabel('Publisher').fill('Cambridge University Press');
  await expect(m.locator('.preview')).toContainText('Assmann, J. (2011). Cultural Memory and Early Civilization');
  await m.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sh h2')).toHaveText('Cultural Memory and Early Civilization');
}

test('creates a source with live reference preview', async ({ page }) => {
  await addSource(page);
  await expect(page.locator('.src.on')).toContainText('Assmann 2011');
  await expect(page.locator('.ref')).toContainText('Cambridge University Press');
});

test('quick capture cleans OCR text and keeps page', async ({ page }) => {
  await addSource(page);
  await page.locator('.capture textarea').fill('The past is not simply pre-\nserved but recon- structed .');
  await page.locator('.capture input.page').fill('18');
  await page.locator('.capture input.page').press('Control+Enter');
  const card = page.locator('.items .art').first();
  await expect(card).toContainText('The past is not simply preserved but reconstructed.');
  await expect(card).toContainText('Assmann 2011, p. 18');
});

test('own notes keep their line breaks and markdown', async ({ page }) => {
  await page.locator('.src', { hasText: 'Own notes' }).click();
  await page.locator('.capture .seg button', { hasText: 'note' }).click();
  await page.locator('.capture textarea').fill('First idea\nSecond line\n\n- bullet');
  await page.locator('.capture').getByRole('button', { name: 'Add' }).click();
  const card = page.locator('.items .art').first();
  await card.locator('.toggle').click();
  await expect(card.locator('.md br')).toHaveCount(1);
  await expect(card.locator('.md li')).toHaveText('bullet');
});

test('item editor: edit fields, tags autocomplete, clean up, save & add another', async ({ page }) => {
  await addSource(page);
  await page.locator('.capture textarea').fill('First');
  await page.locator('.capture input.grow').fill('#memory, theory');
  await page.locator('.capture').getByRole('button', { name: 'Add' }).click();
  const card = page.locator('.items .art').first();
  await expect(card).toContainText('#memory');
  await card.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const m = page.locator('.modal');
  await m.getByLabel('Quote (verbatim)').fill('ﬁnal  text ,');
  await m.getByRole('button', { name: 'Clean up' }).click();
  await expect(m.getByLabel('Quote (verbatim)')).toHaveValue('final text,');
  // remove a tag, then get it back via autocomplete
  await m.locator('.tagin .chip', { hasText: 'memory' }).getByRole('button', { name: 'remove' }).click();
  await m.locator('.tagin input').fill('mem');
  await expect(m.locator('.sugg button')).toHaveText('#memory');
  await m.locator('.tagin input').press('Enter');
  await expect(m.locator('.tagin .chip')).toHaveCount(2);
  await m.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('final text,');
  // save & add another keeps the source
  await page.evaluate(() => ((window as any).__structed.ui.editArtifact = { kind: 'quote', sourceId: (window as any).__structed.ui.collectSourceId }));
  await expect(m.getByLabel('Source')).toHaveValue(/Assmann 2011/);
  await m.locator('textarea').first().fill('Second');
  await m.getByRole('button', { name: 'Save & add another' }).click();
  await m.locator('textarea').first().fill('Third');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.items .art')).toHaveCount(3);
});

test('bulk select: clean up, tag and delete with undo', async ({ page }) => {
  await addSource(page);
  for (const q of ['one  ,', 'two  ,', 'three']) {
    await page.locator('.capture textarea').fill(q);
    await page.locator('.capture').getByRole('button', { name: 'Add' }).click();
  }
  // capture already cleans; simulate dirty imported text
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    for (const a of db.all('artifacts')) db.update('artifacts', a.id, { text: a.text + '  ﬁ .' });
  });
  await page.locator('.bulk input[type=checkbox]').click();
  await expect(page.locator('.selbar')).toContainText('3 selected');
  await page.locator('.selbar').getByRole('button', { name: 'Bulk actions' }).click();
  await page.getByRole('menuitem', { name: 'Clean up text (OCR/PDF)' }).click();
  await expect(page.locator('.items .art').first()).toContainText('fi.');
  // Ctrl-click on a card ticks it, Esc ends the selection
  await page.locator('.items .art .toggle').first().click({ modifiers: ['Control'] });
  await expect(page.locator('.selbar')).toContainText('1 selected');
  await page.keyboard.press('Escape');
  await expect(page.locator('.selbar')).toHaveCount(0);
  await page.locator('.bulk input[type=checkbox]').click();
  await page.locator('.selbar').getByRole('button', { name: 'Delete selected' }).click();
  await expect(page.locator('.items .art')).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.items .art')).toHaveCount(3);
});

test('imports BibTeX and RIS from pasted text, flags duplicates', async ({ page }) => {
  await page.getByTitle('Import sources…').click();
  const m = page.locator('.modal');
  await m.locator('summary').click();
  await m.locator('textarea').fill(
    '@book{nora, author={Nora, Pierre}, title={Les lieux de mémoire}, publisher={Gallimard}, year={1984}}\n' +
      '@article{h, author={Halbwachs, Maurice}, title={On Collective Memory}, journal={X}, year={1992}}'
  );
  await m.getByRole('button', { name: 'Parse' }).click();
  await expect(m.locator('.it')).toHaveCount(2);
  await m.getByRole('button', { name: 'Import 2 sources' }).click();
  await expect(page.locator('.src', { hasText: 'Nora 1984' })).toBeVisible();
  // again: duplicates are detected and unchecked
  await page.getByTitle('Import sources…').click();
  await m.locator('summary').click();
  await m.locator('textarea').fill('TY  - BOOK\nAU  - Nora, Pierre\nTI  - Les lieux de mémoire\nPY  - 1984\nER  - \n');
  await m.getByRole('button', { name: 'Parse' }).click();
  await expect(m.locator('.it')).toContainText('exists – will update');
  await expect(m.locator('.it input')).not.toBeChecked();
});

test('merge a placeholder source into the real one', async ({ page }) => {
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const ph = db.create('sources', { csl: { id: 'p', type: 'book', title: 'Dürr (placeholder)' }, tags: [] });
    db.create('sources', { csl: { id: 'r', type: 'book', title: 'Die Kantaten von Johann Sebastian Bach', author: [{ family: 'Dürr', given: 'Alfred' }], issued: { 'date-parts': [[1971]] } }, tags: [] });
    for (const p of ['796', '797']) db.create('artifacts', { kind: 'quote', text: 'Quote ' + p, tags: [], sourceId: ph.id, page: p });
  });
  await page.locator('.src', { hasText: 'placeholder' }).click();
  await page.locator('.sh').getByRole('button', { name: 'Edit' }).click();
  const m = page.locator('.modal');
  await m.getByRole('button', { name: 'Merge into another source…' }).click();
  await m.getByLabel('Target source').selectOption({ label: 'Dürr 1971 — Die Kantaten von Johann Sebastian Bach' });
  await m.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.locator('.toast', { hasText: '2 items moved to “Dürr 1971”' })).toBeVisible();
  await expect(page.locator('.sh h2')).toHaveText('Die Kantaten von Johann Sebastian Bach');
  await expect(page.locator('.items .art')).toHaveCount(2);
  await expect(page.locator('.items .art').first()).toContainText('Dürr 1971, p. 796');
  await expect(page.locator('.src', { hasText: 'placeholder' })).toHaveCount(0);
});


