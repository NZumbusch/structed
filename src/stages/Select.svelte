<script lang="ts">
  // "Auswählen": pick the sources and quotes this project needs, from the whole library.
  import { SvelteSet } from 'svelte/reactivity';
  import Icon from '../components/Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { draggable, droppable } from '../lib/dnd';
  import {
    addToProject,
    artifactLabel,
    authorsFull,
    membership,
    removeFromProject,
    removeSourceFromProject,
    shortCite,
    sourceLabel,
    sourceSelected,
    yearOf
  } from '../lib/ops';
  import type { Artifact, Project, Source } from '../lib/types';

  let { project }: { project: Project } = $props();

  let q = $state('');
  let onlyMissing = $state(false);
  let side = $state<'library' | 'project'>('library'); // phone: which column is shown
  const openSrc = new SvelteSet<string>();
  const openItem = new SvelteSet<string>();

  const NONE = '~none';
  const pn = (p?: string) => +(p?.match(/\d+/)?.[0] ?? 1e9);
  const byPage = (a: Artifact, b: Artifact) => pn(a.page) - pn(b.page) || a.createdAt - b.createdAt;

  function groupBySource(items: Artifact[]) {
    const m = new Map<string, Artifact[]>();
    for (const a of items) {
      const k = db.get('sources', a.sourceId) ? a.sourceId! : NONE;
      (m.get(k) ?? m.set(k, []).get(k)!).push(a);
    }
    for (const l of m.values()) l.sort(byPage);
    return m;
  }
  const label = (sid: string) => (sid === NONE ? t('Own notes & unsourced') : sourceLabel(db.get('sources', sid)));
  const title = (sid: string) => (sid === NONE ? '' : (db.get('sources', sid)?.csl.title ?? ''));

  // ---------- left: library ----------
  const library = $derived.by(() => {
    const qq = q.trim().toLowerCase();
    const items = db.all('artifacts').filter((a) => {
      if (onlyMissing && membership(a, project.id)) return false;
      if (!qq) return true;
      const s = db.get('sources', a.sourceId);
      return `${a.title} ${a.text} ${a.comment} ${a.tags.join(' ')} ${s ? sourceLabel(s) + ' ' + s.csl.title + ' ' + authorsFull(s.csl) : ''}`
        .toLowerCase()
        .includes(qq);
    });
    const g = groupBySource(items);
    // sources without items still appear (e.g. fresh Zotero import) unless searching/filtering
    if (!qq && !onlyMissing) for (const s of db.all('sources')) if (!g.has(s.id)) g.set(s.id, []);
    return [...g.entries()].sort((a, b) => (a[0] === NONE ? 1 : b[0] === NONE ? -1 : label(a[0]).localeCompare(label(b[0]))));
  });

  // ---------- right: this project ----------
  const chosen = $derived(db.all('artifacts').filter((a) => membership(a, project.id)));
  const chosenGroups = $derived.by(() => {
    const g = groupBySource(chosen);
    for (const x of db.all('selections'))
      if (x.projectId === project.id && x.refType === 'source' && db.get('sources', x.refId) && !g.has(x.refId)) g.set(x.refId, []);
    return [...g.entries()].sort((a, b) => (a[0] === NONE ? 1 : b[0] === NONE ? -1 : label(a[0]).localeCompare(label(b[0]))));
  });
  const placedCount = $derived(chosen.filter((a) => membership(a, project.id) === 'placed').length);

  function addSource(sid: string) {
    if (sid === NONE) {
      for (const a of db.all('artifacts')) if (!db.get('sources', a.sourceId)) addToProject(project.id, 'artifact', a.id);
    } else addToProject(project.id, 'source', sid);
  }
  function srcState(sid: string, items: Artifact[]): 'all' | 'some' | 'none' {
    if (sid !== NONE && sourceSelected(sid, project.id)) return 'all';
    const n = items.filter((a) => membership(a, project.id)).length;
    return n === 0 ? 'none' : n === items.length && items.length > 0 ? 'all' : 'some';
  }
  function removeSource(sid: string, items: Artifact[]) {
    if (sid !== NONE) removeSourceFromProject(project.id, sid);
    for (const a of items) if (membership(a, project.id) === 'item') removeFromProject(project.id, a);
    ui.toast(t('Removed from project'), { action: { label: t('Undo'), run: () => db.undo() } });
  }
  const why = (a: Artifact) => membership(a, project.id);
