import { expect, test } from '@playwright/test';
import { open, seedDemo } from './helpers';

test('a secondary citation with a column: set in the editor, cited as one citation', async ({ page }) => {
  await open(page, { settings: { citationStyle: 'apa', citationLocale: 'de-DE' } });
  await seedDemo(page);
  const ids = await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const k = db.create('sources', { csl: { id: 'k', type: 'book', title: 'Konfessionalisierung', author: [{ family: 'Kaufmann', given: 'Thomas' }], issued: { 'date-parts': [[1996]] } }, tags: [] });
    const l = db.create('sources', { csl: { id: 'l', type: 'book', title: 'Der Umgang', author: [{ family: 'Lotz-Heumann', given: 'Ute' }], issued: { 'date-parts': [[2001]] } }, tags: [] });
    const q = db.create('artifacts', { kind: 'quote', text: 'Ein Zitat aus zweiter Hand', page: '108', tags: [], sourceId: l.id });
    return { k: k.id, q: q.id };
  });
  await page.evaluate((id) => ((window as any).__structed.ui.editArtifact = { id }), ids.q);
  const m = page.locator('.modal');
  await expect(m.locator('.cprev')).toHaveText('(Lotz-Heumann, 2001, S. 108)');
  // the original work, at a column
  await m.getByRole('button', { name: /Secondary citation/ }).click();
  await m.locator('.orig .ss input').fill('Kaufmann');
  await m.locator('.orig .opt:not(.new)', { hasText: 'Kaufmann' }).dispatchEvent('pointerdown');
  await m.locator('.orig select').selectOption('column');
  await m.getByLabel('Location in the original', { exact: true }).fill('1121');
  await expect(m.locator('.cprev')).toHaveText('(Kaufmann, 1996, Spalte 1121, zit. nach Lotz-Heumann, 2001, S. 108)');
  // another style abbreviates the label
  await page.evaluate(() => ((window as any).__structed.settings.citationStyle = 'din-1505-2'));
  await expect(m.locator('.cprev')).toContainText('Sp. 1121');
  await expect(m.locator('.cprev')).toContainText('zit. nach');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  const a = await page.evaluate((id) => (window as any).__structed.db.get('artifacts', id), ids.q);
  expect(a.original).toEqual({ sourceId: ids.k, page: '1121', pageLabel: 'column' });

  // own words in the settings
  await page.evaluate(() => ((window as any).__structed.settings.secondaryText = 'zitiert nach'));
  await page.evaluate((id) => ((window as any).__structed.ui.editArtifact = { id }), ids.q);
  await expect(m.locator('.cprev')).toContainText('zitiert nach');
  // and back to a plain citation
  await m.getByRole('button', { name: 'Not a secondary citation' }).click();
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate((id) => (window as any).__structed.db.get('artifacts', id).original, ids.q)).toBeNull();
});
