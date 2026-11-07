<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { ACCENTS, BUILD_AUTH_URL, BUILD_CLIENT_ID, settings, workerUrl } from '../lib/settings.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { db } from '../lib/db.svelte';
  import { sync } from '../lib/sync.svelte';
  import { LOCALES, STYLES, secondaryWords } from '../lib/cite';
  import { exportBackup, importBackup } from '../lib/backup';
  import ShortcutSettings from './ShortcutSettings.svelte';
  import ZoteroSyncSettings from './ZoteroSyncSettings.svelte';

  /** a section was chosen (or the dialog was opened at one, e.g. Sync) */
  let picked = $state(ui.settingsTab !== 'appearance');
  const TABS = [
    ['appearance', 'Appearance', 'eye'],
    ['writing', 'Citations', 'quote'],
    ['editor', 'Editor & export', 'edit'],
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
  <!-- phones: first the list of sections, then one section with a way back -->
  <div class="set" class:list={ui.narrow && !picked} class:one={ui.narrow && picked}>
    <nav>
      {#each TABS as [id, label, icon] (id)}
        <button
          class:on={ui.settingsTab === id}
          onclick={() => {
            ui.settingsTab = id;
            picked = true;
          }}
        ><Icon name={icon} size={16} /><span class="grow">{t(label)}</span>{#if ui.narrow}<Icon name="chevron-right" size={16} />{/if}</button>
      {/each}
    </nav>
    <div class="pane">
      {#if ui.narrow}
        <button class="btn ghost sm back" onclick={() => (picked = false)}><Icon name="chevron-left" size={14} />{t('All settings')}</button>
        <h3 class="ptitle">{t(TABS.find(([id]) => id === ui.settingsTab)?.[1] ?? '')}</h3>
      {/if}
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
        <h4 class="sh4">{t('Secondary citations')}</h4>
        <label class="field"><span>{t('Words between original and source')}</span>
          <input class="input" bind:value={settings.secondaryText} placeholder={secondaryWords(settings.citationLocale)} />
        </label>
        <label class="chk"><input type="checkbox" bind:checked={settings.secondaryInBib} />{t('List the original work in the bibliography too')}</label>
        <p class="small muted">{t('A quote you know only from another work: open it, set its source to the work you read and add the original under “Secondary citation”. It is cited as “(Kaufmann, 1996, col. 1121, as cited in Lotz-Heumann, 2001, p. 108)”.')}</p>
      {:else if ui.settingsTab === 'editor'}
        <h4 class="sh4">{t('Quotes in the text')}</h4>
        <label class="field"><span>{t('Insert quotes by default')}</span>
          <select class="select" bind:value={settings.insertMode}>
            <option value="inline">{t('In the sentence')}</option>
            <option value="editable">{t('As editable text')}</option>
            <option value="block">{t('Block quote')}</option>
            <option value="footnote">{t('In a footnote')}</option>
            <option value="cite">{t('Citation only')}</option>
          </select>
        </label>
        <label class="chk"><input type="checkbox" bind:checked={settings.quoteItalic} />{t('Quotes in italics')}</label>
        <div class="f"><span>{t('Quotation marks')}</span>
          <div class="seg">
            {#each [['de', '„…“'], ['en', '“…”'], ['ch', '«…»'], ['none', t('none')]] as [v, l] (v)}
              <button class:on={settings.quoteMarks === v} onclick={() => (settings.quoteMarks = v as typeof settings.quoteMarks)}>{l}</button>
            {/each}
          </div>
        </div>
        <label class="field"><span>{t('Long quotes become block quotes from … words (0 = never)')}</span>
          <input class="input num" type="number" min="0" max="500" bind:value={settings.autoBlockWords} />
        </label>
        <h4 class="sh4">{t('Writing')}</h4>
        <label class="chk"><input type="checkbox" bind:checked={settings.editorSpellcheck} />{t('Spell check')}</label>
        <label class="chk"><input type="checkbox" bind:checked={settings.writePanel} />{t('Library panel next to the text in Write (otherwise: “Insert quote”, its shortcut or @)')}</label>
        <label class="chk"><input type="checkbox" bind:checked={settings.editorAutoDash} />{t('Turn “ - ” into a dash “ – ” while typing')}</label>
        <label class="field"><span>{t('Language of the text (spell check)')}</span>
          <select class="select" bind:value={settings.editorLang}>
            {#each [['de', 'Deutsch'], ['de-CH', 'Deutsch (Schweiz)'], ['en', 'English'], ['fr', 'Français'], ['it', 'Italiano']] as [v, l] (v)}<option value={v}>{l}</option>{/each}
          </select>
        </label>
        <h4 class="sh4">{t('Word export')}</h4>
        <label class="chk"><input type="checkbox" bind:checked={settings.exportZotero} />{t('Live Zotero citations (refresh in Word)')}</label>
        <label class="chk"><input type="checkbox" bind:checked={settings.exportCover} />{t('Title page')}</label>
        <label class="chk"><input type="checkbox" bind:checked={settings.exportToc} />{t('Table of contents')}</label>
        <label class="chk"><input type="checkbox" bind:checked={settings.exportBibliography} />{t('Bibliography')}</label>
        <label class="field"><span>{t('Title of the bibliography')}</span><input class="input" bind:value={settings.exportBibTitle} /></label>
        <p class="small muted">{t('Citations in the app follow the citation style above; in Word, Zotero formats them with the style stored in the template (APA, de-CH) – change it there via Zotero → Document Preferences.')}</p>
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
        <ZoteroSyncSettings />
        <h4 class="sh4">{t('In Select')}</h4>
        <label class="chk"><input type="checkbox" bind:checked={settings.zoteroHighlightCounts} />{t('Show how many highlights of a source are new (not gone through yet)')}</label>
        <label class="chk"><input type="checkbox" bind:checked={settings.readingStatus} />{t('Reading status per source (to read, reading, read)')}</label>
        <p class="small muted">{t('Highlights from your PDFs: open a source in Collect (or select several) → “Go through highlights…”, and take or skip them one by one.')}</p>
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
                {#if sync.connected && sync.silent} · {t('Stays signed in automatically')}{/if}
                {#if sync.status === 'auth'} · {sync.waitingForClick ? t('Paused – resumes on your next click') : t('Session expired – reconnect to continue syncing')}{/if}
              </div>
            </div>
            {#if sync.connected}
              {@const reconnect = sync.status === 'auth' || (!!workerUrl() && !sync.silent)}
              <button class="btn" onclick={() => (reconnect ? sync.connect() : sync.syncNow())} disabled={sync.status === 'syncing'}>
                <Icon name="refresh" size={15} />{reconnect ? t('Reconnect') : t('Sync now')}
              </button>
              <button class="btn ghost" onclick={() => sync.disconnect()}>{t('Disconnect')}</button>
            {:else}
              <button class="btn primary" onclick={() => sync.connect()}>{t('Connect Google Drive')}</button>
            {/if}
          </div>
          {#if sync.error}<p class="small err">{sync.error}</p>{/if}
          {#if sync.notice}<p class="small notice">{t(sync.notice)}</p>{/if}
        </div>
        <p class="small muted">{t('Structed only gets access to its own hidden folder in your Drive – never to your other files.')} <a href="privacy.html" target="_blank" rel="noopener">{t('Privacy policy')}</a></p>
        <label class="chk"><input type="checkbox" bind:checked={settings.autoSync} />{t('Sync automatically after changes')}</label>
        {#if !workerUrl()}
          <label class="chk"><input type="checkbox" bind:checked={settings.autoRenew} />{t('Renew the Google session automatically on my next click')}</label>
        {/if}
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
          <p class="small muted">{t('Without an auth server, Google sessions last about an hour. Structed syncs just before that and renews on your next click (a Google window flashes briefly). With an auth server it stays signed in silently.')}</p>
        </details>
        <label class="field"><span>{t('Auth server URL (optional, keeps you signed in)')} {BUILD_AUTH_URL ? t('(optional override)') : ''}</span>
          <input class="input" bind:value={settings.authWorkerUrl} placeholder={BUILD_AUTH_URL || 'https://structed-auth.<you>.workers.dev'} />
        </label>
        <p class="small muted">
          {t('A tiny free Cloudflare Worker that holds the Google client secret so the app can refresh its access silently. It never sees your content.')}
          <a href="https://github.com/NZumbusch/structed/tree/main/worker#readme" target="_blank" rel="noopener">{t('Setup guide')}</a>
          {#if workerUrl() && sync.connected && !sync.silent}<br /><strong>{t('Reconnect once to switch to the auth server.')}</strong>{/if}
        </p>
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
        {#if ui.offlineReady || navigator.serviceWorker?.controller}<p class="small muted">{t('Works offline: the app is stored on this device.')}</p>{/if}
        <ul class="small">
          <li><b>{t('Outline')}</b> – {t('headings, subheadings and the gist of each section.')}</li>
          <li><b>{t('Collect')}</b> – {t('sources (Zotero) and quotes, paraphrases, notes, images.')}</li>
          <li><b>{t('Select')}</b> – {t('choose the sources and quotes this project needs.')}</li>
          <li><b>{t('Arrange')}</b> – {t('drag items from the library onto headings.')}</li>
          <li><b>{t('Write')}</b> – {t('the final text with linked quotes and footnotes; Word export.')}</li>
        </ul>
        <p class="small muted">{t('All data is stored locally in your browser (IndexedDB) and works offline. Install it via your browser’s “Install app” / “Add to Home Screen”.')}</p>
        <p class="small legal">
          <a href="about.html" target="_blank" rel="noopener">{t('Homepage')}</a> ·
          <a href="privacy.html" target="_blank" rel="noopener">{t('Privacy policy')}</a> ·
          <a href="terms.html" target="_blank" rel="noopener">{t('Terms of use')}</a>
        </p>
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
  .notice {
    margin: 8px 0 0;
    font-weight: 500;
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
  .sh4 {
    margin-top: 4px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .num {
    width: 110px;
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
    .set.list .pane,
    .set.one nav {
      display: none;
    }
    .set.list nav {
      position: static;
      display: grid;
      gap: 2px;
    }
    .set.list nav button {
      min-height: 46px;
      font-size: 0.95rem;
      color: var(--text);
    }
    .set.list nav button.on {
      background: none;
      color: inherit;
    }
    .back {
      margin: -4px 0 4px -6px;
    }
    .ptitle {
      margin: 0 0 12px;
      font-size: 1.05rem;
    }
  }
</style>
