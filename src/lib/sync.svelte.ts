// Google Drive sync via the hidden appDataFolder (scope drive.appdata).
// Pure client-side: Google Identity Services token flow, no backend needed.
import { db } from './db.svelte';
import { clientId, settings } from './settings.svelte';

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

  constructor() {
    try {
      this.p = JSON.parse(localStorage.getItem(LS) || '{}');
    } catch {
      this.p = { connected: false };
    }
    this.email = this.p.email ?? '';
    this.lastSync = this.p.lastSync ?? null;
    if (this.p.connected) this.status = this.tokenValid() ? 'idle' : 'auth';
  }

  get connected() {
    return !!this.p.connected;
  }

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
    try {
      await loadGis();
      const resp = await new Promise<any>((res, rej) => {
        const tc = google.accounts.oauth2.initTokenClient({
          client_id: cid,
          scope: SCOPE,
          callback: (r: any) => (r.error ? rej(new Error(r.error_description || r.error)) : res(r)),
          error_callback: (e: any) => rej(new Error(e?.message || e?.type || 'Sign-in cancelled'))
        });
        tc.requestAccessToken({ prompt: this.p.connected ? '' : 'consent', login_hint: this.p.email || undefined });
      });
      this.p.token = resp.access_token;
      this.p.expires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      this.p.connected = true;
      this.save();
      try {
        const about = await this.api(`${API}/about?fields=user(emailAddress)`);
        this.p.email = this.email = (await about.json()).user?.emailAddress ?? '';
        this.save();
      } catch {
        /* optional */
      }
      this.status = 'idle';
      await this.syncNow();
    } catch (e) {
      this.status = this.p.connected ? 'auth' : 'error';
      this.error = String((e as Error).message ?? e);
    }
  }

  disconnect() {
    try {
      if (this.p.token && typeof google !== 'undefined') google.accounts.oauth2.revoke(this.p.token, () => {});
    } catch {
      /* ignore */
    }
    this.p = { connected: false };
    this.save();
    this.status = 'off';
    this.email = '';
    this.lastSync = null;
  }

  private async api(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.tokenValid()) {
      this.status = 'auth';
      throw new Error('auth');
    }
    const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.p.token}` } });
    if (r.status === 401) {
      this.p.token = undefined;
      this.save();
      this.status = 'auth';
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
    if (!this.tokenValid()) {
      this.status = 'auth';
      return;
    }
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.status = 'syncing';
    this.error = '';
    try {
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
    if (this.p.connected && this.tokenValid() && document.visibilityState === 'visible') await this.syncNow();
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
      else if (this.p.connected && this.p.pending && this.tokenValid()) this.syncNow();
    });
    window.addEventListener('online', () => this.poll());
    window.addEventListener('offline', () => this.p.connected && (this.status = 'offline'));
    if (this.p.connected) setTimeout(() => this.poll(), 1500);
  }
}

export const sync = new Sync();
