import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { headingTitles, open } from './helpers';

/** In-memory fake of the Drive v3 appDataFolder API + Google Identity Services. */
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; version: number; body: Buffer }>();
  let n = 0;
  const gis = `window.google={accounts:{oauth2:{initTokenClient:(o)=>({requestAccessToken:()=>setTimeout(()=>o.callback({access_token:'tok',expires_in:3600}),5)}),revoke:()=>{}}}};`;
  async function attach(ctx: BrowserContext) {
    await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ body: gis, contentType: 'text/javascript' }));
    await ctx.route('https://www.googleapis.com/**', async (r) => {
      const req = r.request();
      const u = new URL(req.url());
      const m = req.method();
      expect(req.headers()['authorization']).toBe('Bearer tok');
      const json = (o: unknown) => r.fulfill({ body: JSON.stringify(o), contentType: 'application/json' });
      if (u.pathname.endsWith('/about')) return json({ user: { emailAddress: 'me@example.com' } });
      if (u.pathname === '/drive/v3/files' && m === 'GET') {
        expect(u.searchParams.get('spaces')).toBe('appDataFolder');
        return json({ files: [...files.values()].map((f) => ({ id: f.id, name: f.name, version: String(f.version) })) });
      }
      let mm = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
      if (mm && m === 'GET') return r.fulfill({ body: files.get(mm[1])!.body });
      if (mm && m === 'DELETE') {
        files.delete(mm[1]);
        return r.fulfill({ status: 204 });
      }
      if (u.pathname === '/upload/drive/v3/files' && m === 'POST') {
        const txt = req.postDataBuffer()!.toString('latin1');
        expect(txt).toContain('"parents":["appDataFolder"]');
        const name = txt.match(/"name":"([^"]+)"/)![1];
        const boundary = txt.split('\r\n')[0];
        const part = txt.split(boundary)[2];
        const body = Buffer.from(part.slice(part.indexOf('\r\n\r\n') + 4, -2), 'latin1');
        const id = 'f' + ++n;
        files.set(id, { id, name, version: 1, body });
        return json({ id, name, version: '1' });
      }
      mm = u.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
      if (mm && m === 'PATCH') {
        const f = files.get(mm[1])!;
        f.body = req.postDataBuffer()!;
        f.version++;
        return json({ id: f.id, name: f.name, version: String(f.version) });
      }
      return r.fulfill({ status: 404, body: 'unmocked' });
    });
  }
  return { files, attach };
}

async function device(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  await open(p, { settings: { googleClientId: 'test.apps.googleusercontent.com', autoSync: false } });
  return p;
}
async function connect(p: Page) {
  await p.getByTitle('Settings').click();
  await p.locator('.modal nav button', { hasText: 'Sync' }).click();
  await p.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(p.locator('.modal')).toContainText('me@example.com');
  await expect(p.locator('.modal')).toContainText('Last sync');
  await p.keyboard.press('Escape');
}
const syncNow = async (p: Page) => {
  await p.locator('[data-tour="sync"]').click();
  await expect(p.locator('[data-tour="sync"]')).toHaveAttribute('title', /^Synced/);
  await p.waitForTimeout(150);
};

test('two devices merge offline work and concurrent edits', async ({ browser }) => {
  const drive = fakeDrive();
  const A = await browser.newContext();
  const B = await browser.newContext();
  await drive.attach(A);
  await drive.attach(B);
  const a = await device(A);
  const b = await device(B);

  await a.getByPlaceholder('Working title').fill('Shared thesis');
  await a.getByRole('button', { name: 'Create' }).click();
  await connect(a);
  expect([...drive.files.values()].map((f) => f.name)).toEqual(['structed-data.json']);

  // B worked offline on its own project, then connects
  await b.getByPlaceholder('Working title').fill('B notes');
  await b.getByRole('button', { name: 'Create' }).click();
  await connect(b);
  await syncNow(a);
  for (const p of [a, b]) {
    const names = await p.evaluate(() => (window as any).__structed.db.all('projects').map((x: any) => x.title).sort());
    expect(names).toEqual(['B notes', 'Shared thesis']);
  }

  // concurrent edits to different headings of the same project
  const shared = await a.evaluate(() => (window as any).__structed.db.all('projects').find((x: any) => x.title === 'Shared thesis').id);
  await b.evaluate((id) => ((window as any).__structed.ui.projectId = id), shared);
  await a.evaluate((id) => ((window as any).__structed.ui.projectId = id), shared);
  await a.locator('input.title').nth(0).fill('Intro (A)');
  await b.locator('input.title').nth(1).fill('Research (B)');
  await a.waitForTimeout(500);
  await b.waitForTimeout(500);
  await syncNow(a);
  await syncNow(b);
  await syncNow(a);
  expect((await headingTitles(a)).slice(0, 2)).toEqual(['Intro (A)', 'Research (B)']);
  expect((await headingTitles(b)).slice(0, 2)).toEqual(['Intro (A)', 'Research (B)']);

  // deletion propagates
  await b.locator('.hrow').first().getByRole('button', { name: 'More' }).click();
  await b.getByRole('menuitem', { name: 'Delete heading' }).click();
  await b.waitForTimeout(500);
  await syncNow(b);
  await syncNow(a);
  expect((await headingTitles(a))[0]).toBe('Research (B)');
  await A.close();
  await B.close();
});

test('images sync as separate files', async ({ browser }) => {
  const drive = fakeDrive();
  const A = await browser.newContext();
  const B = await browser.newContext();
  await drive.attach(A);
  await drive.attach(B);
  const a = await device(A);
  await a.evaluate(async () => {
    const s = (window as any).__structed;
    const png = await (await fetch('icon-192.png')).blob();
    const id = await s.db.putBlob(png);
    s.db.create('artifacts', { kind: 'image', text: 'Figure 1', tags: [], imageId: id });
  });
  await connect(a);
  expect([...drive.files.values()].some((f) => f.name.startsWith('blob-'))).toBe(true);
  const b = await device(B);
  await connect(b);
  const ok = await b.evaluate(async () => {
    const s = (window as any).__structed;
    const art = s.db.all('artifacts')[0];
    return art && (await s.db.hasBlob(art.imageId));
  });
  expect(ok).toBe(true);
  await A.close();
  await B.close();
});

test('expired session asks to reconnect; data stays local', async ({ page, context }) => {
  const drive = fakeDrive();
  await drive.attach(context);
  await open(page, { settings: { googleClientId: 'x', autoSync: false } });
  await connect(page);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('structed.drive')!);
    d.expires = Date.now() - 1000;
    localStorage.setItem('structed.drive', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForFunction(() => (window as any).__structed?.db?.ready);
  await expect(page.locator('[data-tour="sync"]')).toHaveAttribute('title', /expired/);
  await page.locator('[data-tour="sync"]').click();
  await expect(page.locator('[data-tour="sync"]')).toHaveAttribute('title', /^Synced/);
});

test('without client ID, sync explains what to do', async ({ page }) => {
  await open(page);
  await page.locator('[data-tour="sync"]').click();
  await expect(page.locator('.modal')).toContainText('How to create a free Client ID');
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(page.locator('.modal .err')).toContainText('No Google OAuth Client ID');
});
