import { expect, test, type Page } from '@playwright/test';
import { noHorizontalOverflow, open, seedDemo, stage } from './helpers';

const LONG_WORD = 'Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenversicherungsanstalt'.repeat(2);
const LONG_URL = 'https://example.org/' + 'very-long-path-segment/'.repeat(8);

async function seedLong(page: Page) {
  await seedDemo(page);
  await page.evaluate(
    ({ word, url }) => {
      const { db, ui } = (window as any).__structed;
      const pid = ui.projectId;
      const [first] = db.all('headings').filter((h: any) => h.projectId === pid).sort((a: any, b: any) => a.order - b.order);
      db.update('headings', first.id, { title: 'A very long heading title with ' + word, body: 'Line one\nLine two\n\n' + word + ' ' + url });
      db.update('projects', pid, { title: 'Project ' + word, subtitle: word });
      const src = db.create('sources', { csl: { id: 'l', type: 'book', title: 'Title ' + word, author: [{ family: word }] }, tags: [word.slice(0, 40)] });
      const q = db.create('artifacts', { kind: 'quote', sourceId: src.id, text: 'First line of quote\nSecond line of quote\n' + word + ' ' + url, page: '1', tags: [word.slice(0, 50)], comment: word });
      const p = db.create('placements', { projectId: pid, headingId: first.id, artifactId: q.id, order: 0 });
      ui.expandedArtifacts.add(`${p.id}:${q.id}`);
      ui.expandedArtifacts.add(`panel:${q.id}`);
      ui.openBodies.add(first.id);
      db.create('comments', { projectId: pid, targetId: first.id, text: 'Comment ' + word });
    },
    { word: LONG_WORD, url: LONG_URL }
  );
}

test.describe('@layout no horizontal overflow with very long words and URLs', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await seedLong(page);
  });
  for (const s of ['Outline', 'Collect', 'Arrange', 'Write'] as const) {
    test(s, async ({ page }) => {
      await stage(page, s);
      if (s === 'Collect') {
        await page.locator('.src', { hasText: 'Title' }).first().click();
      }
      if (s === 'Arrange' && !page.viewportSize()!.width) return;
      await page.waitForTimeout(200);
      await noHorizontalOverflow(page);
      // content cards never exceed their container
      for (const el of await page.locator('.art').all()) {
        if (!(await el.isVisible())) continue;
        const ov = await el.evaluate((e) => e.scrollWidth - e.clientWidth);
        expect(ov).toBeLessThanOrEqual(1);
      }
    });
  }
  test('dialogs', async ({ page }) => {
    await page.getByTitle('Settings').click();
    for (const tab of ['Appearance', 'Keyboard shortcuts', 'Sync', 'Backup & data']) {
      await page.locator('.modal nav button', { hasText: tab }).click();
      await noHorizontalOverflow(page);
    }
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const { db, ui } = (window as any).__structed;
      ui.editArtifact = { id: db.all('artifacts').find((a: any) => a.comment?.length > 50).id };
    });
    await noHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await page.evaluate(() => ((window as any).__structed.ui.editSource = { id: (window as any).__structed.db.all('sources').find((s: any) => s.csl.id === 'l').id }));
    await noHorizontalOverflow(page);
  });
});

