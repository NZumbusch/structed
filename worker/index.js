// Structed auth helper – a tiny Cloudflare Worker that lets the browser app keep
// Google Drive sync connected without hourly popups.
//
// Browser-only apps can't hold a client secret, so Google never gives them
// long-lived refresh tokens. This Worker holds the secret and does exactly three
// things, nothing else:
//   POST /token   { code }           -> exchange a sign-in code for tokens
//   POST /refresh { refresh_token }  -> get a fresh 1-hour access token
//   POST /revoke  { token }          -> revoke access at Google
// It stores nothing, logs nothing, and never sees your projects or quotes –
// those go directly from the browser to Google Drive.
//
// Configuration (Cloudflare dashboard → Worker → Settings → Variables and Secrets):
//   GOOGLE_CLIENT_ID      (variable or secret)  your OAuth client ID
//   GOOGLE_CLIENT_SECRET  (secret)              your OAuth client secret
//   ALLOWED_ORIGINS       (variable)            comma-separated, e.g.
//                         "https://nzumbusch.github.io,http://localhost:5173"

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DEFAULT_ORIGINS = 'https://nzumbusch.github.io,http://localhost:5173';

/** @param {string | null} origin @param {Record<string,string>} env */
function allowedOrigin(origin, env) {
  if (!origin) return null;
  const list = (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

/** @param {string | null} origin */
function cors(origin) {
  /** @type {Record<string,string>} */
  const h = { 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

/** @param {unknown} body @param {number} status @param {string | null} origin */
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });
}

/** Forward a form request to Google and pass on only the fields the app needs. */
async function google(url, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const text = await r.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'bad_response' };
  }
  return { status: r.status, data };
}

/** Never return anything beyond what the app needs; never widen the scope. */
function tokenResponse(data) {
  const granted = String(data.scope || '').split(' ');
  if (data.scope && !granted.includes(SCOPE)) return { error: 'scope_mismatch' };
  const out = { access_token: data.access_token, expires_in: data.expires_in, token_type: data.token_type };
  if (data.refresh_token) out.refresh_token = data.refresh_token;
  return out;
}

export default {
  /** @param {Request} request @param {Record<string,string>} env */
  async fetch(request, env) {
    const origin = allowedOrigin(request.headers.get('Origin'), env);
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return new Response(null, { status: origin ? 204 : 403, headers: cors(origin) });
    if (path === '/' && request.method === 'GET') return json({ ok: true, service: 'structed-auth' }, 200, origin);
    if (!origin) return json({ error: 'origin_not_allowed' }, 403, null);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: 'worker_not_configured' }, 500, origin);

    /** @type {Record<string, unknown>} */
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400, origin);
    }
    const str = (k) => (typeof body[k] === 'string' && body[k].length < 4096 ? body[k] : '');
    const creds = { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET };

    if (path === '/token') {
      const code = str('code');
      if (!code) return json({ error: 'missing_code' }, 400, origin);
      // GIS popup code flow uses the special redirect_uri "postmessage".
      const r = await google(GOOGLE_TOKEN, { ...creds, code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
      if (r.status !== 200) return json({ error: r.data.error || 'exchange_failed' }, r.status === 400 ? 400 : 502, origin);
      const out = tokenResponse(r.data);
      return json(out, out.error ? 403 : 200, origin);
    }
    if (path === '/refresh') {
      const refresh_token = str('refresh_token');
      if (!refresh_token) return json({ error: 'missing_refresh_token' }, 400, origin);
      const r = await google(GOOGLE_TOKEN, { ...creds, refresh_token, grant_type: 'refresh_token' });
      // invalid_grant = revoked or expired: the app must ask the user to sign in again
      if (r.status !== 200) return json({ error: r.data.error || 'refresh_failed' }, r.status === 400 ? 401 : 502, origin);
      const out = tokenResponse(r.data);
      return json(out, out.error ? 403 : 200, origin);
    }
    if (path === '/revoke') {
      const token = str('token');
      if (!token) return json({ error: 'missing_token' }, 400, origin);
      await google(GOOGLE_REVOKE, { token });
      return json({ ok: true }, 200, origin);
    }
    return json({ error: 'not_found' }, 404, origin);
  }
};
