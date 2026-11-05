<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { ACCENTS, BUILD_CLIENT_ID, settings } from '../lib/settings.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { db } from '../lib/db.svelte';
  import { sync } from '../lib/sync.svelte';
  import { LOCALES, STYLES } from '../lib/cite';
  import { exportBackup, importBackup } from '../lib/backup';
  import ShortcutSettings from './ShortcutSettings.svelte';

  const TABS = [
    ['appearance', 'Appearance', 'eye'],
    ['writing', 'Citations', 'quote'],
    ['shortcuts', 'Keyboard shortcuts', 'menu'],
    ['zotero', 'Zotero', 'book'],
    ['sync', 'Sync', 'cloud'],
    ['data', 'Backup & data', 'download'],
    ['about', 'About & help', 'sparkle']
  ];

  let usage = $state('');
  $effect(() => {
    navigator.storage?.estimate?.().then((e) => (usage = `${((e.usage ?? 0) / 1e6).toFixed(1)} MB`));
  });
  const counts = $derived({
    projects: db.all('projects').length,
    sources: db.all('sources').length,
    items: db.all('artifacts').length
  });
  const origin = location.origin;

  async function doImport(mode: 'merge' | 'replace') {
    if (mode === 'replace' && !confirm(t('Replace ALL local data with the backup? This cannot be undone.'))) return;
    try {
      const n = await importBackup(mode);
      if (n) ui.toast(t('Backup imported'), { kind: 'ok' });
    } catch (e) {
      ui.toast(String(e), { kind: 'error' });
    }
  }
  async function wipe() {
    if (!confirm(t('Delete ALL data on this device? Synced data in Google Drive stays.'))) return;
    await db.replaceAll({});
    ui.projectId = null;
  }
  async function persist() {
    const ok = await navigator.storage?.persist?.();
    ui.toast(ok ? t('Storage is now persistent') : t('Browser declined persistent storage'));
  }
</script>

