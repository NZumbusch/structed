<script lang="ts">
  import { keepScroll } from '../lib/keepScroll';
  import { SvelteSet } from 'svelte/reactivity';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import ArtifactCard from './ArtifactCard.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings, type GroupBy } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { droppable } from '../lib/dnd';
  import { authorsFull, familyStr, inProject, projectArtifacts, sourceLabel, usageCount, visibleTags, yearOf } from '../lib/ops';
  import type { Artifact, ArtifactKind } from '../lib/types';

  let kinds = new SvelteSet<ArtifactKind>();
  // project scope: only items selected for / placed in this project
  const scoped = $derived(!!ui.projectId && settings.panelScope === 'project');
  const projectCount = $derived(ui.projectId ? projectArtifacts(ui.projectId).length : 0);
  let openGroups = new SvelteSet<string>();

  const GROUPS: GroupBy[] = ['source', 'author', 'tag', 'kind', 'publication', 'year', 'none'];
  /** filters and grouping live behind one button, so the panel shows only search and the list */
  let filterOpen = $state(false);
  const activeFilters = $derived(kinds.size + (ui.projectId && settings.panelUsage !== 'all' ? 1 : 0));
  function resetFilters() {
    kinds.clear();
    settings.panelUsage = 'all';
  }

  function pageNum(p?: string) {
    const m = p?.match(/\d+/);
    return m ? +m[0] : 1e9;
  }

  const filtered = $derived.by(() => {
    const q = ui.panelQuery.trim().toLowerCase();
    return db.all('artifacts').filter((a) => {
      if (kinds.size && !kinds.has(a.kind)) return false;
      if (scoped && !inProject(a, ui.projectId!)) return false;
      if (ui.projectId && settings.panelUsage !== 'all') {
        const used = usageCount(a.id, ui.projectId) > 0;
        if (settings.panelUsage === 'unused' ? used : !used) return false;
      }
      if (!q) return true;
      const s = db.get('sources', a.sourceId);
      const hay = [a.title, a.text, a.comment, a.page, a.tags.join(' '), s ? sourceLabel(s) + ' ' + (s.csl.title ?? '') + ' ' + authorsFull(s.csl) : '']
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
  });

  const groups = $derived.by(() => {
    const g = new Map<string, { label: string; sub?: string; items: Artifact[] }>();
    const add = (k: string, label: string, a: Artifact, sub?: string) => {
      if (!g.has(k)) g.set(k, { label, sub, items: [] });
      g.get(k)!.items.push(a);
    };
    for (const a of filtered) {
      const s = db.get('sources', a.sourceId);
      switch (settings.panelGroupBy) {
        case 'source':
          if (s) add(s.id, sourceLabel(s), a, s.csl.title);
          else add('~none', t('No source'), a);
          break;
        case 'author': {
          const names = s ? (s.csl.author?.length ? s.csl.author : (s.csl.editor ?? [])) : [];
          if (!names.length) add('~none', t('No author'), a);
          for (const n of names) add('a:' + familyStr(n), familyStr(n) + (n.given ? ', ' + n.given : ''), a);
          break;
        }
        case 'tag':
          if (!visibleTags(a.tags).length) add('~none', t('Untagged'), a);
          for (const tg of visibleTags(a.tags)) add('t:' + tg, '#' + tg, a);
          break;
        case 'kind':
          add(a.kind, t(a.kind), a);
          break;
        case 'publication': {
          const p = (s?.csl['container-title'] as string) || s?.csl.publisher || '';
          add(p ? 'p:' + p : '~none', p || t('No publication'), a);
          break;
        }
        case 'year': {
          const y = s ? yearOf(s.csl) : '';
          add(y ? 'y:' + y : '~none', y || t('No year'), a);
          break;
        }
        default:
          add('all', t('All items'), a);
      }
    }
    const list = [...g.entries()].map(([k, v]) => ({ key: k, ...v }));
    for (const x of list)
      x.items.sort((a, b) =>
        a.sourceId === b.sourceId ? pageNum(a.page) - pageNum(b.page) || a.createdAt - b.createdAt : a.createdAt - b.createdAt
      );
    const desc = settings.panelGroupBy === 'year';
    list.sort((a, b) => (a.key.startsWith('~') ? 1 : b.key.startsWith('~') ? -1 : desc ? b.label.localeCompare(a.label) : a.label.localeCompare(b.label)));
    return list;
  });

  const forceOpen = $derived(!!ui.panelQuery.trim() || groups.length === 1);

  const newMenu = [
    { label: t('Quote'), icon: 'quote', run: () => (ui.editArtifact = { kind: 'quote' }) },
    { label: t('Paraphrase'), icon: 'paraphrase', run: () => (ui.editArtifact = { kind: 'paraphrase' }) },
    { label: t('Note / idea'), icon: 'note', run: () => (ui.editArtifact = { kind: 'note' }) },
    { label: t('Image'), icon: 'image', run: () => (ui.editArtifact = { kind: 'image' }) },
    null,
    { label: t('New source'), icon: 'book', run: () => (ui.editSource = {}) },
    { label: t('Import from Zotero…'), icon: 'download', run: () => (ui.dialog = 'zotero') }
  ];
</script>

<svelte:window onpointerdown={() => (filterOpen = false)} onkeydown={(e) => e.key === 'Escape' && filterOpen && ((filterOpen = false), e.stopPropagation())} />

<aside
  class="lib"
  data-tour="library"
  use:droppable={{
    accepts: (p) => p.type === 'placement',
    onDrop: (p) => {
      db.remove('placements', p.id);
      ui.toast(t('Removed from heading'), { action: { label: t('Undo'), run: () => db.undo() } });
    }
  }}
>
  <div class="top">
    <div class="row">
      <div class="search grow">
        <Icon name="search" size={15} />
        <input placeholder={t('Search quotes, notes, sources…')} bind:value={ui.panelQuery} />
        {#if ui.panelQuery}<button class="icon-btn sm" onclick={() => (ui.panelQuery = '')}><Icon name="x" size={14} /></button>{/if}
      </div>
      <button class="icon-btn fbtn" class:active={filterOpen || activeFilters > 0} aria-expanded={filterOpen} title={t('Filter & grouping')} aria-label={t('Filter & grouping')} onclick={(e) => { e.stopPropagation(); filterOpen = !filterOpen; }}>
        <Icon name="filter" size={16} />{#if activeFilters}<span class="badge">{activeFilters}</span>{/if}
      </button>
      <Menu items={newMenu} icon="plus" label={t('Add')} />
      {#if ui.narrow}
        <button class="icon-btn" onclick={() => (ui.panelMobileOpen = false)} aria-label={t('Close')}><Icon name="x" /></button>
      {/if}
    </div>
    {#if ui.projectId}
      <div class="seg scopes" role="group" aria-label={t('Show')}>
        <button class:on={settings.panelScope === 'project'} onclick={() => (settings.panelScope = 'project')} title={t('Only quotes selected for or placed in this project')}>
          {t('Project')} <span class="n">{projectCount}</span>
        </button>
        <button class:on={settings.panelScope === 'library'} onclick={() => (settings.panelScope = 'library')} title={t('All sources and quotes')}>{t('Library')}</button>
      </div>
    {/if}
    {#if filterOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="fpop" role="dialog" aria-label={t('Filter')} tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
        {#if ui.projectId}
          <div class="fsec">
            <span class="flabel">{t('Placed under headings')}</span>
            <div class="seg usage" role="group" aria-label={t('Placed under headings')}>
              {#each [['unused', 'Unused'], ['all', 'All'], ['used', 'Used']] as [v, l] (v)}
                <button class:on={settings.panelUsage === v} onclick={() => (settings.panelUsage = v as typeof settings.panelUsage)} title={v === 'unused' ? t('Not yet placed under a heading') : v === 'used' ? t('Already placed under a heading') : ''}>{t(l)}</button>
              {/each}
            </div>
          </div>
        {/if}
        <div class="fsec">
          <span class="flabel">{t('Type')}</span>
          <div class="row filters">
            {#each ['quote', 'paraphrase', 'note', 'image'] as k (k)}
              <button
                class="btn sm kind"
                class:active={kinds.has(k as ArtifactKind)}
                aria-pressed={kinds.has(k as ArtifactKind)}
                title={t(k)}
                onclick={() => (kinds.has(k as ArtifactKind) ? kinds.delete(k as ArtifactKind) : kinds.add(k as ArtifactKind))}
              ><Icon name={k} size={14} />{t(k)}</button>
            {/each}
          </div>
        </div>
        <label class="fsec">
          <span class="flabel">{t('Group by')}</span>
          <select class="select gsel" bind:value={settings.panelGroupBy} aria-label={t('Group by')}>
            {#each GROUPS as g (g)}<option value={g}>{t('By ' + g)}</option>{/each}
          </select>
        </label>
        <div class="row factions">
          {#if activeFilters}<button class="btn ghost sm" onclick={resetFilters}>{t('Reset filters')}</button>{/if}
          <span class="grow"></span>
          <button class="btn sm" onclick={() => (filterOpen = false)}>{t('Done')}</button>
        </div>
      </div>
    {/if}
  </div>

  <div class="list scroll" use:keepScroll={'panel:' + (ui.projectId ?? 'library') + ':' + (scoped ? 'p' : 'l')}>
    {#if !groups.length}
      <div class="empty small">
        {#if scoped && !projectCount && db.all('artifacts').length}
          <p>{t('Nothing selected for this project yet.')}</p>
          <button class="btn sm" onclick={() => (ui.stage = 'select')}><Icon name="check" size={14} />{t('Select quotes')}</button>
          <button class="btn sm" onclick={() => (settings.panelScope = 'library')}><Icon name="book" size={14} />{t('Show whole library')}</button>
        {:else if db.all('artifacts').length}
          {t('Nothing matches.')}
        {:else}
          <p>{t('No quotes or notes yet.')}</p>
          <button class="btn sm" onclick={() => (ui.editArtifact = { kind: 'quote' })}><Icon name="plus" size={14} />{t('Add a quote')}</button>
          <button class="btn sm" onclick={() => (ui.dialog = 'zotero')}><Icon name="download" size={14} />{t('Import from Zotero…')}</button>
        {/if}
      </div>
    {/if}
    {#each groups as g (g.key)}
      {@const open = forceOpen || openGroups.has(g.key)}
      <section class="group">
        <button class="gh" onclick={() => (openGroups.has(g.key) ? openGroups.delete(g.key) : openGroups.add(g.key))}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
          <span class="gl ellipsis"><strong>{g.label}</strong>{#if g.sub} <span class="muted">{g.sub}</span>{/if}</span>
          <span class="count">{g.items.length}</span>
        </button>
        {#if open}
          <div class="items">
            {#each g.items as a (a.id)}
              <ArtifactCard {a} context="panel" />
            {/each}
            {#if settings.panelGroupBy === 'source' && !g.key.startsWith('~')}
              <button class="btn ghost sm addq" onclick={() => (ui.editArtifact = { kind: 'quote', sourceId: g.key })}>
                <Icon name="plus" size={13} />{t('Quote from this source')}
              </button>
            {/if}
          </div>
        {/if}
      </section>
    {/each}
  </div>
  <div class="hint tiny muted">{t('Drag items onto headings · long-press on touch')}</div>
</aside>

<style>
  .lib {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--surface);
  }
  .top {
    position: relative;
    display: grid;
    gap: 8px;
    padding: 10px 10px 8px;
    border-bottom: 1px solid var(--border);
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 6px 0 10px;
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
    font-size: 0.875rem;
  }
  .fbtn {
    position: relative;
  }
  .badge {
    position: absolute;
    top: 1px;
    right: 1px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 0.65rem;
    line-height: 15px;
    font-weight: 600;
  }
  .fpop {
    position: absolute;
    z-index: 20;
    top: calc(100% - 4px);
    left: 10px;
    right: 10px;
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .fsec {
    display: grid;
    gap: 6px;
  }
  .flabel {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted);
  }
  .filters {
    flex-wrap: wrap;
    gap: 4px;
  }
  .kind.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .scopes {
    justify-self: start;
  }
  .scopes button {
    padding: 0 9px;
  }
  .n {
    margin-left: 2px;
    font-size: 0.72rem;
    color: var(--muted);
  }
  .gsel {
    width: 100%;
  }
  .list {
    flex: 1;
    min-height: 0;
    padding: 6px 8px 16px;
  }
  .gh {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 6px;
    border: 0;
    background: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    font-size: 0.85rem;
    color: var(--text);
  }
  .gh:hover {
    background: var(--surface-2);
  }
  .gl {
    flex: 1;
  }
  .gl .muted {
    margin-left: 6px;
    font-weight: 400;
  }
  .count {
    font-size: 0.75rem;
    color: var(--faint);
  }
  .items {
    display: grid;
    gap: 6px;
    padding: 2px 0 10px 8px;
  }
  .addq {
    justify-self: start;
    color: var(--muted);
  }
  .empty .btn {
    margin: 4px;
  }
  .hint {
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    text-align: center;
  }
</style>
