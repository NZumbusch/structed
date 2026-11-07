import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { open, openPanel, seedDemo, stage } from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page, { settings: { language: 'en' } });
  await seedDemo(page);
  await stage(page, 'Write');
  await expect(page.locator('.compose .ProseMirror').first()).toBeVisible();
  if (page.viewportSize()!.width > 700) await openPanel(page);
});

test('write text with formatting; sections follow the outline', async ({ page }) => {
  await expect(page.locator('.compose .sec .ht')).toHaveCount(4);
  await expect(page.locator('.compose .sec .ht').first()).toContainText('Introduction');
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Plain ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+b');
  await page.keyboard.type(' text.');
  await expect(ed.locator('strong')).toHaveText('bold');
  await expect(page.locator('.bar .wc')).toContainText('3 words');
  // persisted
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('.compose .ProseMirror').first()).toContainText('Plain bold text.');
});

test('insert a linked quote from the panel; it updates when the library changes', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('As Assmann writes: ');
  await page.locator('.lib .gh').first().click().catch(() => {});
  const card = page.locator('.lib .art', { hasText: 'The past is not simply' });
  await card.getByRole('button', { name: 'Insert at cursor' }).click();
  const q = ed.locator('.qref');
  await expect(q).toContainText('„The past is not simply preserved but reconstructed.“');
  await expect(q.locator('em')).toHaveCount(1); // italic by default
  await expect(q).toContainText('(Assmann, 2011, p. 18)');
  // edit page and text in the library → editor updates live
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const a = db.all('artifacts').find((x: any) => x.text.startsWith('The past'));
    db.update('artifacts', a.id, { text: 'The past is reconstructed.', page: '19' });
  });
  await expect(q).toContainText('„The past is reconstructed.“');
  await expect(q).toContainText('p. 19');
  // block mode via the card menu (the card now shows the edited text)
  await page.locator('.lib .art', { hasText: 'The past is reconstructed.' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Insert as block quote' }).click();
  await expect(ed.locator('.qblock')).toContainText('The past is reconstructed.');
  await expect(ed.locator('.qblock .qb-cite')).toContainText('Assmann');
});

test('footnotes are free text: several citations, own words, formatting; numbered and editable', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('A sentence');
  await page.locator('.bar').getByRole('button', { name: /Footnote/ }).click();
  const dlg = page.locator('.modal');
  await expect(dlg.locator('h2')).toHaveText('Footnote');
  const fed = dlg.locator('.fed .ProseMirror');
  await expect(fed).toBeFocused();
  // "See" + citation only + "; also " (italic) + quote with citation
  await page.keyboard.type('See ');
  await dlg.getByLabel('Insert as').selectOption('cite');
  await dlg.getByRole('button', { name: /Insert citation/ }).click();
  await page.getByRole('option', { name: /The past is not simply/ }).click();
  await page.keyboard.type('; ');
  await page.keyboard.press('Control+i');
  await page.keyboard.type('also');
  await page.keyboard.press('Control+i');
  await page.keyboard.type(' ');
  await dlg.getByLabel('Insert as').selectOption('inline');
  await dlg.getByRole('button', { name: /Insert citation/ }).click();
  await page.getByRole('option', { name: /Memory is socially framed/ }).click();
  await expect(fed.locator('.qref')).toHaveCount(2);
  await expect(fed.locator('p > em')).toHaveText('also');
  await page.keyboard.press('Control+Enter'); // saves
  await expect(page.locator('.modal')).toHaveCount(0);
  const fn = ed.locator('sup.fn');
  await expect(fn).toHaveCount(1);
  expect(await fn.evaluate((e) => getComputedStyle(e, '::after').content)).toContain('counter(fn)'); // numbered via CSS counter
  await expect(fn).toHaveAttribute('title', /^See \(Assmann, 2011, p\. 18\); also „Memory is socially framed and mediated\.“ \(Assmann, 2011, pp\. 22–23\)$/);
  // reopen: everything is still there and editable
  await fn.click();
  await expect(fed.locator('.qref')).toHaveCount(2);
  await expect(fed).toContainText('See');
  await page.keyboard.press('Escape');
  // keyboard shortcut adds a second one, which can be deleted
  await ed.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Alt+f');
  await expect(page.locator('.modal h2')).toHaveText('Footnote');
  await page.locator('.modal').getByRole('button', { name: 'Delete footnote' }).click();
  await expect(fn).toHaveCount(1);
});

