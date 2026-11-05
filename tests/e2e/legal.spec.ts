import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { noHorizontalOverflow, open } from './helpers';

const PAGES = ['about', 'privacy', 'terms'];

test.describe('@layout @a11y public pages', () => {
  for (const p of PAGES) {
    test(`${p}: renders, both languages, accessible, no overflow`, async ({ page }) => {
      await page.goto(`${p}.html?lang=en`);
      await expect(page.locator('main [lang="en"] h1')).toBeVisible();
      await expect(page.locator('main [lang="de"] h1')).toBeHidden();
      await noHorizontalOverflow(page);
      let r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => v.id)).toEqual([]);
      await page.getByRole('button', { name: 'DE' }).click();
      await expect(page.locator('main [lang="de"] h1')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      await page.emulateMedia({ colorScheme: 'dark' });
      r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(r.violations.map((v) => v.id)).toEqual([]);
      // brand stays on one line; headings never break inside a word without a hyphen
      const brand = (await page.locator('header .brand').boundingBox())!;
      expect(brand.height).toBeLessThan(40);
      for (const h of await page.locator('main [lang="de"] h1, main [lang="de"] h2').all()) {
        const broken = await h.evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
          if (lines.size < 2) return false;
          const hy = getComputedStyle(el).hyphens;
          return hy !== 'auto'; // multi-line must be via spaces or real hyphenation
        });
        expect(broken).toBe(false);
      }
      // no unreplaced template markers
      expect(await page.content()).not.toMatch(/\{\{[A-Z_:]+\}\}/);
    });
  }
});

test('privacy policy contains what Google requires', async ({ page }) => {
  await page.goto('privacy.html?lang=en');
  const en = page.locator('main [lang="en"]');
  await expect(en).toContainText('drive.appdata');
  await expect(en).toContainText('Google API Services User Data Policy, including the Limited Use requirements');
  await expect(en.getByRole('link', { name: 'Google API Services User Data Policy' })).toHaveAttribute('href', 'https://developers.google.com/terms/api-services-user-data-policy');
  await expect(en).toContainText('na.zumbusch@gmail.com');
  await expect(en).toContainText('myaccount.google.com/connections');
  await expect(page.locator('main [lang="de"]')).toContainText('Limited Use');
});

test('owner name is filled in (no placeholder on published pages)', async ({ page }) => {
  for (const p of PAGES) {
    await page.goto(`${p}.html`);
    expect(await page.content(), `${p}.html`).not.toContain('PLACEHOLDER');
  }
});

test('homepage links to the app, privacy and terms; app links back', async ({ page }) => {
  await page.goto('about.html?lang=en');
  await expect(page.locator('main [lang="en"]').getByRole('link', { name: 'Open the app →' })).toHaveAttribute('href', './');
  await page.locator('header').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/privacy\.html/);
  await page.locator('header').getByRole('link', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/terms\.html/);
  await open(page);
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', 'privacy.html');
});

test('pages load as themselves after the service worker is active', async ({ page }) => {
  await open(page);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active, null, { timeout: 15_000 });
  await page.reload();
  await page.goto('privacy.html?lang=en');
  await expect(page.locator('main [lang="en"] h1')).toHaveText('Privacy policy');
});
