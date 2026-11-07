<script lang="ts">
  // Find a quote among hundreds: search, filter, sort – remembered between uses, with a
  // reset. Keyboard: type to search, ↑/↓ to move, Enter to insert, Esc to close.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings, PICKER_DEFAULTS, type PickerPrefs } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { authorsFull, placementsOf, projectArtifacts, shortCite, sourceLabel, visibleTags, yearOf } from '../lib/ops';
  import type { Artifact } from '../lib/types';

  let {
    headingId = null,
    onpick,
    onclose
  }: {
    /** the section being written: offers "this section" as a scope */
    headingId?: string | null;
    onpick: (id: string) => void;
    onclose?: () => void;
  } = $props();

  let q = $state('');
  let active = $state(0);
  let input: HTMLInputElement;
  let listEl = $state<HTMLDivElement>();
  const LIMIT_STEP = 80;
  let limit = $state(LIMIT_STEP);

  const p = $derived(settings.picker ?? PICKER_DEFAULTS);
  const set = (patch: Partial<PickerPrefs>) => {
    settings.picker = { ...p, ...patch };
    active = 0;
    limit = LIMIT_STEP;
  };
  const changed = $derived(JSON.stringify(p) !== JSON.stringify(PICKER_DEFAULTS));
  // "this section" needs a section; fall back to the project otherwise
  const scope = $derived(p.scope === 'section' && !headingId ? 'project' : !ui.projectId && p.scope !== 'library' ? 'library' : p.scope);

  const inScope = $derived.by((): Artifact[] => {
    if (scope === 'section' && headingId) {
      const ids = new Set(placementsOf(headingId).map((x) => x.artifactId));
      return db.all('artifacts').filter((a) => ids.has(a.id));
    }
    if (scope === 'project' && ui.projectId) return projectArtifacts(ui.projectId);
    return db.all('artifacts');
  });
  const sources = $derived(
    [...new Set(inScope.map((a) => a.sourceId).filter(Boolean))]
      .map((id) => db.get('sources', id))
      .filter((s) => !!s)
      .sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b)))
  );

  const pageNum = (x?: string) => +(x?.match(/\d+/)?.[0] ?? 1e9);
  const results = $derived.by(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const recent = settings.recentQuotes ?? [];
    let list = inScope.filter((a) => a.kind !== 'image' && (!p.kinds.length || p.kinds.includes(a.kind as never)) && (!p.sourceId || a.sourceId === p.sourceId));
    if (words.length)
      list = list.filter((a) => {
        const s = db.get('sources', a.sourceId);
        const hay = [a.title, a.text, a.comment, a.page, visibleTags(a.tags).join(' '), s ? `${sourceLabel(s)} ${s.csl.title ?? ''} ${authorsFull(s.csl)}` : ''].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    const src = (a: Artifact) => db.get('sources', a.sourceId);
    const by: Record<PickerPrefs['sort'], (a: Artifact, b: Artifact) => number> = {
      source: (a, b) => sourceLabel(src(a)).localeCompare(sourceLabel(src(b))) || pageNum(a.page) - pageNum(b.page),
      author: (a, b) => (src(a) ? authorsFull(src(a)!.csl) : '~').localeCompare(src(b) ? authorsFull(src(b)!.csl) : '~') || pageNum(a.page) - pageNum(b.page),
      year: (a, b) => (src(b) ? yearOf(src(b)!.csl) : '').localeCompare(src(a) ? yearOf(src(a)!.csl) : '') || pageNum(a.page) - pageNum(b.page),
      added: (a, b) => b.createdAt - a.createdAt,
      recent: (a, b) => {
        const ia = recent.indexOf(a.id), ib = recent.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || b.createdAt - a.createdAt;
      }
    };
    return list.sort(by[p.sort]);
  });
  const shown = $derived(results.slice(0, limit));

  function pick(a: Artifact | undefined) {
    if (!a) return;
    settings.recentQuotes = [a.id, ...(settings.recentQuotes ?? []).filter((x) => x !== a.id)].slice(0, 60);
    onpick(a.id);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      listEl?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === 'Escape' && onclose) {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
  onMount(() => setTimeout(() => input?.focus(), 20));

  const SORTS: [PickerPrefs['sort'], string][] = [
    ['source', 'Source & page'],
    ['author', 'Author'],
    ['year', 'Year (newest)'],
    ['added', 'Recently added'],
    ['recent', 'Recently used']
  ];
  const KINDS: ['quote' | 'paraphrase' | 'note', string][] = [
    ['quote', 'quote'],
    ['paraphrase', 'paraphrase'],
    ['note', 'note']
  ];
  const toggleKind = (k: 'quote' | 'paraphrase' | 'note') => set({ kinds: p.kinds.includes(k) ? p.kinds.filter((x) => x !== k) : [...p.kinds, k] });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="qp" onkeydown={key}>
  <div class="search">
    <Icon name="search" size={15} />
    <input
      bind:this={input}
      bind:value={q}
      oninput={() => ((active = 0), (limit = LIMIT_STEP))}
      placeholder={t('Search text, author, title, page, tag…')}
      aria-label={t('Search quotes')}
      role="combobox"
      aria-expanded="true"
      aria-controls="qp-list"
      aria-activedescendant={shown[active] ? 'qp-' + shown[active].id : undefined}
    />
    {#if q}<button class="icon-btn sm" onclick={() => ((q = ''), input.focus())} aria-label={t('Clear search')}><Icon name="x" size={14} /></button>{/if}
  </div>

  <div class="controls">
    <div class="seg" role="group" aria-label={t('Where from')}>
      {#if headingId}<button class:on={scope === 'section'} onclick={() => set({ scope: 'section' })} title={t('Placed under this heading')}>{t('This section')}</button>{/if}
      {#if ui.projectId}<button class:on={scope === 'project'} onclick={() => set({ scope: 'project' })}>{t('Project')}</button>{/if}
      <button class:on={scope === 'library'} onclick={() => set({ scope: 'library' })}>{t('Library')}</button>
    </div>
    <div class="kinds" role="group" aria-label={t('Type')}>
      {#each KINDS as [k, label] (k)}
        <button class="btn sm kind" class:on={p.kinds.includes(k)} aria-pressed={p.kinds.includes(k)} onclick={() => toggleKind(k)}><Icon name={k} size={13} />{t(label)}</button>
      {/each}
    </div>
    <select class="select" value={p.sourceId} onchange={(e) => set({ sourceId: e.currentTarget.value })} aria-label={t('Source')}>
      <option value="">{t('All sources')}</option>
      {#each sources as s (s.id)}<option value={s.id}>{sourceLabel(s)} – {s.csl.title ?? ''}</option>{/each}
    </select>
    <select class="select" value={p.sort} onchange={(e) => set({ sort: e.currentTarget.value as PickerPrefs['sort'] })} aria-label={t('Sort')}>
      {#each SORTS as [v, l] (v)}<option value={v}>{t(l)}</option>{/each}
    </select>
    {#if changed}<button class="btn ghost sm" onclick={() => (settings.picker = { ...PICKER_DEFAULTS })}><Icon name="undo" size={13} />{t('Reset')}</button>{/if}
  </div>

  <div class="count tiny muted" aria-live="polite">{t('{n} found', { n: results.length })}</div>
  <div class="list" id="qp-list" role="listbox" aria-label={t('Quotes')} bind:this={listEl}>
    {#each shown as a, i (a.id)}
      {@const s = db.get('sources', a.sourceId)}
      <button
        id={'qp-' + a.id}
        data-i={i}
        role="option"
        aria-selected={i === active}
        class="hit k-{a.kind}"
        class:on={i === active}
        onmouseenter={() => (active = i)}
        onclick={() => pick(a)}
      >
        <span class="txt">{a.title ? a.title + ' — ' : ''}{a.text}</span>
        <span class="meta tiny muted">
          <Icon name={a.kind} size={11} />
          <span class="cite">{s ? shortCite(a) : t('No source')}</span>
          {#if s?.csl.title}<span class="st">· {s.csl.title}</span>{/if}
          {#each visibleTags(a.tags).slice(0, 2) as tg (tg)}<span>#{tg}</span>{/each}
        </span>
      </button>
    {:else}
      <div class="empty small muted">
        {#if scope === 'section'}{t('Nothing placed under this heading yet.')}{:else}{t('Nothing matches.')}{/if}
        {#if changed || q}<button class="btn sm" onclick={() => ((q = ''), (settings.picker = { ...PICKER_DEFAULTS }))}>{t('Reset search and filters')}</button>{/if}
      </div>
    {/each}
    {#if results.length > shown.length}
      <button class="btn ghost sm more" onclick={() => (limit += LIMIT_STEP)}>{t('Show {n} more', { n: Math.min(LIMIT_STEP, results.length - shown.length) })}</button>
    {/if}
  </div>
</div>

<style>
  .qp {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    min-width: 0;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--muted);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    height: 36px;
    border: 0;
    background: none;
    outline: none;
    color: var(--text);
    font-size: 0.9rem;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .controls .select {
    width: auto;
    max-width: 220px;
    min-height: 30px;
    height: 30px;
    padding: 0 6px;
    font-size: 0.8rem;
  }
  .seg button {
    padding: 0 9px;
  }
  .kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .kind.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    max-height: min(46vh, 420px);
    overflow-y: auto;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .hit {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 6px 8px 6px 10px;
    border: 0;
    border-left: 3px solid var(--k, var(--k-quote));
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .hit.k-paraphrase {
    --k: var(--k-paraphrase);
  }
  .hit.k-note {
    --k: var(--k-note);
  }
  .hit.on {
    background: var(--accent-soft);
  }
  .txt {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 0.875rem;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .meta > :global(*) {
    flex: none;
  }
  .meta .st {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    display: grid;
    justify-items: start;
    gap: 8px;
    padding: 12px;
  }
  .more {
    justify-self: center;
    margin: 4px;
  }
  @media (max-width: 600px) {
    .controls .select {
      max-width: 100%;
      flex: 1;
    }
  }
</style>
