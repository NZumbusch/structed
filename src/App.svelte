<script lang="ts">
  import Icon from './components/Icon.svelte';
  import Library from './components/Library.svelte';
  import Projects from './components/Projects.svelte';
  import Modal from './components/Modal.svelte';
  import ArtifactEditor from './components/ArtifactEditor.svelte';
  import SourceEditor from './components/SourceEditor.svelte';
  import PlacePicker from './components/PlacePicker.svelte';
  import Search from './components/Search.svelte';
  import Settings from './components/Settings.svelte';
  import ZoteroImport from './components/ZoteroImport.svelte';
  import Export from './components/Export.svelte';
  import Snapshots from './components/Snapshots.svelte';
  import Menu from './components/Menu.svelte';
  import Outline from './stages/Outline.svelte';
  import Collect from './stages/Collect.svelte';
  import Write from './stages/Write.svelte';
  import Select from './stages/Select.svelte';
  import { db } from './lib/db.svelte';
  import { ui, type Stage } from './lib/ui.svelte';
  import { settings } from './lib/settings.svelte';
  import { sync } from './lib/sync.svelte';
  import { t } from './lib/i18n';
  import { matches, comboFor, displayCombo } from './lib/shortcuts';
  import Tour from './components/Tour.svelte';
  import ContextMenu from './components/ContextMenu.svelte';

  const project = $derived(db.get('projects', ui.projectId));
  const STAGES: { id: Stage; label: string; icon: string; tourKey: string }[] = [
    { id: 'outline', label: 'Outline', icon: 'menu', tourKey: 'stageOutline' },
    { id: 'collect', label: 'Collect', icon: 'book', tourKey: 'stageCollect' },
    { id: 'select', label: 'Select', icon: 'check', tourKey: 'stageSelect' },
    { id: 'arrange', label: 'Arrange', icon: 'layers', tourKey: 'stageArrange' },
    { id: 'draft', label: 'Draft', icon: 'note', tourKey: 'stageDraft' },
    { id: 'write', label: 'Write', icon: 'edit', tourKey: 'stageWrite' }
  ];
  const panelStage = $derived(ui.stage !== 'collect' && ui.stage !== 'select');
  const panelVisible = $derived(settings.panelOpen && panelStage && !!project);

  $effect(() => {
    if (db.ready && !settings.tourDone && !ui.tour) ui.tour = true;
    // the stored project vanished (deleted, e.g. on another device): open the newest one
    if (db.ready && ui.projectId && !project) {
      const first = db.all('projects').sort((a, b) => b.updatedAt - a.updatedAt)[0];
      ui.projectId = first?.id ?? null;
    }
  });

  function isEditable(el: EventTarget | null) {
    const e = el as HTMLElement | null;
    return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || !!e.closest?.('.cm-editor'));
  }

  const ACTIONS: Record<string, { run: () => void; inFields?: boolean; needsProject?: boolean }> = {
    search: { run: () => (ui.dialog = ui.dialog === 'search' ? null : 'search'), inFields: true },
    togglePanel: { run: () => (settings.panelOpen = !settings.panelOpen), inFields: true },
    settings: { run: () => (ui.dialog = 'settings'), inFields: true },
    undo: { run: () => db.undo() && ui.toast(t('Undone'), {}, 1200) },
    redo: { run: () => db.redo() && ui.toast(t('Redone'), {}, 1200) },
    projects: { run: () => (ui.dialog = 'projects'), inFields: true },
    export: { run: () => (ui.dialog = 'export'), inFields: true, needsProject: true },
    snapshot: { run: () => (ui.dialog = 'snapshots'), inFields: true, needsProject: true },
    syncNow: { run: () => syncClick(), inFields: true },
    toggleTheme: {
      run: () => (settings.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
      inFields: true
    },
    toggleContrast: { run: () => (settings.contrast = settings.contrast === 'high' ? 'normal' : 'high'), inFields: true },
    focusLibrary: {
      run: () => {
        settings.panelOpen = true;
        if (ui.narrow) ui.panelMobileOpen = true;
        setTimeout(() => document.querySelector<HTMLInputElement>('[data-tour="library"] .search input')?.focus(), 30);
      },
      inFields: true,
      needsProject: true
    },
    tour: { run: () => (ui.tour = true), inFields: true },
    stageOutline: { run: () => (ui.stage = 'outline'), inFields: true, needsProject: true },
    stageCollect: { run: () => (ui.stage = 'collect'), inFields: true, needsProject: true },
    stageSelect: { run: () => (ui.stage = 'select'), inFields: true, needsProject: true },
    stageArrange: { run: () => (ui.stage = 'arrange'), inFields: true, needsProject: true },
    stageDraft: { run: () => (ui.stage = 'draft'), inFields: true, needsProject: true },
    stageWrite: { run: () => (ui.stage = 'write'), inFields: true, needsProject: true },
    newQuote: { run: () => (ui.editArtifact = { kind: 'quote' }), inFields: true },
    newParaphrase: { run: () => (ui.editArtifact = { kind: 'paraphrase' }), inFields: true },
    newNote: { run: () => (ui.editArtifact = { kind: 'note' }), inFields: true },
    newSource: { run: () => (ui.editSource = {}), inFields: true },
    importZotero: { run: () => (ui.dialog = 'zotero'), inFields: true }
  };

  function keys(e: KeyboardEvent) {
    if (e.defaultPrevented || ui.recordingShortcut) return;
    const editable = isEditable(e.target);
    for (const [id, a] of Object.entries(ACTIONS)) {
      if (!matches(e, id)) continue;
      if (!a.inFields && (editable || ui.dialog)) return;
      if (a.needsProject && !project) return;
      e.preventDefault();
      a.run();
      return;
    }
  }

  // panel resize
  let resizing = false;
  function startResize(e: PointerEvent) {
    resizing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function doResize(e: PointerEvent) {
    if (resizing) settings.panelWidth = Math.max(260, Math.min(640, innerWidth - e.clientX));
  }

  const syncIcon = $derived(
    sync.status === 'off' ? 'cloud-off' : sync.status === 'syncing' ? 'refresh' : sync.status === 'error' || sync.status === 'auth' || sync.status === 'offline' ? 'cloud-off' : 'cloud'
  );
  const syncTitle = $derived(
    {
      off: t('Sync off – click to set up'),
      idle: t('Synced') + (sync.lastSync ? ` · ${new Date(sync.lastSync).toLocaleTimeString()}` : ''),
      syncing: t('Syncing…'),
      error: t('Sync error') + ': ' + sync.error,
      auth: sync.waitingForClick ? t('Sync paused – resumes automatically on your next click') : t('Google session expired – click to reconnect'),
      offline: t('Offline – will sync when back online')
    }[sync.status]
  );
  function syncClick() {
    if (sync.status === 'off' || sync.status === 'error') {
      ui.settingsTab = 'sync';
      ui.dialog = 'settings';
    } else if (sync.status === 'auth') sync.connect();
    else sync.syncNow();
  }

  const projectMenu = $derived([
    { label: t('All projects…'), icon: 'folder', run: () => (ui.dialog = 'projects') },
    { label: t('Export…'), icon: 'upload', run: () => (ui.dialog = 'export') },
    { label: t('Snapshots'), icon: 'history', run: () => (ui.dialog = 'snapshots') },
    { label: t('Import from Zotero…'), icon: 'download', run: () => (ui.dialog = 'zotero') },
    null,
    { label: t('Library (all projects)'), icon: 'book', run: () => { ui.projectId = null; ui.libraryMode = true; ui.collectSourceId = null; } },
    { label: t('Close project'), icon: 'x', run: () => { ui.projectId = null; ui.libraryMode = false; } },
    null,
    { label: t('Settings'), icon: 'settings', run: () => (ui.dialog = 'settings') }
  ]);
</script>

<svelte:window onkeydown={keys} onpointermove={doResize} onpointerup={() => (resizing = false)} />

{#if !db.ready}
  <div class="loading"></div>
{:else}
  <div class="app" class:has-panel={panelVisible && !ui.narrow} style="--panel:{settings.panelWidth}px">
    <header class="top">
      <div class="left" data-tour="project">
        <img src="{import.meta.env.BASE_URL}icon.svg" alt="" class="logo" />
        {#if project}
          <Menu items={projectMenu} label={t('Project menu')}>
            {#snippet trigger()}
              <span class="pname ellipsis">{project.title || t('Untitled project')}</span><span class="sr-only">– {t('Project menu')}</span><Icon name="chevron-down" size={14} />
            {/snippet}
          </Menu>
        {:else if ui.libraryMode}
          <button class="btn ghost sm" onclick={() => (ui.libraryMode = false)}><Icon name="chevron-left" size={14} />{t('Projects')}</button>
          <strong class="ltitle">{t('Library')}</strong>
        {:else}
          <strong>Structed</strong>
        {/if}
      </div>

      {#if project}
        <nav class="stages seg" aria-label={t('Stages')} data-tour="stages">
          {#each STAGES as s (s.id)}
            <button class:on={ui.stage === s.id} onclick={() => (ui.stage = s.id)} title="{t(s.label)}{comboFor(s.tourKey) ? ` (${displayCombo(comboFor(s.tourKey))})` : ''}">
              <Icon name={s.icon} size={15} /><span class="sl">{t(s.label)}</span>
            </button>
          {/each}
        </nav>
      {/if}

      <div class="right">
        <button data-tour="search" class="icon-btn" onclick={() => (ui.dialog = 'search')} title="{t('Search')} ({displayCombo(comboFor('search'))})"><Icon name="search" /></button>
        <button class="icon-btn hide-sm" onclick={() => db.undo() && ui.toast(t('Undone'), {}, 1200)} disabled={!db.canUndo} title="{t('Undo')} ({displayCombo(comboFor('undo'))})"><Icon name="undo" /></button>
        <button data-tour="sync" class="icon-btn sync s-{sync.status}" class:waiting={sync.waitingForClick} onclick={syncClick} title={syncTitle}><Icon name={syncIcon} /></button>
        {#if project && panelStage}
          <button
            class="icon-btn"
            class:active={ui.narrow ? ui.panelMobileOpen : settings.panelOpen}
            onclick={() => (ui.narrow ? (ui.panelMobileOpen = !ui.panelMobileOpen) : (settings.panelOpen = !settings.panelOpen))}
            title="{t('Library panel')} ({displayCombo(comboFor('togglePanel'))})"
          ><Icon name="panel" /></button>
        {/if}
        <button data-tour="settings" class="icon-btn" onclick={() => (ui.dialog = 'settings')} title={t('Settings')}><Icon name="settings" /></button>
      </div>
    </header>

    <main class="main">
      {#if !project && ui.libraryMode}
        <Collect />
      {:else if !project}
        <div class="welcome scroll">
          <div class="wbox">
            <h1>{t('Structure your writing.')}</h1>
            <p class="muted">{t('Outline your essay, thesis or article, collect quotes from your sources, place them under headings – and write with everything at hand.')}</p>
            <Projects embedded />
            <button class="btn libbtn" onclick={() => { ui.libraryMode = true; ui.collectSourceId = null; }}>
              <Icon name="book" size={15} />{t('Open library (all sources & quotes)')}
            </button>
            <p class="legal tiny muted">
              {t('Your data stays on your device.')}
              <a href="about.html">{t('About')}</a> · <a href="privacy.html">{t('Privacy policy')}</a> · <a href="terms.html">{t('Terms of use')}</a>
            </p>
          </div>
        </div>
      {:else if ui.stage === 'collect'}
        <Collect />
      {:else if ui.stage === 'select'}
        <Select {project} />
      {:else if ui.stage === 'draft'}
        <Write {project} />
      {:else if ui.stage === 'write'}
        {#await import('./stages/Compose.svelte') then m}
          <m.default {project} />
        {/await}
      {:else}
        <Outline {project} mode={ui.stage === 'arrange' ? 'arrange' : 'outline'} />
      {/if}
    </main>

    {#if panelVisible && !ui.narrow}
      <div class="resizer" role="separator" aria-orientation="vertical" onpointerdown={startResize}></div>
      <div class="panel"><Library /></div>
    {/if}
  </div>

  {#if ui.narrow && ui.panelMobileOpen && project && panelStage}
    <div class="drawer"><Library /></div>
  {/if}

  {#if ui.dialog === 'search'}<Search />{/if}
  {#if ui.dialog === 'settings'}<Settings />{/if}
  {#if ui.dialog === 'zotero'}<ZoteroImport />{/if}
  {#if ui.dialog === 'export' && project}<Export />{/if}
  {#if ui.dialog === 'snapshots' && project}<Snapshots />{/if}
  {#if ui.dialog === 'projects'}
    <Modal title={t('Projects')} onclose={() => (ui.dialog = null)}><Projects /></Modal>
  {/if}
  {#if ui.editSource}<SourceEditor />{/if}
  {#if ui.editArtifact}<ArtifactEditor />{/if}
  {#if ui.placeTarget && project}<PlacePicker />{/if}
  {#if ui.tour}<Tour />{/if}
  <ContextMenu />

  <div class="toasts" aria-live="polite">
    {#each ui.toasts as tt (tt.id)}
      <div class="toast {tt.kind ?? ''}">
        <span>{tt.text}</span>
        {#if tt.action}
          <button class="btn sm" onclick={() => { tt.action?.run(); ui.toasts = ui.toasts.filter((x) => x.id !== tt.id); }}>{tt.action.label}</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .loading {
    height: 100%;
  }
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: 1fr;
    height: 100%;
    height: 100dvh;
  }
  .app.has-panel {
    grid-template-columns: minmax(0, 1fr) 5px min(var(--panel), 45vw);
  }
  .top {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 10px;
    height: 52px;
    padding: 0 10px;
    padding-top: env(safe-area-inset-top);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .right {
    justify-content: flex-end;
  }
  .logo {
    width: 26px;
    height: 26px;
    margin-right: 4px;
  }
  .pname {
    max-width: 26vw;
    font-weight: 600;
    font-size: 0.9rem;
  }
  .stages button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
  }
  .sync.s-syncing :global(svg) {
    animation: spin 1s linear infinite;
    color: var(--accent);
  }
  .sync.s-idle {
    color: var(--ok);
  }
  .sync.s-error,
  .sync.s-auth {
    color: var(--warn);
  }
  .sync.s-auth.waiting {
    color: var(--muted);
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .main {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .resizer {
    cursor: col-resize;
    background: var(--border);
    width: 1px;
    margin: 0 2px;
    position: relative;
  }
  .resizer::after {
    content: '';
    position: absolute;
    inset: 0 -4px;
  }
  .resizer:hover {
    background: var(--accent);
  }
  .panel {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .drawer {
    position: fixed;
    z-index: 60;
    left: 0;
    right: 0;
    bottom: 0;
    height: 62vh;
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    overflow: hidden;
    box-shadow: var(--shadow);
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--surface);
  }
  .welcome {
    height: 100%;
  }
  .wbox {
    max-width: 620px;
    margin: 0 auto;
    padding: 8vh 20px 60px;
  }
  .wbox h1 {
    font-size: 2.2rem;
    letter-spacing: -0.03em;
  }
  .wbox > p {
    margin: 8px 0 24px;
    line-height: 1.6;
  }
  .legal {
    margin-top: 28px;
  }
  .libbtn {
    margin-top: 14px;
  }
  .ltitle {
    margin-left: 4px;
  }
  .legal a {
    color: var(--muted);
  }
  .toasts {
    position: fixed;
    z-index: 300;
    left: 50%;
    bottom: calc(18px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: grid;
    gap: 8px;
    justify-items: center;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px 8px 14px;
    border-radius: 10px;
    background: var(--text);
    color: var(--bg);
    font-size: 0.875rem;
    box-shadow: var(--shadow);
    pointer-events: auto;
    animation: up var(--dur) var(--ease);
  }
  .toast .btn {
    background: transparent;
    color: inherit;
    border-color: color-mix(in srgb, var(--bg) 40%, transparent);
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  @keyframes up {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @media (max-width: 900px) {
    .sl {
      display: none;
    }
    .stages button {
      padding: 0 12px;
    }
  }
  @media (max-width: 600px) {
    .top {
      grid-template-columns: auto 1fr auto;
      gap: 4px;
      padding: 0 6px;
    }
    .stages {
      justify-self: center;
    }
    .pname {
      display: none;
    }
    .logo {
      display: none;
    }
    .hide-sm {
      display: none;
    }
  }
</style>
