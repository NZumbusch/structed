import { expect, test } from '@playwright/test';
import { open } from './helpers';

test('first use: tour starts, creates a demo, highlights every step, can remove demo', async ({ page }) => {
  await open(page, { tour: true });
  const bubble = page.locator('.tour .bubble');
  await expect(bubble.locator('h3')).toHaveText('Welcome to Structed');
  const total = Number((await bubble.locator('.tiny').textContent())!.split('/')[1]);
  expect(total).toBeGreaterThan(10);
  for (let i = 1; i < total; i++) {
    await bubble.getByRole('button', { name: 'Next' }).click();
    await expect(bubble.locator('.tiny')).toHaveText(`${i + 1} / ${total}`);
    const last = i === total - 1;
    if (!last) {
      // every middle step spotlights a visible element
      const spot = page.locator('.tour .spot');
      await expect(spot, `step ${i + 1} spotlight`).toBeVisible();
      const b = (await spot.boundingBox())!;
      expect(b.width).toBeGreaterThan(10);
      expect(b.y).toBeGreaterThanOrEqual(-10);
    }
    // bubble always fully on screen
    const bb = (await bubble.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(bb.x).toBeGreaterThanOrEqual(0);
    expect(bb.x + bb.width).toBeLessThanOrEqual(vp.width);
    expect(bb.y + bb.height).toBeLessThanOrEqual(vp.height + 1);
  }
  await expect(page.locator('input.ptitle, nav.stages').first()).toBeVisible();
  await bubble.getByRole('button', { name: 'Remove demo' }).click();
  await expect(page.locator('.tour')).toHaveCount(0);
  await expect(page.getByPlaceholder('Working title')).toBeVisible();
  // not shown again after reload
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('.tour')).toHaveCount(0);
});

test('tour can be skipped with Escape and restarted from settings', async ({ page }) => {
  await open(page, { tour: true });
  await expect(page.locator('.tour')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour')).toHaveCount(0);
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'About & help' }).click();
  await page.getByRole('button', { name: 'Start guided tour' }).click();
  await expect(page.locator('.tour .bubble h3')).toHaveText('Welcome to Structed');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.tour .bubble .tiny')).toHaveText(/^2 \//);
});
