// Google Drive sync via the hidden appDataFolder (scope drive.appdata).
//
// Two ways to stay signed in:
//  • Auth server (optional Cloudflare Worker, see /worker): Google sign-in *code* flow.
//    The Worker exchanges the code for a long-lived refresh token, and the app silently
//    refreshes the 1-hour access token before it expires. No popups for months.
//  • Browser only (default): Google *token* flow. Tokens last ~1 hour. The app syncs
//    right before expiry and renews automatically on the user's next click (a Google
//    popup flashes and closes by itself) – browsers only allow popups after a gesture.
import { db } from './db.svelte';
import { clientId, settings, workerUrl } from './settings.svelte';
import { isDragging } from './dnd';
import { askRemoveDemo, hasDemo } from './demo';
import { t } from './i18n';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const MAIN = 'structed-data.json';
const LS = 'structed.drive';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  version?: string;
  size?: string;
}

interface Persisted {
  connected: boolean;
  email?: string;
  token?: string;
  expires?: number;
  lastSync?: number;
  lastVersion?: string;
  pending?: boolean; // local edits not yet uploaded
  refresh?: string; // refresh token (auth-server mode only)
}

/** Sync / renew this long before the access token expires. */
export const EARLY_MS = 4 * 60_000;

/** When to act relative to token expiry. Exported for tests. */
export function renewPlan(now: number, expires: number, hasRefresh: boolean) {
  const at = Math.max(now, expires - EARLY_MS);
  return hasRefresh ? { refreshAt: at, preSyncAt: null, gestureFrom: null } : { refreshAt: null, preSyncAt: at, gestureFrom: at };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const google: any;

function loadGis(): Promise<void> {
  if (typeof google !== 'undefined' && google.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Could not load Google sign-in (offline or blocked).'));
    document.head.appendChild(s);
  });
}

class Sync {
  status: 'off' | 'idle' | 'syncing' | 'error' | 'auth' | 'offline' = $state('off');
  error = $state('');
  lastSync: number | null = $state(null);
  email = $state('');
  private p: Persisted;
  private busy = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private gestureArmed = false;
  private gestureFailed = false;
  private refreshing: Promise<boolean> | null = null;
  /** true when the session renews by itself (auth server) */
  silent = $state(false);
  /** shown when renewal waits for the next click */
  waitingForClick = $state(false);
  /** persistent hint (not cleared by syncing) */
  notice = $state('');

  constructor() {
    try {
      this.p = JSON.parse(localStorage.getItem(LS) || '{}');
    } catch {
      this.p = { connected: false };
    this.connected = false;
    }
    this.email = this.p.email ?? '';
    this.lastSync = this.p.lastSync ?? null;
    this.silent = !!this.p.refresh;
    this.connected = !!this.p.connected;
    if (this.p.connected) this.status = this.tokenValid() || this.p.refresh ? 'idle' : 'auth';
  }

  /** reactive mirror of p.connected */
  connected = $state(false);

  private save() {
    localStorage.setItem(LS, JSON.stringify(this.p));
  }
  private tokenValid() {
    return !!this.p.token && (this.p.expires ?? 0) > Date.now() + 60_000;
  }

  /** Interactive: must be called from a user gesture (opens Google popup). */
  async connect() {
    const cid = clientId();
    if (!cid) {
      this.status = 'error';
      this.error = 'No Google OAuth Client ID configured (Settings → Sync).';
      return;
    }
    this.error = '';
    this.gestureFailed = false;
    try {
      await loadGis();
      if (workerUrl()) await this.connectViaWorker(cid);
      else this.setToken(await this.requestToken(cid, this.p.connected ? '' : 'consent'));
      this.p.connected = true;
      this.connected = true;
      this.save();
      try {
        const about = await this.api(`${API}/about?fields=user(emailAddress)`);
        this.p.email = this.email = (await about.json()).user?.emailAddress ?? '';
        this.save();
      } catch {
        /* optional */
      }
      this.status = 'idle';
      // first sync of this device: the demo would otherwise spread to Drive and every device
      if (!this.p.lastSync && hasDemo()) await askRemoveDemo(t('This device still has the demo. Remove it before the first sync, so it doesn’t end up in your Drive and on your other devices?'));
      await this.syncNow();
    } catch (e) {
      this.status = this.p.connected ? 'auth' : 'error';
      this.error = String((e as Error).message ?? e);
    }
  }