test('footnotes from before (text, one quote, text) open as free text', async ({ page }) => {
  await page.evaluate(() => {
    const { db, ui } = (window as any).__structed;
    const h = db.all('headings').filter((x: any) => x.projectId === ui.projectId).sort((a: any, b: any) => (a.order < b.order ? -1 : 1))[0];
    const q = db.all('artifacts').find((a: any) => a.text.startsWith('The past'));
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old.' }, { type: 'footnote', attrs: { before: 'Cf.', quoteId: q.id, quoteText: 'The past is […] reconstructed.', after: 'Emphasis mine.' } }] }] };
    db.update('headings', h.id, { draft: JSON.stringify(doc) });
  });
  const fn = page.locator('.compose .ProseMirror').first().locator('sup.fn');
  await expect(fn).toHaveAttribute('title', /^Cf\. „The past is \[…\] reconstructed\.“ \(Assmann, 2011, p\. 18\) Emphasis mine\.$/);
  await fn.click();
  const fed = page.locator('.modal .fed .ProseMirror');
  await expect(fed).toContainText('Cf. „The past is […] reconstructed.“');
  await expect(fed.locator('.qref.cite-only')).toHaveCount(1);
  await expect(fed).toContainText('Emphasis mine.');
  await page.locator('.modal').getByRole('button', { name: 'Save' }).click();
  await expect(fn).toHaveAttribute('title', /^Cf\. „The past is \[…\] reconstructed\.“ \(Assmann, 2011, p\. 18\) Emphasis mine\.$/);
});

test('Word export: title page fields, template, Zotero fields', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Intro text with a quote: ');
  await page.locator('.lib .gh').first().click();
  await page.locator('.lib .art', { hasText: 'The past is not simply' }).getByRole('button', { name: 'Insert at cursor' }).click();
  await page.locator('.bar').getByRole('button', { name: 'Word export' }).click();
  const m = page.locator('.modal');
  await m.getByLabel('Module / course').fill('im Seminar „Test“');
  await m.getByLabel('Author block').fill('vorgelegt von:\nMax Muster');
  const [dl] = await Promise.all([page.waitForEvent('download'), m.getByRole('button', { name: 'Create Word file' }).click()]);
  expect(dl.suggestedFilename()).toBe('Demo Memory & Media.docx');
  const zip = await JSZip.loadAsync(readFileSync((await dl.path())!));
  const doc = await zip.file('word/document.xml')!.async('string');
  expect(doc).toContain('im Seminar „Test“');
  expect(doc).toContain('Max Muster');
  expect(doc).toContain('Intro text with a quote:');
  expect(doc).toContain('ADDIN ZOTERO_ITEM CSL_CITATION');
  expect(doc).toContain('ADDIN ZOTERO_BIBL');
  expect(doc).toContain('TOC \\o');
  // cover fields are remembered for the next export
  await page.keyboard.press('Escape');
  await page.locator('.bar').getByRole('button', { name: 'Word export' }).click();
  await expect(page.locator('.modal').getByLabel('Module / course')).toHaveValue('im Seminar „Test“');
});

test('editable quotes: shorten with […], citation stays linked; convert a linked quote', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Assmann: ');
  await page.locator('.lib .gh').first().click();
  const card = page.locator('.lib .art', { hasText: 'The past is not simply' });
  await card.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Insert as editable text' }).click();
  // quote is now plain italic text, followed by a linked citation
  await expect(ed.locator('em')).toHaveText('The past is not simply preserved but reconstructed.');
  await expect(ed.locator('.qref.cite-only')).toHaveText('(Assmann, 2011, p. 18)');
  // shorten it: replace "not simply preserved but " with "[…] "
  await ed.locator('em').evaluate((el) => {
    const r = document.createRange();
    const tn = el.firstChild!;
    const s = tn.textContent!;
    r.setStart(tn, s.indexOf('not simply'));
    r.setEnd(tn, s.indexOf('reconstructed'));
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.waitForTimeout(150); // the editor picks up the selection
  await page.keyboard.type('[…] ');
  await expect(ed.locator('em')).toHaveText('The past is […] reconstructed.');
  // page change in the library still updates the citation
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const a = db.all('artifacts').find((x: any) => x.text.startsWith('The past'));
    db.update('artifacts', a.id, { page: '20' });
  });
  await expect(ed.locator('.qref.cite-only')).toHaveText('(Assmann, 2011, p. 20)');
  // the original in the library is untouched
  expect(await page.evaluate(() => (window as any).__structed.db.all('artifacts').some((x: any) => x.text === 'The past is not simply preserved but reconstructed.'))).toBe(true);

  // convert an already inserted linked quote via the toolbar
  await page.keyboard.press('End');
  await page.keyboard.type(' Again: ');
  await card.getByRole('button', { name: 'Insert at cursor' }).click();
  await ed.locator('.qref:not(.cite-only)').click();
  await page.locator('.bar').getByRole('button', { name: 'Edit quote text' }).click();
  await expect(ed.locator('.qref:not(.cite-only)')).toHaveCount(0);
  await expect(ed.locator('em')).toHaveCount(2);
  await expect(ed.locator('.qref.cite-only')).toHaveCount(2);

  // right-click a block quote → convert
  await card.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Insert as block quote' }).click();
  await ed.locator('.qblock').click({ button: 'right' });
  await page.locator('.cmenu').getByRole('menuitem', { name: 'Convert to editable text' }).click();
  await expect(ed.locator('.qblock')).toHaveCount(0);
  await expect(ed.locator('blockquote')).toContainText('The past is not simply');
  await expect(ed.locator('blockquote .qref.cite-only')).toHaveCount(1);
});