test.describe('@layout line breaks are preserved', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await seedLong(page);
  });
  test('quotes keep their line breaks in Write', async ({ page }) => {
    await stage(page, 'Write');
    const text = page.locator('.paper .art.expanded .text').first();
    await expect(text).toHaveCSS('white-space', 'pre-wrap');
    const lines = await text.evaluate((e) => {
      const lh = parseFloat(getComputedStyle(e).lineHeight);
      return Math.round(e.getBoundingClientRect().height / lh);
    });
    expect(lines).toBeGreaterThanOrEqual(3);
  });
  test('section text: single newline → <br>, blank line → paragraph', async ({ page }) => {
    await stage(page, 'Write');
    const md = page.locator('.sec').first().locator('.md.body');
    await expect(md.locator('p')).toHaveCount(2);
    await expect(md.locator('p').first().locator('br')).toHaveCount(1);
  });
  test('notes editor wraps long lines instead of scrolling', async ({ page }) => {
    await stage(page, 'Outline');
    const cm = page.locator('.hrow .cm-content').first();
    await expect(cm).toHaveClass(/cm-lineWrapping/);
    const scroller = page.locator('.hrow .cm-scroller').first();
    expect(await scroller.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  });
  test('long headings wrap in Write and TOC truncates with ellipsis', async ({ page }) => {
    await stage(page, 'Write');
    const h = page.locator('.sec .ht').first();
    const box = (await h.boundingBox())!;
    const paper = (await page.locator('.paper').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(paper.x + paper.width + 1);
    expect(box.height).toBeGreaterThan(40); // wrapped onto several lines
    const toc = page.locator('.toc .tt').first();
    if (await toc.isVisible()) await expect(toc).toHaveCSS('text-overflow', 'ellipsis');
  });
  test('collapsed cards clamp to two lines; expanded cards show everything', async ({ page }) => {
    await stage(page, 'Write');
    await page.getByRole('button', { name: 'Collapse all' }).click();
    const label = page.locator('.paper .art .label').first();
    await expect(label).toHaveClass(/clamp/);
    const lh = await label.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
    expect((await label.boundingBox())!.height).toBeLessThanOrEqual(lh * 2 + 2);
    await page.getByRole('button', { name: 'Expand all' }).click();
    await expect(page.locator('.paper .art.expanded .text').first()).toContainText('Second line of quote');
  });
});

test('@layout touch targets are large enough on phones', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 500, 'phone only');
  await open(page);
  await seedDemo(page);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('header button, nav.stages button')]
      .filter((b) => b.offsetParent)
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width < 24 || r.height < 24).length
  );
  expect(small).toBe(0);
});

test('@layout settings tab bar stays flush while scrolling on phones', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, 'phone layout only');
  await open(page);
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'Keyboard shortcuts' }).click();
  const body = page.locator('.modal .body');
  await body.evaluate((el) => (el.scrollTop = 600));
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.modal .body')!.getBoundingClientRect();
    const n = document.querySelector('.modal nav')!.getBoundingClientRect();
    return { bodyTop: b.top, navTop: n.top, bodyLeft: b.left, navLeft: n.left, bodyW: b.width, navW: n.width };
  });
  expect(r.navTop).toBeLessThanOrEqual(r.bodyTop + 0.5); // no gap above the bar
  expect(Math.abs(r.navLeft - r.bodyLeft)).toBeLessThanOrEqual(1); // full width
  expect(r.navW).toBeGreaterThanOrEqual(r.bodyW - 1);
  // the active tab is fully visible
  const tab = page.locator('.modal nav button.on');
  const tb = (await tab.boundingBox())!;
  const nb = (await page.locator('.modal nav').boundingBox())!;
  expect(tb.x).toBeGreaterThanOrEqual(nb.x - 1);
  expect(tb.x + tb.width).toBeLessThanOrEqual(nb.x + nb.width + 1);
});

test('@layout menus always open fully on screen', async ({ page }) => {
  await open(page);
  await seedDemo(page);
  const vp = page.viewportSize()!;
  const check = async (label: string) => {
    const m = page.locator('.menu');
    await expect(m, label).toBeVisible();
    const b = (await m.boundingBox())!;
    expect(b.x, `${label} left`).toBeGreaterThanOrEqual(0);
    expect(b.y, `${label} top`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${label} right`).toBeLessThanOrEqual(vp.width);
    expect(b.y + b.height, `${label} bottom`).toBeLessThanOrEqual(vp.height);
    await page.keyboard.press('Escape');
  };
  // project menu (far left of the top bar)
  await page.locator('[data-tour="project"]').getByRole('button', { name: /Project menu/ }).click();
  await check('project menu');
  // heading menu (far right)
  await page.locator('.hrow').first().getByRole('button', { name: 'More' }).click();
  await check('heading menu');
  // last heading near the bottom
  await page.locator('.hrow').last().getByRole('button', { name: 'More' }).click();
  await check('last heading menu');
});
