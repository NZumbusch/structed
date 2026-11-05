import { expect, test } from '@playwright/test';
import { newProject, open, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page);
  await newProject(page);
  await stage(page, 'Collect');
});

async function addSource(page: import('@playwright/test').Page) {
  await page.getByTitle('New source').click();
  const m = page.locator('.modal');
  await m.getByLabel('Title').fill('Cultural Memory and Early Civilization');
  await m.getByLabel('Authors (one per line: Family, Given)').fill('Assmann, Jan');
  await m.getByLabel('Year').fill('2011');
  await m.getByLabel('Publisher').fill('Cambridge University Press');
  await expect(m.locator('.preview')).toContainText('Assmann, J. (2011). Cultural Memory and Early Civilization');
  await m.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.sh h2')).toHaveText('Cultural Memory and Early Civilization');
}

test('creates a source with live reference preview', async ({ page }) => {
  await addSource(page);
  await expect(page.locator('.src.on')).toContainText('Assmann 2011');
  await expect(page.locator('.ref')).toContainText('Cambridge University Press');
});

test('quick capture cleans OCR text and keeps page', async ({ page }) => {
  await addSource(page);
  await page.locator('.capture textarea').fill('The past is not simply pre-\nserved but recon- structed .');
  await page.locator('.capture input.page').fill('18');
  await page.locator('.capture input.page').press('Control+Enter');
  const card = page.locator('.items .art').first();
  await expect(card).toContainText('The past is not simply preserved but reconstructed.');
  await expect(card).toContainText('Assmann 2011, p. 18');
});

test('own notes keep their line breaks and markdown', async ({ page }) => {
  await page.locator('.src', { hasText: 'Own notes' }).click();
  await page.locator('.capture .seg button', { hasText: 'note' }).click();
  await page.locator('.capture textarea').fill('First idea\nSecond line\n\n- bullet');
  await page.locator('.capture').getByRole('button', { name: 'Add' }).click();
  const card = page.locator('.items .art').first();
  await card.locator('.toggle').click();
  await expect(card.locator('.md br')).toHaveCount(1);
  await expect(card.locator('.md li')).toHaveText('bullet');
});

test('item editor: edit fields, tags autocomplete, clean up, save & add another', async ({ page }) => {
  await addSource(page);
  await page.locator('.capture textarea').fill('First');
  await page.locator('.capture input.grow').fill('#memory, theory');
  await page.locator('.capture').getByRole('button', { name: 'Add' }).click();
  const card = page.locator('.items .art').first();
  await expect(card).toContainText('#memory');
  await card.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const m = page.locator('.modal');
  await m.getByLabel('Quote (verbatim)').fill('ﬁnal  text ,');
  await m.getByRole('button', { name: 'Clean up' }).click();
  await expect(m.getByLabel('Quote (verbatim)')).toHaveValue('final text,');
  // remove a tag, then get it back via autocomplete
  await m.locator('.tagin .chip', { hasText: 'memory' }).getByRole('button', { name: 'remove' }).click();
  await m.locator('.tagin input').fill('mem');
  await expect(m.locator('.sugg button')).toHaveText('#memory');
  await m.locator('.tagin input').press('Enter');
  await expect(m.locator('.tagin .chip')).toHaveCount(2);
  await m.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('final text,');
  // save & add another keeps the source
  await page.evaluate(() => ((window as any).__structed.ui.editArtifact = { kind: 'quote', sourceId: (window as any).__structed.ui.collectSourceId }));
  await expect(m.getByLabel('Source')).toHaveValue(/Assmann 2011/);
  await m.locator('textarea').first().fill('Second');
  await m.getByRole('button', { name: 'Save & add another' }).click();
  await m.locator('textarea').first().fill('Third');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.items .art')).toHaveCount(3);
});

