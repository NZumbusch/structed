import { expect, test, type Page } from '@playwright/test';
import { noHorizontalOverflow, open, seedDemo, stage } from './helpers';

const DAMAGED =
  'Kennzeichnend f?r die Periode zwischen 1670 und 1750 war in den unter deutschem Einflu? stehenden evangelischen Kirchen der Kampf zwischen der Orthodoxie und der neuen Bewegung. Die Komponisten hatten daher biblische Texte und Chor?le bearbei tet, die abwechslungsreiche Gef?hle ausdr?ckten und sogar weltliche For men verwendeten.';

/** A fake Zotero with one German book whose PDF lost its umlauts. */
async function fakeZotero(page: Page) {
  await page.route('https://api.zotero.org/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body: unknown[]) => route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: { 'Total-Results': String(body.length) } });
    if (p === '/users/1/items/S/children') return json([{ key: 'PDFS', data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file' } }]);
    if (p === '/users/1/items/PDFS/children')
      return json([{ key: 'S1', data: { itemType: 'annotation', parentItem: 'PDFS', annotationType: 'highlight', annotationText: DAMAGED, annotationComment: '', annotationColor: '#ffd400', annotationPageLabel: '343', annotationSortIndex: '1', tags: [] } }]);
    return route.fulfill({ status: 404, body: 'not mocked ' + p });
  });
  await page.evaluate(() => {
    const { db, settings } = (window as any).__structed;
    Object.assign(settings, { zoteroUserId: '1', zoteroApiKey: 'KEY', repairLearned: {} });
    db.create('sources', {
      csl: { id: 'S', type: 'book', title: 'Das Musikleben der evangelischen Kirchen und Bethäuser in Ungarn im 18. Jahrhundert und seine Beziehungen zu Mitteldeutschland', author: [{ family: 'Sas' }], issued: { 'date-parts': [[2003]] } },
      tags: [],
      zoteroKey: 'S',
      zoteroLibrary: 'users/1'
    });
  });
}

test('going through highlights: repairs shown in colour, chosen, taken; nothing cut off', async ({ page }) => {
  await open(page, { settings: { language: 'en', fontSize: 19 } });
  await seedDemo(page);
  await fakeZotero(page);
  await stage(page, 'Collect');
  await page.locator('.src', { hasText: 'Sas 2003' }).click();
  await page.getByRole('button', { name: 'Go through highlights…' }).click();
  const dlg = page.locator('.modal');
  // sure repairs are suggested (dotted), not applied yet; "For men" is to check
  const fx = dlg.locator('.fx');
  await expect(dlg.locator('.fx.sure')).toHaveCount(6);
  await expect(dlg.locator('.fx.check')).toHaveText(['For men']);
  await expect(dlg.locator('.fx.on')).toHaveCount(0);
  // the dialog's content fits into it: nothing wider than the dialog
  const over = await dlg.evaluate((m) => [...m.querySelectorAll('*')].filter((el) => !el.parentElement?.closest('.ellipsis') && el.getBoundingClientRect().right > m.getBoundingClientRect().right + 1).map((el) => el.tagName + '.' + el.className + ':' + Math.round(el.getBoundingClientRect().right - m.getBoundingClientRect().right)));
  expect(over).toEqual([]);
  await noHorizontalOverflow(page);
  // A applies the sure ones (green, the old word on hover)
  await page.keyboard.press('a');
  await expect(dlg.locator('.fx.on.sure')).toHaveCount(6);
  await expect(dlg.locator('.fx.on.sure').first()).toHaveText('für');
  await expect(dlg.locator('.fx.on.sure').first()).toHaveAttribute('title', /was: f\?r/);
  // the one to check: choose from its menu
  await dlg.locator('.fx.check').click();
  await page.locator('.cmenu').getByRole('menuitem', { name: /Formen/ }).click();
  await expect(dlg.locator('.fx.on.check')).toHaveText('Formen');
  await expect(fx).toHaveCount(7);
  await page.keyboard.press('Enter'); // take
  const text = await page.evaluate(() => (window as any).__structed.db.all('artifacts').find((a: any) => a.zoteroKey === 'S1').text);
  expect(text).toContain('Kennzeichnend für die Periode');
  expect(text).toContain('Einfluß stehenden');
  expect(text).toContain('Choräle bearbeitet, die abwechslungsreiche Gefühle ausdrückten und sogar weltliche Formen verwendeten.');
});

test('editing by hand is remembered; quotes already imported can be repaired', async ({ page }) => {
  await open(page, { settings: { language: 'en' } });
  await seedDemo(page);
  await fakeZotero(page);
  await page.evaluate((t) => {
    const { db } = (window as any).__structed;
    const s = db.all('sources').find((x: any) => x.zoteroKey === 'S');
    db.create('artifacts', { kind: 'quote', sourceId: s.id, text: 'Die Gemeinde in Pre?burg sang f?r sich.', page: '12', tags: [] });
    db.create('artifacts', { kind: 'quote', sourceId: s.id, text: t, page: '343', tags: [] });
  }, DAMAGED);
  await stage(page, 'Collect');
  await page.locator('.src', { hasText: 'Sas 2003' }).click();
  await page.getByRole('button', { name: 'Repair 2 quotes' }).click();
  const dlg = page.locator('.modal');
  // "Pre?burg" (a place name) is in no word list: not repaired, in red
  await expect(dlg.locator('.fx.unsolved')).toHaveText('Pre?burg');
  // apply the sure one ("f?r") and save
  await page.keyboard.press('a');
  await page.keyboard.press('Enter');
  await expect(dlg.locator('.fx.sure').first()).toHaveText('f?r');
  await dlg.getByRole('button', { name: /Apply all sure repairs to the remaining 1/ }).click();
  await expect(dlg).toContainText('Done: 2 quotes repaired.');
  const texts = await page.evaluate(() => (window as any).__structed.db.all('artifacts').filter((a: any) => a.page === '12' || a.page === '343').map((a: any) => a.text).sort());
  expect(texts[0]).toBe('Die Gemeinde in Pre?burg sang für sich.');
  expect(texts[1]).toContain('Choräle bearbeitet'); // sure ones only: "For men" stays for checking
  expect(texts[1]).toContain('weltliche For men');
});
