import { expect, type Page, type BrowserContext } from '@playwright/test';

export interface Opts {
  settings?: Record<string, unknown>;
  tour?: boolean; // show first-use tour
}

/** Fresh app with clean storage (each Playwright test has its own context). */
export async function open(page: Page, o: Opts = {}) {
  const settings = { language: 'en', tourDone: !o.tour, ...(o.settings ?? {}) };
  await page.addInitScript((s) => {
    if (!sessionStorage.getItem('__init')) {
      localStorage.setItem('structed.settings', JSON.stringify(s));
      sessionStorage.setItem('__init', '1');
    }
  }, settings);
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
}

export async function seedDemo(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__structed;
    s.ui.projectId = s.createDemo('en');
  });
  await expect(page.locator('nav.stages')).toBeVisible();
}

export async function newProject(page: Page, title = 'Test project', template = 'Seminar paper') {
  await page.getByPlaceholder('Working title').fill(title);
  await page.locator('.tpl', { hasText: template }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('textarea.ptitle')).toHaveValue(title);
}

export const stage = (page: Page, name: 'Outline' | 'Collect' | 'Select' | 'Arrange' | 'Draft' | 'Write') =>
  page.locator('nav.stages button', { hasText: name }).click();

export async function stageByIndex(page: Page, i: number) {
  await page.locator('nav.stages button').nth(i).click();
}

export async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Long-press then drag with real touch events (CDP). */
export async function touchDrag(page: Page, ctx: BrowserContext, from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 450) {
  const cdp = await ctx.newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x, from.y) });
  await page.waitForTimeout(holdMs);
  for (let i = 1; i <= 14; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pt(from.x + ((to.x - from.x) * i) / 14, from.y + ((to.y - from.y) * i) / 14)
    });
    await page.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export const center = async (page: Page, sel: string | ReturnType<Page['locator']>) => {
  const l = typeof sel === 'string' ? page.locator(sel) : sel;
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

export const headingTitles = (page: Page) => page.locator('textarea.title').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
export const numbers = (page: Page) => page.locator('.hrow .num').allTextContents();

export async function noHorizontalOverflow(page: Page) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || getComputedStyle(el).position === 'fixed') continue;
      let clipped = false;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox !== 'visible') {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;
      if (rect.right > window.innerWidth + 1) offenders.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80));
    }
    return { sw: doc.scrollWidth, cw: doc.clientWidth, offenders: offenders.slice(0, 5) };
  });
  expect(r.offenders, 'elements overflow viewport').toEqual([]);
  expect(r.sw).toBeLessThanOrEqual(r.cw);
}