test('bulk select: clean up, tag and delete with undo', async ({ page }) => {
  await addSource(page);
  for (const q of ['one  ,', 'two  ,', 'three']) {
    await page.locator('.capture textarea').fill(q);
    await page.locator('.capture').getByRole('button', { name: 'Add' }).click();
  }
  // capture already cleans; simulate dirty imported text
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    for (const a of db.all('artifacts')) db.update('artifacts', a.id, { text: a.text + '  ﬁ .' });
  });
  await page.locator('.bulk input[type=checkbox]').check();
  await expect(page.locator('.bulk')).toContainText('3 selected');
  await page.locator('.bulk').getByRole('button', { name: 'Bulk actions' }).click();
  await page.getByRole('menuitem', { name: 'Clean up text (OCR/PDF)' }).click();
  await expect(page.locator('.items .art').first()).toContainText('fi.');
  await page.locator('.bulk input[type=checkbox]').check();
  await page.locator('.bulk').getByRole('button', { name: 'Bulk actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete selected' }).click();
  await expect(page.locator('.items .art')).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.items .art')).toHaveCount(3);
});

test('imports BibTeX and RIS from pasted text, flags duplicates', async ({ page }) => {
  await page.getByTitle('Import from Zotero…').click();
  const m = page.locator('.modal');
  await m.locator('summary').click();
  await m.locator('textarea').fill(
    '@book{nora, author={Nora, Pierre}, title={Les lieux de mémoire}, publisher={Gallimard}, year={1984}}\n' +
      '@article{h, author={Halbwachs, Maurice}, title={On Collective Memory}, journal={X}, year={1992}}'
  );
  await m.getByRole('button', { name: 'Parse' }).click();
  await expect(m.locator('.it')).toHaveCount(2);
  await m.getByRole('button', { name: 'Import 2 sources' }).click();
  await expect(page.locator('.src', { hasText: 'Nora 1984' })).toBeVisible();
  // again: duplicates are detected and unchecked
  await page.getByTitle('Import from Zotero…').click();
  await m.locator('summary').click();
  await m.locator('textarea').fill('TY  - BOOK\nAU  - Nora, Pierre\nTI  - Les lieux de mémoire\nPY  - 1984\nER  - \n');
  await m.getByRole('button', { name: 'Parse' }).click();
  await expect(m.locator('.it')).toContainText('exists – will update');
  await expect(m.locator('.it input')).not.toBeChecked();
});

