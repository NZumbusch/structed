import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { headingTitles, open } from './helpers';

/** In-memory fake of the Drive v3 appDataFolder API + Google Identity Services. */
function fakeDrive() {
  const files = new Map<string, { id: string; name: string; version: number; body: Buffer }>();
  let n = 0;
  // Fake Google Identity Services; records every popup request in window.__gis.
  const gis = `window.__gis=[];window.google={accounts:{oauth2:{
    initTokenClient:(o)=>({requestAccessToken:(c)=>{window.__gis.push({kind:'token',prompt:c&&c.prompt});setTimeout(()=>window.__gisFail?(o.error_callback&&o.error_callback({type:'popup_closed'})):o.callback({access_token:'tok',expires_in:3600}),5)}}),
    initCodeClient:(o)=>({requestCode:()=>{window.__gis.push({kind:'code'});setTimeout(()=>o.callback({code:'CODE'}),5)}}),
    revoke:()=>{}}}};`;
  async function attach(ctx: BrowserContext) {
    await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ body: gis, contentType: 'text/javascript' }));
    await ctx.route('https://www.googleapis.com/**', async (r) => {
      const req = r.request();
      const u = new URL(req.url());
      const m = req.method();
      expect(req.headers()['authorization']).toMatch(/^Bearer tok/);
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
  await expect(p.locator('.modal .status strong')).toHaveText('Connected'); // updates without reopening
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
  await a.locator('textarea.title').nth(0).fill('Intro (A)');
  await b.locator('textarea.title').nth(1).fill('Research (B)');
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
  await expect(page.locator('[data-tour="sync"]')).toHaveAttribute('title', /Sync paused/);
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

// ---------------- staying signed in ----------------

/** Fake auth Worker (Cloudflare) */
async function fakeWorker(ctx: BrowserContext, opts: { refreshToken?: string | null; refreshFails?: boolean } = {}) {
  const calls: string[] = [];
  let n = 0;
  await ctx.route('https://auth.test/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    const body = r.request().postDataJSON();
    calls.push(path);
    const json = (o: unknown, status = 200) => r.fulfill({ status, body: JSON.stringify(o), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
    if (path === '/token') {
      expect(body.code).toBe('CODE');
      return json({ access_token: 'tok-' + ++n, expires_in: 3599, ...(opts.refreshToken === null ? {} : { refresh_token: opts.refreshToken ?? 'RT' }) });
    }
    if (path === '/refresh') {
      if (opts.refreshFails) return json({ error: 'invalid_grant' }, 401);
      expect(body.refresh_token).toBe('RT');
      return json({ access_token: 'tok-' + ++n, expires_in: 3599 });
    }
    if (path === '/revoke') return json({ ok: true });
    return json({ error: 'not_found' }, 404);
  });
  return calls;
}

const expireToken = (p: Page) =>
  p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('structed.drive')!);
    d.expires = Date.now() - 1000;
    localStorage.setItem('structed.drive', JSON.stringify(d));
  });
const reload = async (p: Page) => {
  await p.reload();
  await p.waitForFunction(() => (window as any).__structed?.db?.ready);
};
const popups = (p: Page) => p.evaluate(() => ((window as any).__gis?.length ?? 0) as number);

test('auth server: connects with code flow and refreshes silently without popups', async ({ page, context }) => {
  const drive = fakeDrive();
  await drive.attach(context);
  const calls = await fakeWorker(context);
  await open(page, { settings: { googleClientId: 'x', authWorkerUrl: 'https://auth.test', autoSync: false } });
  await connect(page);
  expect(calls).toEqual(['/token']);
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'Sync' }).click();
  await expect(page.locator('.modal')).toContainText('Stays signed in automatically');
  await page.keyboard.press('Escape');

  // an hour later: token expired, but no popup is needed
  await expireToken(page);
  await reload(page);
  await page.evaluate(() => (window as any).__structed.db.create('tags', { name: 'edit after an hour' }));
  await page.locator('[data-tour="sync"]').click();
  await expect(page.locator('[data-tour="sync"]')).toHaveAttribute('title', /^Synced/);
  expect(calls).toContain('/refresh');
  expect(await popups(page)).toBe(0);
});

