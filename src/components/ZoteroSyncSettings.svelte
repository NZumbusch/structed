<script lang="ts">
  import Icon from './Icon.svelte';
  import { settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { collections, libraries, zoteroConfigured, type ZCollection, type ZLibrary } from '../lib/zotero';
  import { syncZotero, zsync } from '../lib/zoterosync.svelte';

  let libs: ZLibrary[] = $state([]);
  let cols: ZCollection[] = $state([]);
  let loadErr = $state('');
  const ready = $derived(zoteroConfigured());

  async function loadLibs() {
    loadErr = '';
    try {
      libs = await libraries();
      if (!settings.zoteroSyncLibrary || !libs.some((l) => l.id === settings.zoteroSyncLibrary)) settings.zoteroSyncLibrary = libs[0]?.id ?? '';
    } catch (e) {
      loadErr = String((e as Error).message ?? e);
    }
  }
  async function loadCols(lib: string) {
    try {
      cols = lib ? await collections(lib) : [];
    } catch {
      cols = [];
    }
  }
  $effect(() => {
    if (ready && settings.zoteroAutoSync) loadLibs();
  });
  $effect(() => {
    if (ready && settings.zoteroAutoSync) loadCols(settings.zoteroSyncLibrary);
  });

  const tree = $derived.by(() => {
    const out: { c: ZCollection; depth: number }[] = [];
    const walk = (p: string | null, d: number) => {
      for (const c of cols.filter((x) => x.parent === p)) {
        out.push({ c, depth: d });
        walk(c.key, d + 1);
      }
    };
    walk(null, 0);
    return out;
  });
  const when = $derived(zsync.lastRun ? new Date(zsync.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
</script>

<div class="zs card">
  <label class="chk">
    <input type="checkbox" bind:checked={settings.zoteroAutoSync} disabled={!ready} />
    <span><b>{t('Sync automatically')}</b> – {t('new and changed items in Zotero show up as sources without importing again')}</span>
  </label>
  {#if !ready}
    <p class="small muted">{t('Enter your user ID and API key above first.')}</p>
  {:else if settings.zoteroAutoSync}
    <div class="grid">
      <label class="field">
        <span>{t('Library')}</span>
        <select class="select" bind:value={settings.zoteroSyncLibrary}>
          {#if !libs.length && settings.zoteroSyncLibrary}<option value={settings.zoteroSyncLibrary}>{settings.zoteroSyncLibrary}</option>{/if}
          {#each libs as l (l.id)}<option value={l.id}>{l.name === 'My Library' ? t('My Library') : l.name}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>{t('Collection')}</span>
        <select class="select" bind:value={settings.zoteroSyncCollection}>
          <option value="">{t('Whole library')}</option>
          {#if settings.zoteroSyncCollection && !cols.some((c) => c.key === settings.zoteroSyncCollection)}
            <option value={settings.zoteroSyncCollection}>{settings.zoteroSyncCollection}</option>
          {/if}
          {#each tree as { c, depth } (c.key)}<option value={c.key}>{'  '.repeat(depth)}{c.name}</option>{/each}
        </select>
      </label>
    </div>
    <label class="chk"><input type="checkbox" bind:checked={settings.zoteroSyncTags} />{t('Also take over Zotero tags')}</label>
    <div class="row st small">
      {#if zsync.running}
        <Icon name="refresh" size={14} /><span>{t('Syncing…')}</span>
      {:else if zsync.error || loadErr}
        <span class="err">{zsync.error || loadErr}</span>
      {:else if when}
        <Icon name="check" size={14} /><span>{t('Last checked {time}', { time: when })}{zsync.added ? ` · ${t('{n} new', { n: zsync.added })}` : ''}</span>
      {/if}
      <span class="grow"></span>
      <button class="btn sm" disabled={zsync.running} onclick={() => syncZotero(false)}><Icon name="refresh" size={14} />{t('Check now')}</button>
    </div>
    <p class="tiny muted">{t('Checks when the app starts, when you come back to it and every 10 minutes. Sources deleted in Zotero stay here, because they may hold your quotes. Highlights are still imported through “Import Zotero highlights…”, so you can review them.')}</p>
  {/if}
</div>

<style>
  .zs {
    display: grid;
    gap: 10px;
    margin: 14px 0;
    padding: 12px 14px;
  }
  .chk {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 0.875rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .st {
    gap: 6px;
    color: var(--muted);
  }
  .err {
    color: var(--danger);
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