test('Zotero Web API: browses library, imports items and reviews highlights', async ({ page }) => {
  // Mock the Zotero API
  await page.route('https://api.zotero.org/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    const json = (body: unknown, total = Array.isArray(body) ? body.length : 1) =>
      route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', headers: { 'Total-Results': String(total) } });
    expect(route.request().headers()['zotero-api-key']).toBe('KEY');
    if (p === '/users/1/groups') return json([]);
    if (p === '/users/1/collections') return json([{ key: 'C1', data: { name: 'Thesis', parentCollection: false }, meta: { numItems: 1 } }]);
    if (p.endsWith('/items/top'))
      return json([
        {
          key: 'ITEM1',
          version: 1,
          data: { itemType: 'book', title: 'Les lieux de mémoire', tags: [{ tag: 'memory' }] },
          csljson: { id: '1/ITEM1', type: 'book', title: 'Les lieux de mémoire', author: [{ family: 'Nora', given: 'Pierre' }], issued: { 'date-parts': [[1984]] } },
          meta: { creatorSummary: 'Nora', parsedDate: '1984', numChildren: 1 }
        }
      ]);
    if (p === '/users/1/items/ITEM1/children')
      return json([
        { key: 'ATT1', data: { itemType: 'attachment', contentType: 'application/pdf', linkMode: 'imported_file' } },
        { key: 'LINK1', data: { itemType: 'attachment', contentType: 'text/html', linkMode: 'linked_url' } },
        { key: 'N1', data: { itemType: 'note', note: '<p>My <b>note</b></p>' } }
      ]);
    // exactly what the real Zotero API answers for links and other files
    if (p === '/users/1/items/LINK1/children') return route.fulfill({ status: 400, body: '/children can only be called on PDF, EPUB, and snapshot attachments' });
    if (p === '/users/1/items/ATT1/children')
      return json([
        { key: 'A1', data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'Lieux de mé-\nmoire are remains', annotationComment: 'key', annotationColor: '#ffd400', annotationPageLabel: '12', annotationSortIndex: '1', tags: [] } },
        { key: 'A2', data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'x', annotationComment: '', annotationColor: '#ff6666', annotationPageLabel: '13', annotationSortIndex: '2', tags: [] } },
        { key: 'A3', data: { itemType: 'annotation', annotationType: 'highlight', annotationText: 'Red long highlight text', annotationComment: '', annotationColor: '#ff6666', annotationPageLabel: '14', annotationSortIndex: '3', tags: [] } }
      ]);
    return route.fulfill({ status: 404, body: 'not mocked ' + p });
  });
  await page.evaluate(() => Object.assign((window as any).__structed.settings, { zoteroUserId: '1', zoteroApiKey: 'KEY' }));
  await page.getByTitle('Import from Zotero…').click();
  const m = page.locator('.modal');
  await expect(m.locator('.col', { hasText: 'Thesis' })).toBeVisible();
  await m.locator('.it', { hasText: 'Les lieux de mémoire' }).locator('input').check();
  await m.getByRole('button', { name: 'Import selected' }).click();
  await expect(m.locator('.ann')).toHaveCount(4); // 3 highlights + 1 item note
  // cleanup is applied in the preview
  await expect(m.locator('.ann').first()).toContainText('Lieux de mémoire are remains');
  // min length filters the tiny highlight
  await m.locator('input.mini').fill('3');
  await expect(m.locator('.ann')).toHaveCount(3);
  // color filter: only yellow
  await m.locator('.sw[title="yellow"]').click();
  await expect(m.locator('.ann')).toHaveCount(1);
  await m.getByRole('button', { name: /Import 1 items/ }).click();
  await expect(page.locator('.src', { hasText: 'Nora 1984' })).toBeVisible();
  await page.locator('.src', { hasText: 'Nora 1984' }).click();
  await expect(page.locator('.items .art')).toHaveCount(1);
  await expect(page.locator('.items .art')).toContainText('Nora 1984, p. 12');
  // re-import marks the highlight as already imported
  await page.getByRole('button', { name: 'Import Zotero highlights…' }).click();
  await expect(m.locator('.ann', { hasText: 'already imported' })).toHaveCount(1);
});

test('merge a placeholder source into the real one', async ({ page }) => {
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const ph = db.create('sources', { csl: { id: 'p', type: 'book', title: 'Dürr (placeholder)' }, tags: [] });
    db.create('sources', { csl: { id: 'r', type: 'book', title: 'Die Kantaten von Johann Sebastian Bach', author: [{ family: 'Dürr', given: 'Alfred' }], issued: { 'date-parts': [[1971]] } }, tags: [] });
    for (const p of ['796', '797']) db.create('artifacts', { kind: 'quote', text: 'Quote ' + p, tags: [], sourceId: ph.id, page: p });
  });
  await page.locator('.src', { hasText: 'placeholder' }).click();
  await page.locator('.sh').getByRole('button', { name: 'Edit' }).click();
  const m = page.locator('.modal');
  await m.getByRole('button', { name: 'Merge into another source…' }).click();
  await m.getByLabel('Target source').selectOption({ label: 'Dürr 1971 — Die Kantaten von Johann Sebastian Bach' });
  await m.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(page.locator('.toast', { hasText: '2 items moved to “Dürr 1971”' })).toBeVisible();
  await expect(page.locator('.sh h2')).toHaveText('Die Kantaten von Johann Sebastian Bach');
  await expect(page.locator('.items .art')).toHaveCount(2);
  await expect(page.locator('.items .art').first()).toContainText('Dürr 1971, p. 796');
  await expect(page.locator('.src', { hasText: 'placeholder' })).toHaveCount(0);
});