test('@layout no line of the text starts with a space', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  const txt = 'Erinnerung ist kein Archiv sondern ein Prozess und wer sich erinnert rekonstruiert die Vergangenheit aus der Gegenwart heraus, immer wieder neu und anders als gedacht. ';
  await page.keyboard.insertText(txt.repeat(5));
  const leading = () =>
    page.evaluate(() => {
      const root = document.querySelector('.compose .ProseMirror')!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const rng = document.createRange();
      let n: Node | null;
      let last: number | null = null;
      let bad = 0;
      while ((n = w.nextNode())) {
        const s = (n as Text).data;
        for (let i = 0; i < s.length; i++) {
          rng.setStart(n, i);
          rng.setEnd(n, i + 1);
          const r = rng.getClientRects()[0];
          if (!r) continue;
          if (last !== null && r.top > last + 5 && s[i] === ' ') bad++;
          last = r.top;
        }
      }
      return bad;
    });
  // several widths, so that lines break at many different places
  const vp = page.viewportSize()!;
  for (let d = 0; d < 120; d += 12) {
    await page.setViewportSize({ width: vp.width - d, height: vp.height });
    expect(await leading(), `width ${vp.width - d}`).toBe(0);
  }
});

test('" - " becomes an en dash once the next word is finished, like in Word', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('Erinnerung - so Assmann - ist ein Prozess. E-Mail, S. 12-14 und 3 - 4 ');
  await expect(ed).toHaveText('Erinnerung – so Assmann – ist ein Prozess. E-Mail, S. 12-14 und 3 – 4 ');
  // Backspace right after the change brings the hyphen back
  await page.keyboard.type('Nur - das');
  await page.keyboard.press(' ');
  await page.keyboard.press('Backspace');
  await expect(ed).toContainText('Nur - das');
  // can be switched off
  await page.evaluate(() => ((window as any).__structed.settings.editorAutoDash = false));
  await page.keyboard.type(' mit - Strich ');
  await expect(ed).toContainText('mit - Strich');
});

test('the quote in a footnote can be shortened; the citation stays linked', async ({ page }) => {
  const ed = page.locator('.compose .ProseMirror').first();
  await ed.click();
  await page.keyboard.type('A sentence');
  await page.locator('.bar').getByRole('button', { name: /Footnote/ }).click();
  const dlg = page.locator('.modal');
  const fed = dlg.locator('.fed .ProseMirror');
  await dlg.getByLabel('Insert as').selectOption('editable');
  await dlg.getByRole('button', { name: /Insert citation/ }).click();
  await page.getByRole('option', { name: /The past is not simply/ }).click();
  // the quote is plain text now: shorten it
  await expect(fed).toContainText('„The past is not simply preserved but reconstructed.“');
  await fed.locator('em').evaluate((el) => {
    const r = document.createRange();
    const tn = el.firstChild!;
    r.setStart(tn, 16);
    r.setEnd(tn, 37);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await page.keyboard.type('[…] ');
  await dlg.getByRole('button', { name: 'Save' }).click();
  const fn = ed.locator('sup.fn');
  await expect(fn).toHaveAttribute('title', /„The past is not \[…\] reconstructed\.“ \(Assmann, 2011, p\. 18\)/);
  // the page number still follows the library
  await page.evaluate(() => {
    const { db } = (window as any).__structed;
    const a = db.all('artifacts').find((x: any) => x.text.startsWith('The past'));
    db.update('artifacts', a.id, { page: '19' });
  });
  await expect(fn).toHaveAttribute('title', /\[…\] reconstructed\.“ \(Assmann, 2011, p\. 19\)/);
});
