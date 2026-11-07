<script lang="ts">
  // Find a quote among hundreds: search, filter, group, sort – remembered between uses,
  // with a reset – and a preview of the marked quote with its actions.
  // Keyboard: type to search, ↑/↓ to move, Enter to insert, Ctrl+Enter to insert and stay,
  // Esc to close.
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings, PICKER_DEFAULTS, type PickerPrefs } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { authorsFull, familyStr, placementsOf, projectArtifacts, shortCite, sourceLabel, visibleTags, yearOf } from '../lib/ops';
  import { citedIds } from '../lib/footnote';
  import { syncZoteroSoon, zsync } from '../lib/zoterosync.svelte';
  import { citeArtifact } from '../lib/cite';
  import { copyText } from '../lib/clipboard';
  import { renderMd } from '../lib/markdown';
  import type { Artifact } from '../lib/types';

  let {
    headingId = null,
    onpick,
    onclose
  }: {
    /** the section being written: offers "this section" as a scope */
    headingId?: string | null;
    /** `keep`: insert and keep the search open (Ctrl+Enter) */
    onpick: (id: string, keep?: boolean) => void;
    onclose?: () => void;
  } = $props();

  let q = $state('');
  let active = $state(0);
  let input: HTMLInputElement;
  let listEl = $state<HTMLDivElement>();
  const LIMIT_STEP = 80;
  let limit = $state(LIMIT_STEP);

  // remembered choices (older saved ones get the new fields from the defaults)
  const p = $derived({ ...PICKER_DEFAULTS, ...(settings.picker ?? {}) } as PickerPrefs);
  const set = (patch: Partial<PickerPrefs>) => {
    settings.picker = { ...p, ...patch };
    active = 0;
    limit = LIMIT_STEP;
  };
  const changed = $derived(JSON.stringify(p) !== JSON.stringify(PICKER_DEFAULTS));
  const reset = () => {
    settings.picker = { ...PICKER_DEFAULTS };
    active = 0;
  };
  // "this section" needs a section; without a project there is only the library
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
  const tags = $derived([...new Set(inScope.flatMap((a) => visibleTags(a.tags)))].sort((a, b) => a.localeCompare(b)));
  /** how often each item is already cited in this project's text */
  const cited = $derived(ui.projectId ? citedIds(ui.projectId) : new Map<string, number>());

  const src = (a: Artifact) => db.get('sources', a.sourceId);
  const pageNum = (x?: string) => +(x?.match(/\d+/)?.[0] ?? 1e9);
  /** filters and search, without the scope */
  function matching(all: Artifact[]): Artifact[] {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = all.filter(
      (a) =>
        a.kind !== 'image' &&
        (!p.kinds.length || p.kinds.includes(a.kind as never)) &&
        (!p.sourceId || a.sourceId === p.sourceId) &&
        (!p.tag || a.tags.includes(p.tag)) &&
        (p.used === 'all' || !ui.projectId || (p.used === 'used') === cited.has(a.id))
    );
    if (words.length)
      list = list.filter((a) => {
        const s = src(a);
        const hay = [a.title, a.text, a.comment, a.page, visibleTags(a.tags).join(' '), s ? `${sourceLabel(s)} ${s.csl.title ?? ''} ${authorsFull(s.csl)}` : ''].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    return list;
  }
  /** matches outside the project/section: not shown, but pointed out (a quote whose
   *  source is not selected for the project would otherwise seem to be missing) */
  const elsewhere = $derived.by(() => {
    if (scope === 'library' || !q.trim()) return 0;
    const shown = new Set(inScope.map((a) => a.id));
    return matching(db.all('artifacts').filter((a) => !shown.has(a.id))).length;
  });
  const results = $derived.by(() => {
    const recent = settings.recentQuotes ?? [];
    const list = matching(inScope);
    const by: Record<PickerPrefs['sort'], (a: Artifact, b: Artifact) => number> = {
      source: (a, b) => sourceLabel(src(a)).localeCompare(sourceLabel(src(b))) || pageNum(a.page) - pageNum(b.page),
      author: (a, b) => (src(a) ? authorsFull(src(a)!.csl) : '~').localeCompare(src(b) ? authorsFull(src(b)!.csl) : '~') || pageNum(a.page) - pageNum(b.page),
      year: (a, b) => (src(b) ? yearOf(src(b)!.csl) : '').localeCompare(src(a) ? yearOf(src(a)!.csl) : '') || pageNum(a.page) - pageNum(b.page),
      added: (a, b) => b.createdAt - a.createdAt,
      recent: (a, b) => {
        const ia = recent.indexOf(a.id),
          ib = recent.indexOf(b.id);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || b.createdAt - a.createdAt;
      }
    };
    return list.sort(by[p.sort]);
  });

  /** group label(s) of an item; an item with several tags or authors shows under each */
  function groupsOf(a: Artifact): string[] {
    const s = src(a);
    switch (p.group) {
      case 'source':
        return [s ? `${sourceLabel(s)} – ${s.csl.title ?? ''}` : t('No source')];
      case 'author': {
        const names = s ? (s.csl.author?.length ? s.csl.author : (s.csl.editor ?? [])) : [];
        return names.length ? names.map((n) => familyStr(n) + (n.given ? ', ' + n.given : '')) : [t('No author')];
      }
      case 'tag':
        return visibleTags(a.tags).length ? visibleTags(a.tags).map((x) => '#' + x) : [t('Untagged')];
      case 'kind':
        return [t(a.kind)];
      case 'year':
        return [(s && yearOf(s.csl)) || t('No year')];
      default:
        return [''];
    }
  }
  /** rows to draw: group headers and items; `i` numbers the items for the keyboard */
  const rows = $derived.by(() => {
    const items = results.slice(0, limit);
    if (p.group === 'none') return items.map((a, i) => ({ a, i, head: '' }));
    const g = new Map<string, Artifact[]>();
    for (const a of items) for (const k of groupsOf(a)) (g.get(k) ?? g.set(k, []).get(k)!).push(a);
    const keys = [...g.keys()].sort((x, y) => (p.group === 'year' ? y.localeCompare(x) : x.localeCompare(y)));
    const out: { a: Artifact | null; i: number; head: string }[] = [];
    let i = 0;
    for (const k of keys) {
      out.push({ a: null, i: -1, head: k });
      for (const a of g.get(k)!) out.push({ a, i: i++, head: '' });
    }
    return out;
  });
  const flat = $derived(rows.filter((r) => r.a).map((r) => r.a!));
  const current = $derived(flat[active]);

  function pick(a: Artifact | undefined, keep = false) {
    if (!a) return;
    settings.recentQuotes = [a.id, ...(settings.recentQuotes ?? []).filter((x) => x !== a.id)].slice(0, 60);
    onpick(a.id, keep);
  }
  function move(d: number) {
    active = Math.max(0, Math.min(flat.length - 1, active + d));
    listEl?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function key(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      pick(current, e.ctrlKey || e.metaKey);
    } else if (e.key === 'Escape' && onclose) {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
  onMount(() => {
    setTimeout(() => input?.focus(), 20);
    syncZoteroSoon(); // new sources from Zotero show up while you search
  });

  // ---- actions on the marked item ----
  async function copy(mode: 'text' | 'both' | 'cite') {
    const a = current;
    if (!a) return;
    const c = a.sourceId ? (await citeArtifact(a)) || shortCite(a) : '';
    const quoted = settings.citationLocale.startsWith('de') ? `„${a.text}“` : `“${a.text}”`;
    const out = mode === 'text' ? a.text : mode === 'cite' ? c : `${a.kind === 'quote' ? quoted : a.text} ${c}`.trim();
    if (await copyText(out)) ui.toast(t('Copied'), { kind: 'ok' }, 1500);
  }
  const copyMenu = $derived([
    { label: t('Copy text'), icon: 'copy', run: () => copy('text') },
    ...(current?.sourceId
      ? [
          { label: t('Copy with citation'), icon: 'quote', run: () => copy('both') },
          { label: t('Copy citation only'), icon: 'book', run: () => copy('cite') }
        ]
      : [])
  ]);
  function newQuote() {
    ui.editArtifact = {
      kind: 'quote',
      sourceId: p.sourceId || null,
      // a quote you had to add is the one you want: insert it right away
      oncreated: (id) => onpick(id)
    };
  }

  const SORTS: [PickerPrefs['sort'], string][] = [
    ['source', 'Source & page'],
    ['author', 'Author'],
    ['year', 'Year (newest)'],
    ['added', 'Recently added'],
    ['recent', 'Recently used']
  ];
  const GROUPS: [PickerPrefs['group'], string][] = [
    ['none', 'No groups'],
    ['source', 'By source'],
    ['author', 'By author'],
    ['tag', 'By tag'],
    ['kind', 'By kind'],
    ['year', 'By year']
  ];
  const KINDS: ('quote' | 'paraphrase' | 'note')[] = ['quote', 'paraphrase', 'note'];
  const toggleKind = (k: 'quote' | 'paraphrase' | 'note') => set({ kinds: p.kinds.includes(k) ? p.kinds.filter((x) => x !== k) : [...p.kinds, k] });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="qp" onkeydown={key}>
  <div class="top">
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
        aria-activedescendant={current ? 'qp-' + current.id : undefined}
      />
      {#if q}<button class="icon-btn sm" onclick={() => ((q = ''), input.focus())} aria-label={t('Clear search')}><Icon name="x" size={14} /></button>{/if}
    </div>
    <button class="btn sm" onclick={newQuote} title={t('Add a quote that is missing, then insert it')}><Icon name="plus" size={14} />{t('New quote')}</button>
  </div>

  <div class="controls">
    <div class="seg" role="group" aria-label={t('Where from')}>
      {#if headingId}<button class:on={scope === 'section'} onclick={() => set({ scope: 'section' })} title={t('Placed under this heading')}>{t('This section')}</button>{/if}
      {#if ui.projectId}<button class:on={scope === 'project'} onclick={() => set({ scope: 'project' })}>{t('Project')}</button>{/if}
      <button class:on={scope === 'library'} onclick={() => set({ scope: 'library' })}>{t('Library')}</button>
    </div>
    <div class="kinds" role="group" aria-label={t('Type')}>
      {#each KINDS as k (k)}
        <button class="btn sm kind" class:on={p.kinds.includes(k)} aria-pressed={p.kinds.includes(k)} onclick={() => toggleKind(k)}><Icon name={k} size={13} />{t(k)}</button>
      {/each}
    </div>
    {#if ui.projectId}
      <select class="select" value={p.used} onchange={(e) => set({ used: e.currentTarget.value as PickerPrefs['used'] })} aria-label={t('Cited in the text')}>
        <option value="all">{t('Cited or not')}</option>
        <option value="unused">{t('Not yet in the text')}</option>
        <option value="used">{t('Already in the text')}</option>
      </select>
    {/if}
    <select class="select" value={p.sourceId} onchange={(e) => set({ sourceId: e.currentTarget.value })} aria-label={t('Source')}>
      <option value="">{t('All sources')}</option>
      {#each sources as s (s.id)}<option value={s.id}>{sourceLabel(s)} – {s.csl.title ?? ''}</option>{/each}
    </select>
    {#if tags.length || p.tag}
      <select class="select" value={p.tag} onchange={(e) => set({ tag: e.currentTarget.value })} aria-label={t('Tag')}>
        <option value="">{t('All tags')}</option>
        {#each tags as tg (tg)}<option value={tg}>#{tg}</option>{/each}
      </select>
    {/if}
    <select class="select" value={p.group} onchange={(e) => set({ group: e.currentTarget.value as PickerPrefs['group'] })} aria-label={t('Group by')}>
      {#each GROUPS as [v, l] (v)}<option value={v}>{t(l)}</option>{/each}
    </select>
    <select class="select" value={p.sort} onchange={(e) => set({ sort: e.currentTarget.value as PickerPrefs['sort'] })} aria-label={t('Sort')}>
      {#each SORTS as [v, l] (v)}<option value={v}>{t(l)}</option>{/each}
    </select>
    {#if changed}<button class="btn ghost sm" onclick={reset}><Icon name="undo" size={13} />{t('Reset')}</button>{/if}
  </div>

  <div class="count tiny muted" aria-live="polite">
    {t('{n} found', { n: results.length })}
    {#if zsync.running}<span class="syncing">· {t('checking Zotero…')}</span>{/if}
    {#if elsewhere}
      · <button class="lnk" onclick={() => set({ scope: 'library' })}>{t('{n} more in the library (not selected for this project) – show', { n: elsewhere })}</button>
    {/if}
  </div>
  <div class="body">
    <div class="list" id="qp-list" role="listbox" aria-label={t('Quotes')} bind:this={listEl}>
      {#each rows as r, ri (r.a ? r.a.id + ':' + ri : 'h:' + r.head)}
        {#if !r.a}
          <div class="gh tiny" role="presentation">{r.head}</div>
        {:else}
          {@const a = r.a}
          {@const s = src(a)}
          <button
            id={'qp-' + a.id}
            data-i={r.i}
            role="option"
            aria-selected={r.i === active}
            class="hit k-{a.kind}"
            class:on={r.i === active}
            onmouseenter={() => (active = r.i)}
            onclick={(e) => pick(a, e.ctrlKey || e.metaKey)}
          >
            <span class="txt">{a.title ? a.title + ' — ' : ''}{a.text}</span>
            <span class="meta tiny muted">
              <Icon name={a.kind} size={11} />
              <span class="cite">{s ? shortCite(a) : t('No source')}</span>
              {#if cited.get(a.id)}<span class="used" title={t('Already cited in the text')}>✓ {t('in text')}</span>{/if}
              {#if s?.csl.title}<span class="st">· {s.csl.title}</span>{/if}
            </span>
          </button>
        {/if}
      {:else}
        <div class="empty small muted">
          {#if scope === 'section'}{t('Nothing placed under this heading yet.')}{:else}{t('Nothing matches.')}{/if}
          {#if changed || q}<button class="btn sm" onclick={() => ((q = ''), reset())}>{t('Reset search and filters')}</button>{/if}
          <button class="btn sm" onclick={newQuote}><Icon name="plus" size={13} />{t('New quote')}</button>
        </div>
      {/each}
      {#if results.length > limit}
        <button class="btn ghost sm more" onclick={() => (limit += LIMIT_STEP)}>{t('Show {n} more', { n: Math.min(LIMIT_STEP, results.length - limit) })}</button>
      {/if}
    </div>

    {#if current}
      {@const s = src(current)}
      <aside class="preview" aria-label={t('Preview')}>
        <div class="pv scrollable">
          {#if current.title}<strong>{current.title}</strong>{/if}
          {#if current.kind === 'note'}
            <div class="md">{@html renderMd(current.text)}</div>
          {:else}
            <p class="ptext" class:q={current.kind === 'quote'}>{current.text}</p>
          {/if}
          {#if current.comment}<p class="pcomment small"><Icon name="comment" size={12} /> {current.comment}</p>{/if}
          {#if current.fullText}<details class="small"><summary>{t('Context / full text')}</summary><p class="ctx">{current.fullText}</p></details>{/if}
          <p class="psrc tiny muted">
            {#if s}{authorsFull(s.csl)}{yearOf(s.csl) ? ` (${yearOf(s.csl)})` : ''}: {s.csl.title}{current.page ? ` · ${t('p.')} ${current.page}` : ''}{:else}{t('No source')}{/if}
            {#if visibleTags(current.tags).length}<br />{visibleTags(current.tags).map((x) => '#' + x).join(' ')}{/if}
            {#if cited.get(current.id)}<br />{t('Cited {n}× in the text', { n: cited.get(current.id)! })}{/if}
          </p>
        </div>
        <div class="pact">
          <button class="btn primary sm" onclick={() => pick(current)} title="Enter · {t('Ctrl+Enter: insert and keep this open')}"><Icon name="plus" size={14} />{t('Insert')}</button>
          <button class="btn sm" onclick={() => (ui.editArtifact = { id: current!.id })}><Icon name="edit" size={14} />{t('Edit')}</button>
          <Menu items={copyMenu} label={t('Copy')}>
            {#snippet trigger()}<Icon name="copy" size={14} />{t('Copy')}{/snippet}
          </Menu>
        </div>
      </aside>
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
  .top {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .search {
    flex: 1;
    min-width: 0;
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
    max-width: 200px;
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
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
  }
  .list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 2px;
    height: min(50vh, 440px);
    overflow-y: auto;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .gh {
    position: sticky;
    top: -2px;
    z-index: 1;
    padding: 6px 8px 3px;
    background: var(--surface);
    color: var(--muted);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  .lnk {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    font: inherit;
  }
  .used {
    color: var(--ok);
    font-weight: 600;
  }
  .preview {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: 8px;
    height: min(50vh, 440px);
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    min-width: 0;
  }
  .pv {
    overflow-y: auto;
    min-height: 0;
  }
  .ptext {
    margin: 0 0 8px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.55;
  }
  .ptext.q {
    font-style: italic;
  }
  .pcomment {
    margin: 0 0 8px;
    padding: 4px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
  .ctx {
    white-space: pre-wrap;
    color: var(--muted);
  }
  .psrc {
    margin: 8px 0 0;
  }
  .pact {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
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
  @media (max-width: 700px) {
    /* phones: the list, and the preview of the marked quote below it */
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .list {
      height: 38vh;
    }
    .preview {
      height: auto;
      max-height: 30vh;
    }
    .controls .select {
      max-width: 100%;
      flex: 1 1 40%;
    }
  }
</style>