  /** Token flow (browser only). Must run inside a user gesture. */
  private requestToken(cid: string, prompt: '' | 'consent'): Promise<any> {
    return new Promise<any>((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: cid,
        scope: SCOPE,
        callback: (r: any) => (r.error ? rej(new Error(r.error_description || r.error)) : res(r)),
        error_callback: (e: any) => rej(new Error(e?.message || e?.type || 'Sign-in cancelled'))
      });
      tc.requestAccessToken({ prompt, login_hint: this.p.email || undefined });
    });
  }

  /** Code flow: Google gives a one-time code, the Worker trades it for tokens. */
  private async connectViaWorker(cid: string) {
    const code = await new Promise<string>((res, rej) => {
      const cc = google.accounts.oauth2.initCodeClient({
        client_id: cid,
        scope: SCOPE,
        ux_mode: 'popup',
        login_hint: this.p.email || undefined,
        callback: (r: any) => (r.error || !r.code ? rej(new Error(r.error_description || r.error || 'No code')) : res(r.code)),
        error_callback: (e: any) => rej(new Error(e?.message || e?.type || 'Sign-in cancelled'))
      });
      cc.requestCode();
    });
    const t = await this.worker('/token', { code });
    this.setToken(t);
    if (t.refresh_token) {
      this.p.refresh = t.refresh_token;
      this.silent = true;
      this.notice = '';
    } else {
      // Google only issues a refresh token on first consent. Reset the grant so the
      // next connect issues one; meanwhile this session works like browser-only mode.
      this.silent = false;
      this.notice = 'Almost done: click “Reconnect” once more to stay signed in permanently.';
      await this.worker('/revoke', { token: t.access_token }).catch(() => {});
    }
  }

  private async worker(path: string, body: Record<string, string>): Promise<any> {
    const base = workerUrl().replace(/\/+$/, '');
    let r: Response;
    try {
      r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error('Auth server unreachable');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || `Auth server ${r.status}`) as Error & { status?: number };
      err.status = r.status;
      throw err;
    }
    return data;
  }

  private setToken(t: { access_token: string; expires_in?: number | string }) {
    this.p.token = t.access_token;
    this.p.expires = Date.now() + (Number(t.expires_in) || 3600) * 1000;
    this.waitingForClick = false;
    this.save();
    this.planExpiry();
  }

  /** Make sure there is a usable access token; refresh silently when possible. */
  private async ensureToken(): Promise<boolean> {
    if (this.tokenValid()) return true;
    if (this.p.refresh && workerUrl()) {
      this.refreshing ??= (async () => {
        try {
          this.setToken(await this.worker('/refresh', { refresh_token: this.p.refresh! }));
          return true;
        } catch (e) {
          const err = e as Error & { status?: number };
          if (err.status === 401) {
            // revoked or expired (e.g. 7-day limit while the Google app is in "Testing")
            this.p.refresh = undefined;
            this.silent = false;
            this.save();
            this.status = 'auth';
            this.error = 'Google access expired or was revoked – please reconnect.';
          } else {
            this.status = 'error';
            this.error = err.message;
          }
          return false;
        } finally {
          this.refreshing = null;
        }
      })();
      return this.refreshing;
    }
    this.status = 'auth';
    this.armGesture();
    return false;
  }

  /** Timers around token expiry: silent refresh, or a last sync before it runs out. */
  private planExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (!this.p.connected || !this.p.expires) return;
    const plan = renewPlan(Date.now(), this.p.expires, !!(this.p.refresh && workerUrl()));
    const at = plan.refreshAt ?? plan.preSyncAt!;
    this.expiryTimer = setTimeout(async () => {
      if (plan.refreshAt) {
        this.p.expires = 0; // force refresh
        await this.ensureToken();
        if (this.p.pending) this.syncNow();
      } else {
        if (this.p.pending && this.tokenValid()) await this.syncNow();
        this.armGesture();
      }
    }, Math.max(0, at - Date.now()));
  }

  /** Browser-only mode: renew on the next click (popups need a user gesture). */
  private armGesture() {
    if (this.gestureArmed || this.gestureFailed || !settings.autoRenew || !this.p.connected || this.p.refresh) return;
    this.gestureArmed = true;
    this.waitingForClick = true;
    const handler = (e: PointerEvent) => {
      if (isDragging() || document.visibilityState !== 'visible' || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-tour="sync"]')) return; // the sync button handles itself
      window.removeEventListener('pointerup', handler, true);
      this.gestureArmed = false;
      this.renewOnGesture();
    };
    window.addEventListener('pointerup', handler, true);
  }

  private async renewOnGesture() {
    const cid = clientId();
    if (!cid) return;
    try {
      await loadGis();
      this.setToken(await this.requestToken(cid, ''));
      this.status = 'idle';
      this.error = '';
      if (this.p.pending) await this.syncNow();
      else this.poll();
    } catch (e) {
      // popup blocked or closed: don't keep trying on every click
      this.gestureFailed = true;
      this.waitingForClick = false;
      this.status = 'auth';
      this.error = String((e as Error).message ?? e);
    }
  }

  disconnect() {
    try {
      if (this.p.refresh && workerUrl()) this.worker('/revoke', { token: this.p.refresh }).catch(() => {});
      else if (this.p.token && typeof google !== 'undefined') google.accounts.oauth2.revoke(this.p.token, () => {});
    } catch {
      /* ignore */
    }
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.silent = false;
    this.waitingForClick = false;
    this.p = { connected: false };
    this.connected = false;
    this.save();
    this.status = 'off';
    this.email = '';
    this.lastSync = null;
  }

  private async api(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    if (!(await this.ensureToken())) throw new Error('auth');
    const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.p.token}` } });
    if (r.status === 401) {
      this.p.token = undefined;
      this.p.expires = 0;
      this.save();
      if (retry && this.p.refresh) return this.api(url, init, false);
      this.status = 'auth';
      this.armGesture();
      throw new Error('auth');
    }
    if (!r.ok) throw new Error(`Drive ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  }

  private async list(): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let token = '';
    do {
      const r = await this.api(
        `${API}/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,modifiedTime,version,size)${token ? '&pageToken=' + token : ''}`
      );
      const j = await r.json();
      out.push(...j.files);
      token = j.nextPageToken ?? '';
    } while (token);
    return out;
  }

  private async upload(name: string, body: Blob, id?: string): Promise<DriveFile> {
    if (id) {
      const r = await this.api(`${UPLOAD}/files/${id}?uploadType=media&fields=id,name,version`, { method: 'PATCH', body });
      return r.json();
    }
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name, parents: ['appDataFolder'] })], { type: 'application/json' }));
    form.append('file', body);
    const r = await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id,name,version`, { method: 'POST', body: form });
    return r.json();
  }

  /** Debounced automatic sync after local edits. */
  schedule(ms = 15_000) {
    if (!this.p.connected || !settings.autoSync) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow(), ms);
  }

  async syncNow(): Promise<void> {
    if (!this.p.connected) return;
    if (!navigator.onLine) {
      this.status = 'offline';
      return;
    }
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      if (!(await this.ensureToken())) return;
      this.status = 'syncing';
      this.error = '';
      await db.flush();
      const files = await this.list();
      const main = files.find((f) => f.name === MAIN);
      let needUpload = !main;
      if (main && main.version !== this.p.lastVersion) {
        const r = await this.api(`${API}/files/${main.id}?alt=media`);
        const data = await r.json();
        const res = db.merge(data.tables ?? {});
        needUpload = res.localAhead;
      }
      if (this.p.pending) needUpload = true;

      // binary blobs (images)
      const byName = new Map(files.map((f) => [f.name, f]));
      for (const b of Object.values(db.t.blobs)) {
        const fname = `blob-${b.id}`;
        const remote = byName.get(fname);
        if (b.deleted) {
          if (remote) await this.api(`${API}/files/${remote.id}`, { method: 'DELETE' }).catch(() => {});
          continue;
        }
        const local = await db.hasBlob(b.id);
        if (local && !remote) {
          const blob = await db.getBlob(b.id);
          if (blob) {
            const f = await this.upload(fname, blob);
            db.update('blobs', b.id, { driveId: f.id });
            needUpload = true;
          }
        } else if (!local && remote) {
          const r = await this.api(`${API}/files/${remote.id}?alt=media`);
          await db.putBlobData(b.id, await r.blob());
        }
      }

      const startRev = db.rev;
      if (needUpload) {
        await db.flush();
        const payload = JSON.stringify({ format: 'structed', version: 1, exportedAt: Date.now(), tables: db.dump() });
        const f = await this.upload(MAIN, new Blob([payload], { type: 'application/json' }), main?.id);
        this.p.lastVersion = f.version;
      } else if (main) this.p.lastVersion = main.version;
      if (db.rev === startRev) this.p.pending = false;
      this.p.lastSync = this.lastSync = Date.now();
      this.save();
      this.status = 'idle';
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (msg !== 'auth') {
        this.status = 'error';
        this.error = msg;
      }
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        setTimeout(() => this.syncNow(), 500);
      }
    }
  }

  /** Lightweight remote check: only pulls when the Drive file changed. */
  async poll() {
    if (this.p.connected && document.visibilityState === 'visible' && (this.tokenValid() || this.p.refresh)) await this.syncNow();
  }

  start() {
    let seen = db.rev;
    $effect.root(() => {
      $effect(() => {
        const r = db.rev;
        if (r === seen) return;
        seen = r;
        if (!this.p.connected) return;
        this.p.pending = true;
        this.save();
        this.schedule();
      });
    });
    setInterval(() => this.poll(), 120_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.poll();
      else if (this.p.connected && this.p.pending && (this.tokenValid() || this.p.refresh)) this.syncNow();
    });
    window.addEventListener('online', () => this.poll());
    window.addEventListener('offline', () => this.p.connected && (this.status = 'offline'));
    if (this.p.connected) {
      this.planExpiry();
      if (!this.tokenValid() && !this.p.refresh) this.armGesture();
      setTimeout(() => this.poll(), 1500);
    }
  }
}

export const sync = new Sync();