</script>

<div class="select" data-side={side} data-tour="select">
  {#if ui.narrow}
    <div class="seg switch">
      <button class:on={side === 'library'} onclick={() => (side = 'library')}>{t('Library')}</button>
      <button class:on={side === 'project'} onclick={() => (side = 'project')}>{t('In this project')} ({chosen.length})</button>
    </div>
  {/if}

  <section class="col lib" aria-label={t('Library')}>
    <header>
      <h2>{t('Library')}</h2>
      <div class="search">
        <Icon name="search" size={15} />
        <input placeholder={t('Search quotes, notes, sources…')} bind:value={q} aria-label={t('Search')} />
      </div>
      <label class="row small"><input type="checkbox" bind:checked={onlyMissing} />{t('Only items not in this project')}</label>
    </header>
    <div class="list scroll">
      {#each library as [sid, items] (sid)}
        {@const st = srcState(sid, items)}
        <div class="src" class:open={openSrc.has(sid) || !!q.trim()}>
          <div class="srow">
            <button class="sname" onclick={() => (openSrc.has(sid) ? openSrc.delete(sid) : openSrc.add(sid))} aria-expanded={openSrc.has(sid)}>
              <Icon name={openSrc.has(sid) || q.trim() ? 'chevron-down' : 'chevron-right'} size={14} />
              <span class="grow ellipsis"><strong>{label(sid)}</strong> <span class="muted">{title(sid)}</span></span>
              <span class="cnt">{items.length}</span>
            </button>
            {#if st === 'all'}
              <span class="state" title={t('Whole source is in this project')}><Icon name="check" size={14} /></span>
            {:else}
              <button class="btn sm add" onclick={() => addSource(sid)} title={t('Add the whole source (also future quotes)')}>
                <Icon name="plus" size={13} />{t('Source')}
              </button>
            {/if}
          </div>
          {#if openSrc.has(sid) || q.trim()}
            <div class="items">
              {#each items as a (a.id)}
                {@const m = why(a)}
                <div class="it k-{a.kind}" class:in={!!m} use:draggable={{ payload: { type: 'artifact', id: a.id, label: artifactLabel(a, 60) }, disabled: !!m }}>
                  <button class="itext" onclick={() => (openItem.has(a.id) ? openItem.delete(a.id) : openItem.add(a.id))}>
                    <span class:clamp={!openItem.has(a.id)}>{a.title || a.text}</span>
                    <span class="tiny muted">{a.page ? `${t('p.')} ${a.page}` : ''}{a.tags.length ? ' · #' + a.tags.join(' #') : ''}</span>
                  </button>
                  {#if m}
                    <span class="state" title={m === 'placed' ? t('Placed under a heading') : t('In this project')}><Icon name="check" size={14} /></span>
                  {:else}
                    <button class="icon-btn sm" title={t('Add to this project')} onclick={() => addToProject(project.id, 'artifact', a.id)}><Icon name="plus" size={15} /></button>
                  {/if}
                </div>
              {:else}
                <p class="tiny muted pad">{t('No quotes yet – adding the source includes future quotes.')}</p>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="empty small">{t('Nothing found')}</div>
      {/each}
    </div>
  </section>

  <section
    class="col proj"
    aria-label={t('In this project')}
    use:droppable={{
      accepts: (p) => p.type === 'artifact',
      onDrop: (p) => addToProject(project.id, 'artifact', p.id)
    }}
  >
    <header>
      <h2>{t('In this project')}</h2>
      <p class="small muted">{t('{n} items · {p} placed under headings', { n: chosen.length, p: placedCount })}</p>
    </header>
    <div class="list scroll">
      {#each chosenGroups as [sid, items] (sid)}
        {@const whole = sid !== NONE && sourceSelected(sid, project.id)}
        <div class="src open">
          <div class="srow">
            <span class="sname static">
              <span class="grow ellipsis"><strong>{label(sid)}</strong> {#if whole}<span class="chip">{t('whole source')}</span>{/if}</span>
              <span class="cnt">{items.length}</span>
            </span>
            <button class="icon-btn sm" title={t('Remove source from project')} onclick={() => removeSource(sid, items)}><Icon name="x" size={14} /></button>
          </div>
          <div class="items">
            {#each items as a (a.id)}
              {@const m = why(a)}
              <div class="it k-{a.kind}">
                <button class="itext" onclick={() => (openItem.has('p' + a.id) ? openItem.delete('p' + a.id) : openItem.add('p' + a.id))}>
                  <span class:clamp={!openItem.has('p' + a.id)}>{a.title || a.text}</span>
                  <span class="tiny muted">{shortCite(a)}{m === 'placed' ? ' · ' + t('placed') : ''}</span>
                </button>
                {#if m !== 'placed'}
                  <button class="icon-btn sm" title={t('Remove from project')} onclick={() => removeFromProject(project.id, a)}><Icon name="x" size={14} /></button>
                {:else}
                  <span class="state" title={t('Placed under a heading')}><Icon name="layers" size={14} /></span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="empty small">
          <Icon name="layers" size={28} />
          <p>{t('Nothing selected yet. Add whole sources or single quotes from the library – or drag them here.')}</p>
        </div>
      {/each}
    </div>
    {#if chosen.length}
      <footer class="small"><button class="btn sm" onclick={() => (ui.stage = 'arrange')}>{t('Continue to Arrange')} <Icon name="chevron-right" size={14} /></button></footer>
    {/if}
  </section>
</div>

<style>
  .select {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .lib {
    border-right: 1px solid var(--border);
  }
  .proj {
    background: var(--surface);
  }
  header {
    display: grid;
    gap: 8px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    font-size: 1rem;
  }
  header p {
    margin: 0;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
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
  .list {
    flex: 1;
    min-height: 0;
    padding: 6px 10px 40px;
  }
  .srow {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sname {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text);
  }
  .sname:hover:not(.static) {
    background: var(--surface-2);
  }
  .sname.static {
    cursor: default;
  }
  .sname .muted {
    margin-left: 4px;
  }
  .cnt {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .add {
    flex: none;
  }
  .state {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    color: var(--ok);
    flex: none;
  }
  .items {
    display: grid;
    gap: 2px;
    padding: 0 0 8px 20px;
  }
  .it {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 2px 2px 2px 8px;
    border-left: 3px solid var(--k-quote);
    border-radius: 4px;
    cursor: grab;
    touch-action: pan-y;
  }
  .it.k-paraphrase {
    border-left-color: var(--k-paraphrase);
  }
  .it.k-note {
    border-left-color: var(--k-note);
  }
  .it.k-image {
    border-left-color: var(--k-image);
  }
  .it.in {
    cursor: default;
  }
  .it.in .itext > span:first-child {
    color: var(--muted);
  }
  .it:hover {
    background: var(--surface-2);
  }
  .itext {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 1px;
    padding: 4px 0;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .pad {
    padding: 4px 8px;
    margin: 0;
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 8px;
    color: var(--muted);
  }
  footer {
    padding: 8px 16px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
  }
  .switch {
    display: none;
  }
  @media (max-width: 700px) {
    .select {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }
    .switch {
      display: flex;
      margin: 8px 12px 0;
      justify-self: start;
    }
    .select[data-side='library'] .proj,
    .select[data-side='project'] .lib {
      display: none;
    }
    .lib {
      border-right: 0;
    }
  }
</style>
