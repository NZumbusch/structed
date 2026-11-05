import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { open, seedDemo, stage } from './helpers';

const THEMES = [
  { theme: 'light', contrast: 'normal' },
  { theme: 'dark', contrast: 'normal' },
  { theme: 'sepia', contrast: 'normal' },
  { theme: 'light', contrast: 'high' },
  { theme: 'dark', contrast: 'high' }
];

async function audit(page: Page, label: string) {
  // wait for transitions/animations to settle
  await page.waitForTimeout(250);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' → ' + (n.any[0]?.message ?? '')).join(' | ')}`);
  expect(summary, `${label}`).toEqual([]);
}

for (const th of THEMES) {
  test.describe(`@a11y ${th.theme}/${th.contrast}`, () => {
    test.beforeEach(async ({ page }) => {
      await open(page, { settings: { theme: th.theme, contrast: th.contrast, reduceMotion: true } });
    });

    test('welcome screen', async ({ page }) => {
      await audit(page, 'welcome');
    });

    test('all stages with content', async ({ page }) => {
      await seedDemo(page);
      await page.evaluate(() => {
        const s = (window as any).__structed;
        for (const h of s.db.all('headings')) s.ui.openBodies.add(h.id);
        for (const p of s.db.all('placements')) s.ui.expandedArtifacts.add(`${p.id}:${p.artifactId}`);
        s.db.create('comments', { projectId: s.ui.projectId, targetId: s.db.all('headings')[0].id, text: 'A comment' });
      });
      await audit(page, 'outline');
      await stage(page, 'Collect');
      await page.locator('.src').nth(2).click();
      await audit(page, 'collect');
      await stage(page, 'Arrange');
      if (await page.locator('.lib .gh').first().isVisible()) await page.locator('.lib .gh').first().click();
      await audit(page, 'arrange');
      await stage(page, 'Write');
      await audit(page, 'write');
    });

    test('dialogs', async ({ page }) => {
      await seedDemo(page);
      await page.getByTitle('Settings').click();
      for (const tab of ['Appearance', 'Citations', 'Keyboard shortcuts', 'Zotero', 'Sync', 'Backup & data', 'About & help']) {
        await page.locator('.modal nav button', { hasText: tab }).click();
        await audit(page, `settings/${tab}`);
      }
      await page.keyboard.press('Escape');
      await page.evaluate(() => ((window as any).__structed.ui.editArtifact = { id: (window as any).__structed.db.all('artifacts')[0].id }));
      await audit(page, 'item editor');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await page.locator('.pal input').fill('memory');
      await audit(page, 'search');
      await page.keyboard.press('Escape');
      await page.evaluate(() => ((window as any).__structed.ui.tour = true));
      await audit(page, 'tour');
    });
  });
}
