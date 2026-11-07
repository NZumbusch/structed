import { expect, test, type Page } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

/** A long project: many sections with text, and many quotes in one source. */
async function seedLong(page: Page) {
  await seedDemo(page);
  await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const pid = ui.projectId;
    const para = (n: number) => ({ type: 'paragraph', content: [{ type: 'text', text: `Paragraph ${n}. ` + 'Words to fill the page. '.repeat(30) }] });
    for (let i = 0; i < 12; i++) {
      const h = db.create('headings', { projectId: pid, parentId: null, title: 'Section ' + (i + 10), body: 'Notes '.repeat(40), order: 'z' + String(i).padStart(2, '0'), status: 'idea' });
      db.update('headings', h.id, { draft: JSON.stringify({ type: 'doc', content: [para(1), para(2), para(3)] }) });
    }
    const s = db.all('sources')[0];
    for (let i = 0; i < 40; i++) db.create('artifacts', { kind: 'quote', sourceId: s.id, text: 'Quote number ' + i, page: String(i), tags: [] });
  });
}
const top = (page: Page, sel: string) => page.locator(sel).evaluate((e) => Math.round(e.scrollTop));
/** Scroll there and return where it ended up once late content has settled. */
async function scrollTo(page: Page, sel: string, y: number) {
  await page.waitForTimeout(800); // late lines (the citation above a source's quotes) first
  await page.locator(sel).evaluate((e, y) => (e.scrollTop = y), y);
  await page.waitForTimeout(150);
  return top(page, sel);
}

test('switching stages keeps where you were scrolled', async ({ page }) => {
  await open(page, { settings: { outlineVisits: 99 } }); // no shortcut hints changing the outline's height
  await seedLong(page);
  await stage(page, 'Write');
  await expect(page.locator('.compose .ProseMirror').nth(10)).toBeAttached();
  const w = await scrollTo(page, '.compose', 2500);

  // go and add a quote, then come back
  await stage(page, 'Collect');
  await page.locator('.src', { hasText: 'Assmann' }).click();
  const c = await scrollTo(page, '.collect .main', 900);
  await stage(page, 'Outline');
  const o = await scrollTo(page, '.wrap', 600);

  await stage(page, 'Write');
  expect(w).toBe(2500);
  await expect.poll(() => top(page, '.compose')).toBe(w);
  await stage(page, 'Collect');
  await expect.poll(() => top(page, '.collect .main')).toBe(c);
  await stage(page, 'Outline');
  await expect.poll(() => top(page, '.wrap')).toBe(o);
  // Arrange is its own place
  await stage(page, 'Arrange');
  await expect.poll(() => top(page, '.wrap')).toBe(0);

  // also after a reload of the tab
  await stage(page, 'Write');
  await expect.poll(() => top(page, '.compose')).toBe(w);
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect.poll(() => top(page, '.compose')).toBe(w);

  // focus mode does not lose the place either
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator('.compose')).toHaveClass(/focus/);
  await expect.poll(() => top(page, '.compose')).toBeGreaterThan(2000);
});

test('each source in Collect keeps its own place', async ({ page }) => {
  await open(page);
  await seedLong(page);
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const s2 = db.create('sources', { csl: { id: 'n', type: 'book', title: 'Les lieux', author: [{ family: 'Nora' }] }, tags: [] });
    for (let i = 0; i < 30; i++) db.create('artifacts', { kind: 'quote', sourceId: s2.id, text: 'Nora quote ' + i, page: String(i), tags: [] });
  });
  await stage(page, 'Collect');
  await page.locator('.src', { hasText: 'Assmann' }).click();
  const a = await scrollTo(page, '.collect .main', 700);
  await page.locator('.src', { hasText: 'Nora' }).click();
  await expect.poll(() => top(page, '.collect .main')).toBe(0); // a new source starts at the top
  await scrollTo(page, '.collect .main', 300);
  await page.locator('.src', { hasText: 'Assmann' }).click();
  await expect.poll(() => top(page, '.collect .main')).toBe(a);
});