<Modal title={t('Settings')} onclose={() => (ui.dialog = null)} width="820px">
  <div class="set">
    <nav>
      {#each TABS as [id, label, icon] (id)}
        <button class:on={ui.settingsTab === id} onclick={() => (ui.settingsTab = id)}><Icon name={icon} size={16} />{t(label)}</button>
      {/each}
    </nav>
    <div class="pane">
      {#if ui.settingsTab === 'appearance'}
        <div class="f"><span>{t('Theme')}</span>
          <div class="seg">
            {#each ['system', 'light', 'dark', 'sepia'] as th (th)}
              <button class:on={settings.theme === th} onclick={() => (settings.theme = th as typeof settings.theme)}>{t(th)}</button>
            {/each}
          </div>
        </div>
        <div class="f"><span>{t('Contrast')}</span>
          <div class="seg">
            <button class:on={settings.contrast === 'normal'} onclick={() => (settings.contrast = 'normal')}>{t('Normal')}</button>
            <button class:on={settings.contrast === 'high'} onclick={() => (settings.contrast = 'high')}>{t('High')}</button>
          </div>
        </div>
        <div class="f"><span>{t('Accent color')}</span>
          <div class="row">
            {#each ACCENTS as c (c)}
              <button class="sw" class:on={settings.accent === c} style:background={c} onclick={() => (settings.accent = c)} aria-label={c}></button>
            {/each}
            <input type="color" bind:value={settings.accent} aria-label={t('Custom')} />
          </div>
        </div>
        <label class="f"><span>{t('Text size')} · {settings.fontSize}px</span>
          <input type="range" min="13" max="22" step="1" bind:value={settings.fontSize} />
        </label>
        <div class="f"><span>{t('Writing font')}</span>
          <div class="seg">
            <button class:on={settings.editorFont === 'sans'} onclick={() => (settings.editorFont = 'sans')}>Sans</button>
            <button class:on={settings.editorFont === 'serif'} onclick={() => (settings.editorFont = 'serif')} style="font-family:var(--font-serif)">Serif</button>
            <button class:on={settings.editorFont === 'mono'} onclick={() => (settings.editorFont = 'mono')} style="font-family:var(--font-mono)">Mono</button>
          </div>
        </div>
        <div class="f"><span>{t('Line width')}</span>
          <div class="seg">
            {#each ['narrow', 'normal', 'wide'] as w (w)}
              <button class:on={settings.lineWidth === w} onclick={() => (settings.lineWidth = w as typeof settings.lineWidth)}>{t(w)}</button>
            {/each}
          </div>
        </div>
        <div class="f"><span>{t('Language')}</span>
          <div class="seg">
            <button class:on={settings.language === 'en'} onclick={() => (settings.language = 'en')}>English</button>
            <button class:on={settings.language === 'de'} onclick={() => (settings.language = 'de')}>Deutsch</button>
          </div>
        </div>
        <label class="chk"><input type="checkbox" bind:checked={settings.reduceMotion} />{t('Reduce motion')}</label>
      {:else if ui.settingsTab === 'writing'}
        <label class="field"><span>{t('Citation style')}</span>
          <select class="select" bind:value={settings.citationStyle}>
            {#each STYLES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
          </select>
        </label>
        <label class="field"><span>{t('Citation language')}</span>
          <select class="select" bind:value={settings.citationLocale}>
            {#each LOCALES as l (l)}<option value={l}>{l}</option>{/each}
          </select>
        </label>
        <p class="small muted">{t('Used for “Copy with citation”, reference previews and exports.')}</p>
      {:else if ui.settingsTab === 'shortcuts'}
        <ShortcutSettings />
      {:else if ui.settingsTab === 'zotero'}
        <p class="small">{t('Connect your Zotero library via the Zotero Web API to import items, collections and PDF highlights. Your key is stored only on this device.')}</p>
        <label class="field"><span>{t('Zotero user ID (numeric)')}</span><input class="input" bind:value={settings.zoteroUserId} placeholder="1234567" /></label>
        <label class="field"><span>{t('API key (read-only is enough)')}</span><input class="input" type="password" bind:value={settings.zoteroApiKey} autocomplete="off" /></label>
        <label class="field"><span>{t('Group library IDs (optional, comma separated)')}</span><input class="input" bind:value={settings.zoteroGroups} /></label>
        <p class="small muted">
          {t('Find both at')} <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener">zotero.org/settings/keys</a>
          — {t('“Your userID for use in API calls”, then “Create new private key” with read access to the library (and notes).')}
        </p>
        <button class="btn" onclick={() => (ui.dialog = 'zotero')}><Icon name="download" size={15} />{t('Open Zotero import')}</button>
      {:else if ui.settingsTab === 'sync'}
        <p class="small">{t('Sync all projects, sources and quotes between devices through a hidden app folder in your Google Drive. Works offline; changes merge per item.')}</p>
        <div class="card status">
          <div class="row">
            <Icon name={sync.connected ? 'cloud' : 'cloud-off'} />
            <div class="grow">
              <strong>{sync.connected ? t('Connected') : t('Not connected')}</strong>
              {#if sync.email}<span class="muted small"> · {sync.email}</span>{/if}
              <div class="tiny muted">
                {#if sync.lastSync}{t('Last sync')}: {new Date(sync.lastSync).toLocaleString()}{/if}
                {#if sync.status === 'auth'} · {t('Session expired – reconnect to continue syncing')}{/if}
              </div>
            </div>
            {#if sync.connected}
              <button class="btn" onclick={() => (sync.status === 'auth' ? sync.connect() : sync.syncNow())} disabled={sync.status === 'syncing'}>
                <Icon name="refresh" size={15} />{sync.status === 'auth' ? t('Reconnect') : t('Sync now')}
              </button>
              <button class="btn ghost" onclick={() => sync.disconnect()}>{t('Disconnect')}</button>
            {:else}
              <button class="btn primary" onclick={() => sync.connect()}>{t('Connect Google Drive')}</button>
            {/if}
          </div>
          {#if sync.error}<p class="small err">{sync.error}</p>{/if}
        </div>
        <label class="chk"><input type="checkbox" bind:checked={settings.autoSync} />{t('Sync automatically after changes')}</label>
        <label class="field"><span>{t('Google OAuth Client ID')} {BUILD_CLIENT_ID ? t('(optional override)') : ''}</span>
          <input class="input" bind:value={settings.googleClientId} placeholder={BUILD_CLIENT_ID || 'xxxxxxxx.apps.googleusercontent.com'} />
        </label>
        <details class="help">
          <summary>{t('How to create a free Client ID (5 minutes)')}</summary>
          <ol class="small">
            <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> → create a project (e.g. “Structed”).</li>
            <li>APIs &amp; Services → Library → enable <b>Google Drive API</b>.</li>
            <li>Google Auth Platform / OAuth consent screen → External → app name, your email. Under <b>Data access</b> add scope <code>…/auth/drive.appdata</code>. Under <b>Audience</b> add yourself as test user (or publish – appdata is a non-sensitive scope, no review needed).</li>
            <li>Clients → Create client → <b>Web application</b>. Authorized JavaScript origins: <code>{origin}</code> (and <code>http://localhost:5173</code> for development). No redirect URI needed.</li>
            <li>Copy the Client ID here, or set it as GitHub repository variable <code>GOOGLE_CLIENT_ID</code> so every device gets it automatically.</li>
          </ol>
          <p class="small muted">Google tokens for browser apps last ~1 hour; when it expires the app asks you to reconnect with one click. Your data stays local in the meantime.</p>
        </details>
      {:else if ui.settingsTab === 'data'}
        <p class="small">{counts.projects} {t('projects')} · {counts.sources} {t('sources')} · {counts.items} {t('items')} · {usage}</p>
        <div class="btns">
          <button class="btn" onclick={exportBackup}><Icon name="download" size={15} />{t('Download full backup (.json)')}</button>
          <button class="btn" onclick={() => doImport('merge')}><Icon name="upload" size={15} />{t('Import backup (merge)')}</button>
          <button class="btn" onclick={() => doImport('replace')}><Icon name="upload" size={15} />{t('Restore backup (replace)')}</button>
        </div>
        <p class="small muted">{t('Backups include all projects, sources, quotes, comments, snapshots and images.')}</p>
        <hr class="sep" />
        <div class="btns">
          <button class="btn" onclick={persist}>{t('Ask browser to keep data permanently')}</button>
          <button class="btn" onclick={() => db.compact().then(() => ui.toast(t('Cleaned up')))}>{t('Purge old deleted records')}</button>
          <button class="btn danger" onclick={wipe}><Icon name="trash" size={15} />{t('Delete all local data')}</button>
        </div>
      {:else}
        <h3>Structed</h3>
        <button class="btn primary tourbtn" onclick={() => { ui.dialog = null; ui.tour = true; }}><Icon name="sparkle" size={15} />{t('Start guided tour')}</button>
        <p class="small">{t('A minimalist tool to structure academic writing: build an outline, collect quotes from your sources, arrange them under headings, and write with everything at hand.')}</p>
        <ul class="small">
          <li><b>{t('Outline')}</b> – {t('headings, subheadings and the gist of each section.')}</li>
          <li><b>{t('Collect')}</b> – {t('sources (Zotero) and quotes, paraphrases, notes, images.')}</li>
          <li><b>{t('Arrange')}</b> – {t('drag items from the library onto headings.')}</li>
          <li><b>{t('Write')}</b> – {t('overview with texts, quotes, comments; copy with citation.')}</li>
        </ul>
        <p class="small muted">{t('All data is stored locally in your browser (IndexedDB) and works offline. Install it via your browser’s “Install app” / “Add to Home Screen”.')}</p>
        <p class="tiny muted">{t("Version")} {__APP_VERSION__.display}{__APP_VERSION__.stable ? "" : " · " + t("development build")}</p>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .set {
    display: grid;
    grid-template-columns: 190px 1fr;
    gap: 18px;
    min-height: 420px;
  }
  nav {
    position: sticky;
    top: 0;
    align-self: start;
    display: grid;
    align-content: start;
    gap: 2px;
  }
  nav button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--muted);
    font-size: 0.875rem;
  }
  nav button:hover {
    background: var(--surface-2);
  }
  nav button.on {
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 500;
  }
  .pane {
    display: grid;
    align-content: start;
    gap: 14px;
    min-width: 0;
  }
  .f {
    display: grid;
    gap: 6px;
  }
  .f > span {
    font-size: 0.8125rem;
    color: var(--muted);
    font-weight: 500;
  }
  .sw {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .sw.on {
    border-color: var(--text);
  }
  input[type='color'] {
    width: 30px;
    height: 30px;
    border: 0;
    padding: 0;
    background: none;
  }
  .chk {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.875rem;
  }
  .status {
    padding: 12px;
  }
  .err {
    color: var(--danger);
    margin: 8px 0 0;
  }
  .help summary {
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
  }
  .help ol {
    padding-left: 1.2em;
    line-height: 1.6;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--surface-2);
    padding: 1px 4px;
    border-radius: 4px;
    word-break: break-all;
  }
  .tourbtn {
    justify-self: start;
  }
  .btns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media (max-width: 700px) {
    .set {
      grid-template-columns: 1fr;
    }
    nav {
      display: flex;
      overflow-x: auto;
      background: var(--surface);
      z-index: 1;
    }
    nav button {
      white-space: nowrap;
    }
  }
</style>
