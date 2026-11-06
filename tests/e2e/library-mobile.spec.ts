import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { open } from './helpers';

/** Hold a finger on an element (real touch events). */
async function hold(page: Page, ctx: BrowserContext, sel: ReturnType<Page['locator']>, ms = 650) {
  const b = (await sel.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + Math.min(b.height / 2, 16);
  const cdp = await ctx.newCDPSession(page);
  const pt = [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function libraryWithItems(page: Page) {
  await open(page);
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const s1 = db.create('sources', { csl: { id: 'a', type: 'book', title: 'Gedächtnis', author: [{ family: 'Assmann' }], issued: { 'date-parts': [[2011]] } }, tags: [] });
    db.create('sources', { csl: { id: 'b', type: 'book', title: 'Les lieux', author: [{ family: 'Nora' }], issued: { 'date-parts': [[1984]] } }, tags: [] });
    db.create('sources', { csl: { id: 'c', type: 'book', title: 'History', author: [{ family: 'Le Goff' }], issued: { 'date-parts': [[1992]] } }, tags: [] });
    for (const x of ['First quote', 'Second quote', 'Third quote']) db.create('artifacts', { kind: 'quote', sourceId: s1.id, text: x, page: '1', tags: [] });
  });
  await page.getByRole('button', { name: /Open library/ }).click();
}

test('@phone hold a quote to select it, tap more, then act on all of them', async ({ page, context }) => {
  await libraryWithItems(page);
  await page.locator('.src', { hasText: 'Assmann' }).click();
  const cards = page.locator('.items .art');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.bulk')).toContainText('hold one to select');
  await expect(page.locator('.inner .ref')).toBeVisible(); // rendered a moment later; would shift the cards

  await hold(page, context, cards.nth(0).locator('.toggle'));
  const bar = page.getByRole('toolbar', { name: 'Selected items' });
  await expect(bar).toContainText('1 selected');
  await expect(cards.nth(0)).toHaveClass(/selected/);
  await expect(cards.nth(0).getByRole('checkbox', { name: 'Select' })).toHaveAttribute('aria-checked', 'true');
  await expect(cards.nth(0)).not.toHaveClass(/expanded/); // the hold did not also open it

  // taps now tick instead of opening
  await cards.nth(2).locator('.toggle').tap();
  await expect(bar).toContainText('2 selected');
  await expect(cards.nth(2)).not.toHaveClass(/expanded/);
  // the bar sits at the bottom, within thumb reach
  const bb = (await bar.boundingBox())!;
  expect(bb.y + bb.height).toBeGreaterThan(page.viewportSize()!.height - 80);

  await bar.getByRole('button', { name: 'Delete selected' }).tap();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Second quote');
  await expect(bar).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).tap();
  await expect(cards).toHaveCount(3);

  // unticking the last one ends the selection; back gesture also ends it
  await hold(page, context, cards.nth(1).locator('.toggle'));
  await expect(bar).toContainText('1 selected');
  await cards.nth(1).locator('.toggle').tap();
  await expect(bar).toHaveCount(0);
  await hold(page, context, cards.nth(1).locator('.toggle'));
  await expect(bar).toBeVisible();
  await page.goBack();
  await expect(bar).toHaveCount(0);
  await expect(cards).toHaveCount(3); // still in the source
});

test('@phone hold a source to select several sources', async ({ page, context }) => {
  await libraryWithItems(page);
  await hold(page, context, page.locator('.src', { hasText: 'Nora' }));
  const pick = page.getByRole('toolbar', { name: 'Selected sources' });
  await expect(pick).toContainText('1 selected');
  await expect(page.locator('.src', { hasText: 'Nora' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.src', { hasText: 'Le Goff' }).tap();
  await expect(pick).toContainText('2 selected');
  await expect(page.locator('.collect')).not.toHaveClass(/detail/); // tapping did not open a source
  await pick.getByRole('button', { name: 'Delete selected sources' }).tap();
  await page.locator('.modal').getByRole('button', { name: 'Delete' }).tap();
  await expect(page.locator('.src', { hasText: 'Nora' })).toHaveCount(0);
  await expect(page.locator('.src', { hasText: 'Assmann' })).toHaveCount(1);
});

test('@phone back goes from a source to the library, not to the start screen; reload keeps the library', async ({ page }) => {
  await libraryWithItems(page);
  await page.locator('.src', { hasText: 'Assmann' }).click();
  await expect(page.locator('.items .art')).toHaveCount(3);
  // open a quote's editor, then go back twice
  await page.locator('.items .art').first().getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.items .art')).toHaveCount(3);
  await page.goBack();
  await expect(page.locator('.src', { hasText: 'Assmann' })).toBeVisible(); // the source list of the library
  await expect(page.locator('.ltitle')).toHaveText('Library');
  // a reload (or reopening the app) comes back to the library
  await page.locator('.src', { hasText: 'Nora' }).click();
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('.ltitle')).toHaveText('Library');
  await expect(page.locator('.inner h2')).toContainText('Les lieux');
  // closing with the on-screen buttons keeps back working as expected
  await page.getByRole('button', { name: 'Sources' }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: /Open library/ })).toBeVisible();
});
