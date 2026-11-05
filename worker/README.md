# Structed auth server (Cloudflare Worker)

Keeps Google Drive sync signed in for months instead of one hour.

Browser-only apps can't keep a client secret, so Google gives them only one-hour access tokens. This ~100-line Worker holds the secret and swaps sign-in codes for a long-lived refresh token. It **never sees your content**: projects and quotes still go straight from the browser to Google Drive. It stores nothing.

It runs free on the Cloudflare Workers free plan (100,000 requests/day per account, shared by all your Workers). Structed needs about one request per hour per active device. It can live in the same Cloudflare account as your other projects as a separate Worker.

## 1. Get a client secret from Google

1. Open console.cloud.google.com, then **Google Auth Platform → Clients**, then your Structed web client.
2. Under **Client secrets**, copy the secret, or click **Add secret** to create one. Keep it private and never commit it.
3. Leave the **Authorized JavaScript origins** as they are (`https://nzumbusch.github.io`). No redirect URI is needed, because the popup flow uses Google's special `postmessage` redirect.

## 2. Deploy the Worker

### Option A: Cloudflare dashboard (no tools needed)

1. Go to dash.cloudflare.com, then **Workers & Pages → Create → Create Worker**.
2. Name it `structed-auth` and click **Deploy**. This creates a hello-world Worker.
3. Click **Edit code**, replace everything with the contents of [`index.js`](index.js), and click **Deploy**.
4. Go to **Settings → Variables and Secrets** and add:

   | Type | Name | Value |
   |---|---|---|
   | Secret | `GOOGLE_CLIENT_ID` | your client ID (`…apps.googleusercontent.com`) |
   | Secret | `GOOGLE_CLIENT_SECRET` | the secret from step 1 |
   | Text | `ALLOWED_ORIGINS` | `https://nzumbusch.github.io,http://localhost:5173` |

5. Note the Worker URL, e.g. `https://structed-auth.<your-subdomain>.workers.dev`. Opening it in a browser should show `{"ok":true,"service":"structed-auth"}`.

### Option B: wrangler (command line)

Run these from the repository root:

```bash
cd worker
```

```bash
npx wrangler login
```

```bash
npx wrangler deploy
```

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
```

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

`ALLOWED_ORIGINS` is set in [`wrangler.toml`](wrangler.toml).

## 3. Tell the app about it

Choose one:

- **For all devices (recommended):** on GitHub, go to the repository's **Settings → Secrets and variables → Actions → Variables** and add `AUTH_WORKER_URL` with the Worker URL. Then re-run the "CI & Deploy" workflow.
- **For one device:** in the app, go to **Settings → Sync → Auth server URL**.

Then go to **Settings → Sync → Reconnect** once. Settings now shows *"Stays signed in automatically"*.

## Good to know

- **Testing vs. published app:** while the Google app is in *Testing*, Google expires refresh tokens after **7 days**, so you'd reconnect weekly. After **Publish app** they last until revoked.
- **Fallback:** if the Worker is unreachable, sync reports an error and your data stays safe locally. Without a Worker URL the app uses browser-only mode, where it renews on your next click.
- **Revoking:** *Disconnect* in the app revokes the refresh token. You can also remove access at myaccount.google.com/connections.
- **Endpoints:** `POST /token {code}`, `POST /refresh {refresh_token}`, `POST /revoke {token}`. Only requests from `ALLOWED_ORIGINS` are accepted. Responses contain only the access token, its expiry and (on `/token`) the refresh token, and only for the `drive.appdata` scope.
- **Tests:** `tests/unit/worker.test.ts` (run with `npm run test:unit` in the repository root).
