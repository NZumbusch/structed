// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS worker
import worker from '../../worker/index.js';

const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', ALLOWED_ORIGINS: 'https://app.test' };
const req = (path: string, body?: unknown, origin = 'https://app.test', method = 'POST') =>
  new Request('https://w.test' + path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

function mockGoogle(status: number, data: unknown) {
  const calls: { url: string; body: URLSearchParams }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: new URLSearchParams(init.body as string) });
    return new Response(JSON.stringify(data), { status });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

describe('auth worker', () => {
  it('rejects unknown origins', async () => {
    const r = await worker.fetch(req('/refresh', { refresh_token: 'x' }, 'https://evil.test'), env);
    expect(r.status).toBe(403);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('answers CORS preflight for allowed origins only', async () => {
    const ok = await worker.fetch(req('/token', undefined, 'https://app.test', 'OPTIONS'), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test');
    const bad = await worker.fetch(req('/token', undefined, 'https://evil.test', 'OPTIONS'), env);
    expect(bad.status).toBe(403);
  });
  it('exchanges a code using the secret and postmessage redirect', async () => {
    const calls = mockGoogle(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: SCOPE, token_type: 'Bearer', id_token: 'should-not-leak' });
    const r = await worker.fetch(req('/token', { code: 'c0de' }), env);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, token_type: 'Bearer' });
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(calls[0].body)).toEqual({ client_id: 'cid', client_secret: 'secret', code: 'c0de', grant_type: 'authorization_code', redirect_uri: 'postmessage' });
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });
  it('refreshes an access token', async () => {
    const calls = mockGoogle(200, { access_token: 'at2', expires_in: 3599, scope: SCOPE });
    const r = await worker.fetch(req('/refresh', { refresh_token: 'rt' }), env);
    expect(await r.json()).toMatchObject({ access_token: 'at2', expires_in: 3599 });
    expect(calls[0].body.get('grant_type')).toBe('refresh_token');
  });
  it('maps a revoked refresh token to 401 invalid_grant', async () => {
    mockGoogle(400, { error: 'invalid_grant' });
    const r = await worker.fetch(req('/refresh', { refresh_token: 'old' }), env);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'invalid_grant' });
  });
  it('refuses tokens with an unexpected scope', async () => {
    mockGoogle(200, { access_token: 'at', expires_in: 1, scope: 'https://www.googleapis.com/auth/drive' });
    const r = await worker.fetch(req('/refresh', { refresh_token: 'rt' }), env);
    expect(r.status).toBe(403);
  });
  it('validates input and configuration', async () => {
    expect((await worker.fetch(req('/token', {}), env)).status).toBe(400);
    expect((await worker.fetch(new Request('https://w.test/token', { method: 'POST', headers: { Origin: 'https://app.test' }, body: 'nope' }), env)).status).toBe(400);
    expect((await worker.fetch(req('/token', { code: 'x' }), { ALLOWED_ORIGINS: 'https://app.test' })).status).toBe(500);
    expect((await worker.fetch(req('/nope', {}), env)).status).toBe(404);
    expect((await worker.fetch(req('/token', undefined, 'https://app.test', 'GET'), env)).status).toBe(405);
  });
  it('revokes at Google', async () => {
    const calls = mockGoogle(200, {});
    const r = await worker.fetch(req('/revoke', { token: 'rt' }), env);
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/revoke');
  });
  it('health check', async () => {
    const r = await worker.fetch(new Request('https://w.test/'), env);
    expect(await r.json()).toEqual({ ok: true, service: 'structed-auth' });
  });
});
