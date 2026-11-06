import { expect, test, type Page } from '@playwright/test';
import { center, mouseDrag, open, seedDemo, stage } from './helpers';

/** Demo project + an unrelated source with quotes from another topic. */
async function seed(page: Page) {
  await open(page);
  await seedDemo(page);
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const s = db.create('sources', { csl: { id: 'x', type: 'book', title: 'Unrelated Topic', author: [{ family: 'Other' }], issued: { 'date-parts': [[1999]] } }, tags: [] });
    for (const p of ['1', '2', '3']) db.create('artifacts', { kind: 'quote', text: 'Unrelated quote ' + p, tags: [], sourceId: s.id, page: p });
  });
}

test('side panel shows only this project by default; can switch to the library', async ({ page }) => {
  await seed(page);
  await stage(page, 'Arrange');
  const lib = page.locator('.lib');
  await expect(lib.locator('.gh', { hasText: 'Other 1999' })).toHaveCount(0);
  await expect(lib.locator('.scopes button', { hasText: 'Project' })).toContainText('3');
  await lib.locator('.scopes button', { hasText: 'Library' }).click();
  await expect(lib.locator('.gh', { hasText: 'Other 1999' })).toBeVisible();
  // usage filter: unused / all / used
  await lib.locator('.scopes button', { hasText: 'Project' }).click();
  await lib.locator('.select').selectOption('none');
  await lib.locator('.usage').getByRole('button', { name: 'Used', exact: true }).click();
  await expect(lib.locator('.art')).toHaveCount(1);
  await lib.locator('.usage button', { hasText: 'Unused' }).click();
  await expect(lib.locator('.art')).toHaveCount(2);
  await lib.locator('.usage button', { hasText: 'All' }).click();
  await expect(lib.locator('.art')).toHaveCount(3);
});

test('select stage: add a whole source, add single quotes, drag in, remove', async ({ page }) => {
  await seed(page);
  await stage(page, 'Select');
  const left = page.locator('.col.lib');
  const right = page.locator('.col.proj');
  await expect(right).toContainText('3 items · 1 placed under headings');
  const other = left.locator('.src', { hasText: 'Other 1999' });
  await other.locator('.sname').click();
  // single quote via +
  await other.locator('.it', { hasText: 'Unrelated quote 1' }).getByTitle('Add to this project').click();
  await expect(right).toContainText('4 items');
  // drag another quote into the right column
  await mouseDrag(page, await center(page, other.locator('.it', { hasText: 'Unrelated quote 2' }).locator('.itext')), await center(page, right.locator('.list')));
  await expect(right).toContainText('5 items');
  // whole source: includes the rest and future quotes
  await other.getByRole('button', { name: 'Source' }).click();
  await expect(right).toContainText('6 items');
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const s = db.all('sources').find((x: any) => x.csl.title === 'Unrelated Topic');
    db.create('artifacts', { kind: 'quote', text: 'Added later', tags: [], sourceId: s.id, page: '9' });
  });
  await expect(right).toContainText('7 items');
  await expect(right.locator('.src', { hasText: 'Other 1999' })).toContainText('whole source');
  // hide one item of the whole source
  await right.locator('.it', { hasText: 'Added later' }).getByTitle('Remove from project').click();
  await expect(right).toContainText('6 items');
  // remove the whole source again
  await right.locator('.src', { hasText: 'Other 1999' }).getByTitle('Remove source from project').click();
  await expect(right.locator('.src', { hasText: 'Other 1999' })).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(right.locator('.src', { hasText: 'Other 1999' })).toBeVisible();
  // the panel in Arrange now shows them
  await right.getByRole('button', { name: /Continue to Arrange/ }).click();
  await expect(page.locator('.lib .gh', { hasText: 'Other 1999' })).toBeVisible();
});

test('library is reachable without a project and offers cleanup views', async ({ page }) => {
  await seed(page);
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'Library (all projects)' }).click();
  await expect(page.locator('nav.stages')).toHaveCount(0);
  await expect(page.locator('header .ltitle')).toHaveText('Library');
  await page.locator('.src', { hasText: 'In no project' }).click();
  await expect(page.locator('.items .art')).toHaveCount(3); // the unrelated quotes
  await page.locator('.src', { hasText: 'Without page number' }).click();
  await expect(page.locator('.items .art')).toHaveCount(0); // demo paraphrase has a page, own note excluded
  // bulk add to a project from the library
  await page.locator('.src', { hasText: 'In no project' }).click();
  await page.locator('.bulk input[type=checkbox]').click();
  await page.locator('.selbar').getByRole('button', { name: 'Bulk actions' }).click();
  await page.getByRole('menuitem', { name: /Add to “Demo/ }).click();
  await expect(page.locator('.items .art')).toHaveCount(0);
  // every item shows which projects it belongs to
  await page.locator('.src', { hasText: 'All items' }).click();
  await expect(page.locator('.items .art .proj').first()).toContainText('Demo');
  // back to the start screen, which also opens the library
  await page.getByRole('button', { name: 'Projects' }).click();
  await expect(page.getByRole('button', { name: 'Open library (all sources & quotes)' })).toBeVisible();
});

test('closing a project stays on the start screen after reload', async ({ page }) => {
  await seed(page);
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await page.getByRole('menuitem', { name: 'Close project' }).click();
  await expect(page.getByPlaceholder('Working title')).toBeVisible();
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.getByPlaceholder('Working title')).toBeVisible();
});

test('possible duplicates are listed next to each other', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    db.create('artifacts', { kind: 'quote', text: 'The past is not simply preserved, but reconstructed!', tags: [] });
  });
  await stage(page, 'Collect');
  await page.locator('.src', { hasText: 'Possible duplicates' }).click();
  await expect(page.locator('.items .art')).toHaveCount(2);
});

test('outline titles wrap instead of being cut off; actions are calm', async ({ page }) => {
  await seed(page);
  const long = 'Zusammenspiel von Kirche und weltlicher Autorität nach Luther und dem Dreißigjährigen Krieg in Sachsen und Thüringen';
  await page.locator('textarea.title').first().fill(long);
  const ta = page.locator('textarea.title').first();
  expect(await ta.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  expect((await ta.boundingBox())!.height).toBeGreaterThan(40); // wrapped to two lines
  await expect(ta).toHaveValue(long);
  // Enter still creates a new heading (no line breaks inside titles)
  await ta.press('End');
  await ta.press('Enter');
  await expect(page.locator('textarea.title')).toHaveCount(5);
});