test('Zotero: "Import all" loads every page; highlights are fetched library-wide; bad attachments are skipped', async ({ page }) => {
  const N = 223;
  const requests: string[] = [];
  await page.route('https://api.zotero.org/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname;
    requests.push(p + u.search);
    const start = Number(u.searchParams.get('start') ?? 0);
    const page100 = <T,>(arr: T[]) =>
      route.fulfill({ body: JSON.stringify(arr.slice(start, start + 100)), contentType: 'application/json', headers: { 'Total-Results': String(arr.length), 'Access-Control-Expose-Headers': 'Total-Results, Backoff, Retry-After' } });
    if (p.endsWith('/children')) return route.fulfill({ status: 400, body: '/children can only be called on PDF, EPUB, and snapshot attachments' });
    if (p === '/users/1/groups' || p === '/users/1/collections') return page100([]);
    if (p === '/users/1/items/top') {
      const books = Array.from({ length: N }, (_, i) => ({
        key: 'I' + i,
        version: 1,
        data: { itemType: 'book', title: 'Book ' + i, tags: [] },
        csljson: { id: '1/I' + i, type: 'book', title: 'Book ' + i, author: [{ family: 'Author' + i }], issued: { 'date-parts': [[1900 + (i % 100)]] } },
        meta: { creatorSummary: 'Author' + i, parsedDate: '19' + String(i % 100).padStart(2, '0'), numChildren: 1 }
      }));
      // real libraries also contain standalone PDFs and notes at the top level (hidden in the list)
      const items: unknown[] = [];
      books.forEach((b, i) => {
        items.push(b);
        if (i % 20 === 0) items.push({ key: 'S' + i, version: 1, data: { itemType: 'attachment', title: 'loose.pdf' }, csljson: {}, meta: {} });
      });
      return page100(items);
    }
    if (p === '/users/1/items' && u.searchParams.get('itemType') === 'attachment')
      return page100([
        { key: 'PDF7', data: { itemType: 'attachment', parentItem: 'I7', contentType: 'application/pdf', linkMode: 'imported_file' } },
        { key: 'URL7', data: { itemType: 'attachment', parentItem: 'I7', contentType: 'text/html', linkMode: 'linked_url' } },
        { key: 'PDF200', data: { itemType: 'attachment', parentItem: 'I200', contentType: 'application/pdf', linkMode: 'imported_url' } }
      ]);
    if (p === '/users/1/items' && u.searchParams.get('itemType') === 'annotation')
      return page100([
        { key: 'A1', data: { itemType: 'annotation', parentItem: 'PDF7', annotationType: 'highlight', annotationText: 'Highlight in book seven', annotationPageLabel: '7', annotationSortIndex: '1', annotationColor: '#ffd400', tags: [] } },
        { key: 'A2', data: { itemType: 'annotation', parentItem: 'PDF200', annotationType: 'highlight', annotationText: 'Highlight in book two hundred', annotationPageLabel: '12', annotationSortIndex: '1', annotationColor: '#ffd400', tags: [] } },
        { key: 'A3', data: { itemType: 'annotation', parentItem: 'OTHER', annotationType: 'highlight', annotationText: 'not imported', annotationSortIndex: '1', tags: [] } }
      ]);
    if (p === '/users/1/items' && u.searchParams.get('itemType') === 'note')
      return page100([{ key: 'N9', data: { itemType: 'note', parentItem: 'I9', note: '<p>Reading note</p>' } }]);
    return route.fulfill({ status: 404, body: 'unmocked ' + p });
  });
  await page.evaluate(() => Object.assign((window as any).__structed.settings, { zoteroUserId: '1', zoteroApiKey: 'KEY' }));
  await page.getByTitle('Import from Zotero…').click();
  const m = page.locator('.modal');
  await expect(m.locator('.it')).toHaveCount(95); // 5 standalone attachments on page 1 are hidden
  await m.getByRole('button', { name: /Import all \(\d+\)/ }).click();
  await expect(m.locator('.ann')).toHaveCount(3, { timeout: 15_000 });
  await expect(m.locator('.err')).toHaveCount(0);
  await expect(m.locator('.ann', { hasText: 'book seven' })).toContainText('Author7');
  // no per-item /children calls for a large import
  expect(requests.filter((r) => r.includes('/children'))).toEqual([]);
  await m.getByRole('button', { name: /Import 3 items/ }).click();
  expect(await page.evaluate(() => (window as any).__structed.db.all('sources').length)).toBe(N);
  expect(await page.evaluate(() => (window as any).__structed.db.all('artifacts').length)).toBe(3);
});
