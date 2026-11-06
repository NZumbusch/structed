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
  const chosen = $derived(settings.zoteroSyncCollections ?? []);
  /** "only these collections" chosen, but nothing ticked yet */
  let pickMode = $state(false);
  /** tick / untick a collection together with all its subcollections */
  function toggle(key: string, on: boolean) {
    const keys = [key];
    for (let i = 0; i < keys.length; i++) for (const c of cols) if (c.parent === keys[i]) keys.push(c.key);
    const next = new Set(chosen);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    settings.zoteroSyncCollections = cols.length ? cols.map((c) => c.key).filter((k) => next.has(k)).concat([...next].filter((k) => !cols.some((c) => c.key === k))) : [...next];
    if (!next.size) pickMode = true;
  }
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
    <label class="field">
      <span>{t('Library')}</span>
      <select class="select" bind:value={settings.zoteroSyncLibrary} onchange={() => (settings.zoteroSyncCollections = [])}>
        {#if !libs.length && settings.zoteroSyncLibrary}<option value={settings.zoteroSyncLibrary}>{settings.zoteroSyncLibrary}</option>{/if}
        {#each libs as l (l.id)}<option value={l.id}>{l.name === 'My Library' ? t('My Library') : l.name}</option>{/each}
      </select>
    </label>
    <fieldset class="scope">
      <legend>{t('What to keep in sync')}</legend>
      <label class="chk"><input type="radio" name="zscope" checked={!chosen.length && !pickMode} onchange={() => ((settings.zoteroSyncCollections = []), (pickMode = false))} />{t('Whole library')}</label>
      <label class="chk"><input type="radio" name="zscope" checked={chosen.length > 0 || pickMode} disabled={!cols.length} onchange={() => (pickMode = true)} />{t('Only these collections')}</label>
      {#if chosen.length || pickMode}
        <div class="cols" role="group" aria-label={t('Collections')}>
          {#each tree as { c, depth } (c.key)}
            <label class="chk col" style="--d:{depth}">
              <input type="checkbox" checked={chosen.includes(c.key)} onchange={(e) => toggle(c.key, e.currentTarget.checked)} />
              <span class="grow">{c.name}</span><span class="tiny muted">{c.numItems}</span>
            </label>
          {/each}
          {#each chosen.filter((k) => !cols.some((c) => c.key === k)) as k (k)}
            <label class="chk col"><input type="checkbox" checked onchange={() => toggle(k, false)} /><span class="muted">{k}</span></label>
          {/each}
        </div>
        <p class="tiny muted">{t('Ticking a collection also ticks its subcollections.')}</p>
      {/if}
    </fieldset>
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
  .scope {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .scope legend {
    margin-bottom: 4px;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--muted);
  }
  .cols {
    display: grid;
    gap: 2px;
    max-height: 240px;
    overflow-y: auto;
    margin-left: 22px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .col {
    padding: 3px 0 3px calc(var(--d, 0) * 16px);
  }
  .st {
    gap: 6px;
    color: var(--muted);
  }
  .err {
    color: var(--danger);
  }
</style>
