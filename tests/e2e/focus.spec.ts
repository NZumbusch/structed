import { expect, test } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page, { settings: { language: 'en' } });
  await seedDemo(page);
  await stage(page, 'Write');
  await expect(page.locator('.compose .ProseMirror').first()).toBeVisible();
});

test('notes under the headings can be toggled in the Write stage', async ({ page }) => {
  const gist = page.locator('.compose .gist').first();
  await expect(gist).toContainText('Sketch the starting question');
  await expect(gist.locator('strong')).toHaveText('thesis'); // rendered markdown
  await page.locator('.bar').getByRole('button', { name: 'Notes' }).click();
  await expect(page.locator('.compose .gist')).toHaveCount(0);
  await page.locator('.bar').getByRole('button', { name: 'Notes' }).click();
  await expect(page.locator('.compose .gist').first()).toBeVisible();
});

test('focus mode hides everything but the text; notes and quotes can be toggled', async ({ page }) => {
  await expect(page.locator('.app .panel')).toBeVisible();
  await page.locator('.bar').getByRole('button', { name: 'Focus mode' }).click();

  // only the text: no header, no library panel, no notes, no formatting bar
  await expect(page.locator('header.top')).toHaveCount(0);
  await expect(page.locator('.app .panel')).toHaveCount(0);
  await expect(page.locator('.compose .gist')).toHaveCount(0);
  await expect(page.locator('.compose .bar')).toHaveCount(0);
  const fbar = page.getByRole('toolbar', { name: 'Focus mode' });
  await expect(fbar).toBeVisible();

  await fbar.getByRole('button', { name: 'Notes' }).click();
  await expect(page.locator('.compose .gist').first()).toBeVisible();
  await fbar.getByRole('button', { name: 'Quotes' }).click();
  await expect(page.locator('.app .panel')).toBeVisible();
  await expect(page.locator('.app .panel .lib')).toBeVisible();
  await fbar.getByRole('button', { name: 'Quotes' }).click();
  await expect(page.locator('.app .panel')).toHaveCount(0);

  // focus mode survives a reload
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('header.top')).toHaveCount(0);
  await expect(page.locator('.compose .gist').first()).toBeVisible(); // the notes choice is kept

  // Esc leaves focus mode, the normal panel comes back
  await page.locator('.compose .ProseMirror').first().click();
  await page.keyboard.press('Escape');
  await expect(page.locator('header.top')).toBeVisible();
  await expect(page.locator('.app .panel')).toBeVisible();
  await expect(page.locator('.compose .bar')).toBeVisible();
});

test('shortcut, paragraph dimming, auto-hiding controls and the session goal', async ({ page }) => {
  // the shortcut works from another stage too and switches to Write
  await stage(page, 'Outline');
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator('.compose')).toHaveClass(/focus/);

  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('First paragraph.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second one here');
  // the controls fade out while typing
  await expect(page.locator('.fbar')).toHaveClass(/idle/);
  await page.mouse.move(200, 200);
  await page.mouse.move(400, 300);
  await expect(page.locator('.fbar')).not.toHaveClass(/idle/);

  // only the paragraph with the caret stays fully visible
  const ps = ed.locator('p');
  await expect(ps.nth(1)).toHaveClass(/focus-cur/);
  const opacity = (i: number) => ps.nth(i).evaluate((e) => getComputedStyle(e).opacity);
  await expect.poll(() => opacity(0)).toBe('0.3');
  await expect.poll(() => opacity(1)).toBe('1');
  await page.getByRole('button', { name: 'Highlight current paragraph' }).click();
  await ed.click();
  await expect.poll(() => opacity(0)).toBe('1');

  // session goal: counts the words written since focus mode was entered
  await page.getByRole('button', { name: 'Goal' }).click();
  await page.getByRole('menuitem', { name: '500 words this session', exact: true }).click();
  await expect(page.locator('.fstat')).toContainText('5 / 500');
  await ed.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and more');
  await expect(page.locator('.fstat')).toContainText('7 / 500');

  // writing sprint shows a countdown and can be stopped
  await page.mouse.move(300, 300);
  await page.mouse.move(500, 400);
  await page.getByRole('button', { name: /Sprint|\d+:\d\d/ }).click();
  await page.getByRole('menuitem', { name: '25 minute sprint' }).click();
  await expect(page.locator('.fbar .run')).toHaveText(/^2[45]:\d\d$/);
  await page.getByRole('button', { name: /Sprint|\d+:\d\d/ }).click();
  await page.getByRole('menuitem', { name: 'Stop sprint' }).click();
  await expect(page.locator('.fbar .run')).toHaveCount(0);

  // typewriter scrolling keeps the caret near the middle of the screen
  await page.getByRole('button', { name: 'Typewriter scrolling' }).click();
  await ed.click();
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Enter');
  await page.keyboard.type('Down here');
  await page.waitForTimeout(100);
  const y = await page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return r.top / window.innerHeight;
  });
  expect(y).toBeGreaterThan(0.3);
  expect(y).toBeLessThan(0.55);

  // the same shortcut leaves focus mode again
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator('header.top')).toBeVisible();
});

test('@phone focus mode on a phone: quotes open in the drawer', async ({ page }) => {
  await page.locator('.bar').getByRole('button', { name: 'Focus mode' }).click();
  await expect(page.locator('header.top')).toHaveCount(0);
  const fbar = page.getByRole('toolbar', { name: 'Focus mode' });
  const box = await fbar.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await fbar.getByRole('button', { name: 'Quotes' }).click();
  await expect(page.locator('.drawer')).toBeVisible();
  await page.locator('.drawer').getByRole('button', { name: 'Close' }).click();
  await fbar.getByRole('button', { name: 'Exit focus mode' }).click();
  await expect(page.locator('header.top')).toBeVisible();
});
