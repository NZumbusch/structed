<script lang="ts">
  // Link the project to a Zotero collection: its items (and those of its subcollections) then belong to the project.
  import { untrack } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { settings } from '../lib/settings.svelte';
  import { collections, libraries, type ZCollection, type ZLibrary } from '../lib/zotero';
  import { linkCollection, unlinkCollection } from '../lib/zoterolink.svelte';
  import { zoteroSyncActive } from '../lib/zoterosync.svelte';
  import type { Project } from '../lib/types';

  let { project, onclose }: { project: Project; onclose: () => void } = $props();

  let libs: ZLibrary[] = $state([]);
  const initial = untrack(() => project.zoteroCollection);
  let lib = $state(initial?.library || settings.zoteroSyncLibrary || '');
  let cols: ZCollection[] = $state([]);
  let chosen = $state(initial?.key ?? '');
  let q = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let err = $state('');

  $effect(() => {
    libraries()
      .then((l) => {
        libs = l;
        if (!lib || !l.some((x) => x.id === lib)) lib = l[0]?.id ?? '';
      })
      .catch((e) => ((err = String(e.message ?? e)), (loading = false)));
  });
  $effect(() => {
    const l = lib;
    if (!l) return;
    loading = true;
    collections(l)
      .then((c) => (cols = c))
      .catch((e) => (err = String(e.message ?? e)))
      .finally(() => (loading = false));
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
    const qq = q.trim().toLowerCase();
    return qq ? out.filter((x) => x.c.name.toLowerCase().includes(qq)).map((x) => ({ ...x, depth: 0 })) : out;
  });

  async function link() {
    if (!chosen) return;
    busy = true;
    err = '';
    try {
      const n = await linkCollection(project, lib, chosen);
      const name = cols.find((c) => c.key === chosen)?.name ?? '';
      ui.toast(t('{n} sources from “{c}” are in this project', { n, c: name }), { kind: 'ok' });
      onclose();
    } catch (e) {
      err = String((e as Error).message ?? e);
    } finally {
      busy = false;
    }
  }
  function unlink() {
    unlinkCollection(project);
    ui.toast(t('Zotero collection unlinked'), { action: { label: t('Undo'), run: () => db.undo() } });
    onclose();
  }
</script>

<Modal title={t('Link a Zotero collection')} {onclose} width="480px">
  <p class="small">{t('Everything in this collection and its subcollections belongs to the project – also what you add to it in Zotero later. You can still add other sources by hand.')}</p>
  {#if libs.length > 1}
    <label class="field">
      <span>{t('Library')}</span>
      <select class="select" bind:value={lib} onchange={() => (chosen = '')}>
        {#each libs as l (l.id)}<option value={l.id}>{l.name === 'My Library' ? t('My Library') : l.name}</option>{/each}
      </select>
    </label>
  {/if}
  {#if cols.length > 8}
    <div class="search">
      <Icon name="search" size={15} />
      <input placeholder={t('Find a collection')} bind:value={q} aria-label={t('Find a collection')} />
    </div>
  {/if}
  <div class="cols" role="radiogroup" aria-label={t('Collections')}>
    {#if loading}
      <p class="small muted">{t('Loading…')}</p>
    {:else}
      {#each tree as { c, depth } (c.key)}
        <label class="col" style="--d:{depth}">
          <input type="radio" name="zcol" value={c.key} bind:group={chosen} />
          <Icon name="folder" size={14} /><span class="grow ellipsis">{c.name}</span><span class="tiny muted">{c.numItems}</span>
        </label>
      {:else}
        <p class="small muted">{t('No collections in this library.')}</p>
      {/each}
    {/if}
  </div>
  {#if err}<p class="small err">{err}</p>{/if}
  {#if !zoteroSyncActive()}
    <p class="tiny muted">{t('Tip: with the automatic Zotero sync switched on (Settings → Zotero), new items in the collection show up by themselves. Otherwise they come in when you open Select.')}</p>
  {/if}
  {#snippet footer()}
    {#if project.zoteroCollection}<button class="btn ghost" onclick={unlink}>{t('Unlink')}</button>{/if}
    <span class="grow"></span>
    <button class="btn" onclick={onclose}>{t('Cancel')}</button>
    <button class="btn primary" disabled={!chosen || busy} onclick={link}>{busy ? t('Linking…') : t('Link')}</button>
  {/snippet}
</Modal>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    margin: 10px 0 6px;
    padding: 0 10px;
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--muted);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text);
  }
  .cols {
    display: grid;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    margin-top: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .col {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0 5px calc(var(--d, 0) * 16px);
    font-size: 0.875rem;
    cursor: pointer;
  }
  .col :global(svg) {
    color: var(--muted);
    flex: none;
  }
  .err {
    color: var(--danger);
  }
</style>