test('auth server: revoked access asks to reconnect', async ({ page, context }) => {
  const drive = fakeDrive();
  await drive.attach(context);
  await fakeWorker(context, { refreshFails: true });
  await open(page, { settings: { googleClientId: 'x', authWorkerUrl: 'https://auth.test', autoSync: false } });
  await connect(page);
  await expireToken(page);
  await reload(page);
  await expect(page.locator('[data-tour="sync"]')).toHaveAttribute('title', /expired/);
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'Sync' }).click();
  await expect(page.locator('.modal .err')).toContainText('expired or was revoked');
});

test('auth server: missing refresh token asks for one more reconnect', async ({ page, context }) => {
  const drive = fakeDrive();
  await drive.attach(context);
  const calls = await fakeWorker(context, { refreshToken: null });
  await open(page, { settings: { googleClientId: 'x', authWorkerUrl: 'https://auth.test', autoSync: false } });
  await page.getByTitle('Settings').click();
  await page.locator('.modal nav button', { hasText: 'Sync' }).click();
  await page.getByRole('button', { name: 'Connect Google Drive' }).click();
  await expect(page.locator('.modal .notice')).toContainText('once more');
  await expect(page.locator('.modal').getByRole('button', { name: 'Reconnect' })).toBeVisible();
  expect(calls).toEqual(['/token', '/revoke']);
});

test('browser only: after expiry, the next click renews automatically', async ({ page, context }) => {
  const drive = fakeDrive();
  await drive.attach(context);
  await open(page, { settings: { googleClientId: 'x', autoSync: false } });
  await page.getByPlaceholder('Working title').fill('P');
  await page.getByRole('button', { name: 'Create' }).click();
  await connect(page);
  await expireToken(page);
  await reload(page);
  const before = await popups(page);
  const btn = page.locator('[data-tour="sync"]');
  await expect(btn).toHaveAttribute('title', /resumes automatically on your next click/);
  await expect(btn).toHaveClass(/waiting/);
  // the user simply keeps working: clicking a heading renews the session
  await page.locator('textarea.title').first().click();
  await expect(btn).toHaveAttribute('title', /^Synced/);
  const reqs = await page.evaluate(() => (window as any).__gis ?? []);
  expect(reqs.slice(before)).toEqual([{ kind: 'token', prompt: '' }]);
  // typing does not trigger popups
  await page.keyboard.type('abc');
  expect(await popups(page)).toBe(before + 1);
});

test('browser only: auto-renew can be turned off, and a blocked popup is not retried', async ({ page, context }) => {
  const drive = fakeDrive();
  await drive.attach(context);
  await open(page, { settings: { googleClientId: 'x', autoSync: false } });
  await page.getByPlaceholder('Working title').fill('P');
  await page.getByRole('button', { name: 'Create' }).click();
  await connect(page);
  await expireToken(page);
  await reload(page);
  await page.evaluate(() => ((window as any).__gisFail = true));
  const n0 = await popups(page);
  await page.locator('textarea.title').first().click();
  await expect.poll(() => popups(page)).toBe(n0 + 1);
  await expect(page.locator('[data-tour="sync"]')).toHaveAttribute('title', /click to reconnect/);
  await page.locator('textarea.title').nth(1).click();
  await page.waitForTimeout(200);
  expect(await popups(page)).toBe(n0 + 1); // not retried on every click

  await page.evaluate(() => (Object.assign((window as any).__structed.settings, { autoRenew: false }), ((window as any).__gisFail = false)));
  await reload(page);
  await page.locator('textarea.title').first().click();
  await page.waitForTimeout(200);
  expect(await popups(page)).toBe(0);
  await page.locator('[data-tour="sync"]').click(); // explicit reconnect still works
  await expect(page.locator('[data-tour="sync"]')).toHaveAttribute('title', /^Synced/);
});
