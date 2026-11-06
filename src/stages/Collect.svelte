<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import Icon from '../components/Icon.svelte';
  import Menu from '../components/Menu.svelte';
  import ArtifactCard from '../components/ArtifactCard.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { addToProject, authorsFull, deleteArtifact, deleteSource, mergeSource, projectsOf, removeFromProject, sourceLabel, yearOf } from '../lib/ops';
  import Modal from '../components/Modal.svelte';
  import type { MenuItem } from '../lib/ui.svelte';
  import { referenceOf } from '../lib/cite';
  import { cleanText } from '../lib/ocr';
  import type { Artifact, ArtifactKind } from '../lib/types';
  import { longpress } from '../lib/longpress';

  let q = $state('');
  let sort = $state<'author' | 'year' | 'added' | 'items'>('author');
  const selected = new SvelteSet<string>();

  // quick capture
  let qKind = $state<ArtifactKind>('quote');
  let qText = $state('');
  let qPage = $state('');
  let qTags = $state('');
  let ref = $state('');

  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const a of db.all('artifacts')) m.set(a.sourceId ?? '~none', (m.get(a.sourceId ?? '~none') ?? 0) + 1);
    return m;
  });

  const sources = $derived.by(() => {
    const qq = q.trim().toLowerCase();
    let list = db.all('sources');
    if (qq) list = list.filter((s) => `${sourceLabel(s)} ${s.csl.title} ${authorsFull(s.csl)} ${s.tags.join(' ')}`.toLowerCase().includes(qq));
    const by = {
      author: (a: typeof list[0], b: typeof list[0]) => sourceLabel(a).localeCompare(sourceLabel(b)),
      year: (a: typeof list[0], b: typeof list[0]) => yearOf(b.csl).localeCompare(yearOf(a.csl)),
      added: (a: typeof list[0], b: typeof list[0]) => b.createdAt - a.createdAt,
      items: (a: typeof list[0], b: typeof list[0]) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0)
    }[sort];
    return list.sort(by);
  });

  const sel = $derived(ui.collectSourceId);
  const source = $derived(sel && sel !== '~none' && sel !== '~all' ? db.get('sources', sel) : undefined);
  // cleanup views across all projects
  const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120);
  const dupeKeys = $derived.by(() => {
    const c = new Map<string, number>();
    for (const a of db.all('artifacts')) if (a.text.trim().length > 15) c.set(norm(a.text), (c.get(norm(a.text)) ?? 0) + 1);
    return new Set([...c].filter(([, n]) => n > 1).map(([k]) => k));
  });
  const VIEWS: Record<string, (a: Artifact) => boolean> = {
    '~all': () => true,
    '~none': (a) => !db.get('sources', a.sourceId),
    '~orphan': (a) => projectsOf(a).length === 0,
    '~nopage': (a) => (a.kind === 'quote' || a.kind === 'paraphrase') && !!db.get('sources', a.sourceId) && !a.page?.trim(),
    '~dupes': (a) => dupeKeys.has(norm(a.text))
  };
  const viewCount = (v: string) => db.all('artifacts').filter(VIEWS[v]).length;
  const VIEW_LABEL: Record<string, string> = {
    '~all': 'All items',
    '~none': 'Own notes & unsourced',
    '~orphan': 'In no project',
    '~nopage': 'Without page number',
    '~dupes': 'Possible duplicates'
  };

  const items = $derived.by(() => {
    const all = db.all('artifacts');
    const v = sel ? VIEWS[sel] : undefined;
    const list = v ? all.filter(v) : all.filter((a) => a.sourceId === sel);
    if (sel === '~dupes') return list.sort((a, b) => norm(a.text).localeCompare(norm(b.text)));
    const pn = (p?: string) => +(p?.match(/\d+/)?.[0] ?? 1e9);
    return list.sort((a, b) => pn(a.page) - pn(b.page) || a.createdAt - b.createdAt);
  });

  $effect(() => {
    sel;
    selected.clear();
    itemPick = false;
  });
  /** selecting items: started by a long-press, Ctrl-click, a checkbox or "Select" */
  let itemPick = $state(false);
  const selecting = $derived(itemPick || selected.size > 0);
  function endItemPick() {
    selected.clear();
    itemPick = false;
  }
  function toggleItem(id: string, v: boolean) {
    if (v) selected.add(id);
    else selected.delete(id);
    // a selection started on the phone ends with the last tick removed
    if (!selected.size && ui.narrow) itemPick = false;
  }
  // the back gesture / Esc ends a selection before anything else
  $effect(() => {
    const on = selecting || picked.size > 0 || pickMode;
    ui.selection = on ? () => (endItemPick(), endPick()) : null;
    return () => (ui.selection = null);
  });
  $effect(() => {
    if (!source) {
      ref = '';
      return;
    }
    const s = source;
    JSON.stringify(s.csl); // track deep changes
    referenceOf(s).then((r) => (ref = r)).catch(() => (ref = ''));
  });

  function capture() {
    if (!qText.trim()) return;
    db.create('artifacts', {
      kind: qKind,
      sourceId: source?.id ?? null,
      text: qKind === 'note' ? qText.trim() : cleanText(qText),
      page: qPage.trim(),
      tags: qTags.split(/[,\s]+/).map((x) => x.replace(/^#/, '')).filter(Boolean),
      comment: ''
    });
    qText = '';
    qPage = '';
  }
  function captureKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      capture();
    }
  }

  function bulk(action: 'delete' | 'clean' | 'tag' | 'kind', arg?: string) {
    const list = items.filter((a) => selected.has(a.id));
    if (!list.length) return;
    db.batch('bulk ' + action, () => {
      for (const a of list) {
        if (action === 'delete') deleteArtifact(a);
        else if (action === 'clean') db.update('artifacts', a.id, { text: cleanText(a.text), fullText: a.fullText ? cleanText(a.fullText) : a.fullText });
        else if (action === 'tag' && arg) db.update('artifacts', a.id, { tags: [...new Set([...a.tags, arg])] });
        else if (action === 'kind' && arg) db.update('artifacts', a.id, { kind: arg as ArtifactKind });
      }
    });
    selected.clear();
    ui.toast(t('{n} items updated', { n: list.length }), { action: { label: t('Undo'), run: () => db.undo() } });
  }

  function bulkProject(pid: string, add: boolean) {
    const list = items.filter((a) => selected.has(a.id));
    db.batch(add ? 'add to project' : 'remove from project', () => {
      for (const a of list) add ? addToProject(pid, 'artifact', a.id) : removeFromProject(pid, a);
    });
    selected.clear();
    const p = db.get('projects', pid);
    ui.toast(t(add ? '{n} items added to “{p}”' : '{n} items removed from “{p}”', { n: list.length, p: p?.title ?? '' }), { action: { label: t('Undo'), run: () => db.undo() } });
  }
  const projects = $derived(db.all('projects').sort((a, b) => b.updatedAt - a.updatedAt));

  // ---------- several sources at once ----------
  const picked = new SvelteSet<string>();
  let pickMode = $state(false);
  let anchor: string | null = null;
  let delOpen = $state(false);
  const showChecks = $derived(pickMode || picked.size > 1);
  const pickedSources = $derived(sources.filter((x) => picked.has(x.id)));
  const pickedItems = $derived(db.all('artifacts').filter((a) => a.sourceId && picked.has(a.sourceId)).length);

  function endPick() {
    pickMode = false;
    picked.clear();
  }
  function srcClick(e: MouseEvent, id: string) {
    if (e.shiftKey && anchor) {
      const ids = sources.map((x) => x.id);
      const [i, j] = [ids.indexOf(anchor), ids.indexOf(id)].sort((x, y) => x - y);
      if (i >= 0) ids.slice(i, j + 1).forEach((x) => picked.add(x));
      return;
    }
    if (e.ctrlKey || e.metaKey || pickMode) {
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      anchor = id;
      if (!picked.size && ui.narrow) endPick();
      return;
    }
    picked.clear();
    anchor = id;
    ui.collectSourceId = id;
  }
  function listKey(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && picked.size && !(e.target as HTMLElement).closest('input,textarea')) {
      e.preventDefault();
      delOpen = true;
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !(e.target as HTMLElement).closest('input,textarea')) {
      e.preventDefault();
      sources.forEach((x) => picked.add(x.id));
    } else if (e.key === 'Escape' && picked.size) endPick();
  }

  function tagSources() {
    const v = prompt(t('Tag'))?.trim().replace(/^#/, '');
    if (!v) return;
    db.batch('tag sources', () => pickedSources.forEach((x) => db.update('sources', x.id, { tags: [...new Set([...x.tags, v])] })));
  }
  function addSourcesTo(pid: string) {
    db.batch('add sources to project', () => pickedSources.forEach((x) => addToProject(pid, 'source', x.id)));
    const p = db.get('projects', pid);
    ui.toast(t('{n} sources added to “{p}”', { n: pickedSources.length, p: p?.title ?? '' }), { action: { label: t('Undo'), run: () => db.undo() } });
  }
  function mergeInto(targetId: string) {
    const target = db.get('sources', targetId);
    if (!target) return;
    const others = pickedSources.filter((x) => x.id !== targetId);
    let n = 0;
    db.batch('merge sources', () => others.forEach((x) => (n += mergeSource(x, target))));
    picked.clear();
    picked.add(targetId);
    ui.collectSourceId = targetId;
    ui.toast(t('{n} sources merged into “{s}” ({m} items moved)', { n: others.length, s: sourceLabel(target), m: n }), { action: { label: t('Undo'), run: () => db.undo() } });
  }
  function deletePicked(withItems: boolean) {
    const list = pickedSources;
    db.batch('delete sources', () => list.forEach((x) => deleteSource(x, withItems)));
    if (sel && picked.has(sel)) ui.collectSourceId = null;
    delOpen = false;
    endPick();
    ui.toast(t('{n} sources deleted', { n: list.length }), { action: { label: t('Undo'), run: () => db.undo() } });
  }

  const pickMenu: MenuItem[] = $derived([
    ...projects.map((p) => ({ label: t('Add to “{p}”', { p: p.title || t('Untitled project') }), icon: 'plus', run: () => { addSourcesTo(p.id); } })),
    ...(projects.length ? [null] : []),
    ...(pickedSources.length > 1
      ? pickedSources.slice(0, 8).map((x) => ({ label: t('Merge all into “{s}”', { s: sourceLabel(x) }), icon: 'layers', run: () => { mergeInto(x.id); } }))
      : []),
    { label: t('Add tag…'), icon: 'tag', run: tagSources },
    null,
    { label: t('Delete…'), icon: 'trash', danger: true, run: () => { delOpen = true; } }
  ]);

  function srcContext(e: MouseEvent, id: string) {
    if (!picked.has(id)) {
      picked.clear();
      picked.add(id);
      anchor = id;
    }
    const single = picked.size === 1;
    const s = db.get('sources', id);
    ui.openContext(
      e,
      [
        ...(single
          ? [
              { label: t('Open'), icon: 'book', run: () => { picked.clear(); ui.collectSourceId = id; } },
              { label: t('Edit'), icon: 'edit', run: () => (ui.editSource = { id }) },
              null
            ]
          : []),
        ...pickMenu
      ],
      single ? sourceLabel(s) : t('{n} selected', { n: picked.size })
    );
  }

  const bulkMenu = $derived([
    ...projects.map((p) => ({ label: t('Add to “{p}”', { p: p.title || t('Untitled project') }), icon: 'plus', run: () => bulkProject(p.id, true) })),
    ...(projects.length ? [null] : []),
    { label: t('Clean up text (OCR/PDF)'), icon: 'sparkle', run: () => bulk('clean') },
    { label: t('Add tag…'), icon: 'tag', run: () => { const v = prompt(t('Tag')); if (v) bulk('tag', v.trim().replace(/^#/, '')); } },
    { label: t('Make quotes'), icon: 'quote', run: () => bulk('kind', 'quote') },
    { label: t('Make paraphrases'), icon: 'paraphrase', run: () => bulk('kind', 'paraphrase') },
    { label: t('Make notes'), icon: 'note', run: () => bulk('kind', 'note') },
    null,
    { label: t('Delete selected'), icon: 'trash', danger: true, run: () => bulk('delete') }
  ]);
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && selecting && !ui.dialog && !ui.editArtifact && !ui.editSource && !ui.question && !(e.target as HTMLElement).closest?.('input,textarea')) endItemPick();
  }}
/>

<div class="collect" class:detail={ui.narrow && !!sel}>
  <div class="srcs" data-tour="sources">
    <div class="stop">
      <div class="row">
        <input class="input grow" placeholder={t('Filter sources…')} bind:value={q} />
        <button class="icon-btn" title={t('New source')} onclick={() => (ui.editSource = {})}><Icon name="plus" /></button>
        <button class="icon-btn" data-tour="zotero" title={t('Import from Zotero…')} onclick={() => (ui.dialog = 'zotero')}><Icon name="download" /></button>
      </div>
      <div class="row tiny muted">
        {t('Sort')}:
        {#each ['author', 'year', 'added', 'items'] as s (s)}
          <button class="lnk" class:on={sort === s} onclick={() => (sort = s as typeof sort)}>{t(s)}</button>
        {/each}
        <span class="grow"></span>
        <button class="lnk" class:on={pickMode} onclick={() => (pickMode ? endPick() : (pickMode = true))} title={t('Select several sources (or Ctrl/⌘-click, Shift-click)')}>{t('Select')}</button>
      </div>
    </div>
    {#if showChecks}
      <div class="pickbar row small" role="toolbar" aria-label={t('Selected sources')}>
        <span class="grow">{t('{n} selected', { n: picked.size })}</span>
        <button class="btn ghost sm" onclick={() => sources.forEach((x) => picked.add(x.id))}>{t('All')}</button>
        <Menu items={pickMenu} label={t('Actions for selected sources')} />
        <button class="icon-btn sm danger" disabled={!picked.size} title={t('Delete selected sources')} aria-label={t('Delete selected sources')} onclick={() => (delOpen = true)}><Icon name="trash" size={15} /></button>
        <button class="icon-btn sm" title={t('Done')} aria-label={t('End selection')} onclick={endPick}><Icon name="x" size={15} /></button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="slist scroll" onkeydown={listKey}>
      <button class="src special" class:on={sel === '~all'} onclick={() => (ui.collectSourceId = '~all')}>
        <span class="grow">{t('All items')}</span><span class="cnt">{db.all('artifacts').length}</span>
      </button>
      <button class="src special" class:on={sel === '~none'} onclick={() => (ui.collectSourceId = '~none')}>
        <span class="grow">{t('Own notes & unsourced')}</span><span class="cnt">{counts.get('~none') ?? 0}</span>
      </button>
      <div class="views">
        <span class="tiny muted vh">{t('Clean up')}</span>
        {#each ['~orphan', '~nopage', '~dupes'] as v (v)}
          <button class="src special sub" class:on={sel === v} onclick={() => (ui.collectSourceId = v)}>
            <span class="grow">{t(VIEW_LABEL[v])}</span><span class="cnt">{viewCount(v)}</span>
          </button>
        {/each}
      </div>
      <div class="tiny muted vh">{t('Sources')} ({sources.length})</div>
      {#each sources as s (s.id)}
        <button
          class="src"
          class:on={sel === s.id}
          class:picked={picked.has(s.id)}
          aria-pressed={showChecks ? picked.has(s.id) : undefined}
          onclick={(e) => srcClick(e, s.id)}
          oncontextmenu={(e) => srcContext(e, s.id)}
          use:longpress={{ run: () => { pickMode = true; picked.add(s.id); anchor = s.id; } }}
        >
          {#if showChecks}<span class="ck" aria-hidden="true">{#if picked.has(s.id)}<Icon name="check" size={12} />{/if}</span>{/if}
          <span class="grow">
            <span class="sl">{sourceLabel(s)}</span>
            <span class="st ellipsis">{s.csl.title}</span>
          </span>
          {#if counts.get(s.id)}<span class="cnt">{counts.get(s.id)}</span>{/if}
        </button>
      {:else}
        <div class="empty small">
          <p>{t('No sources yet.')}</p>
          <button class="btn sm" onclick={() => (ui.dialog = 'zotero')}>{t('Import from Zotero…')}</button>
        </div>
      {/each}
    </div>
  </div>

  <div class="main scroll">
    {#if !sel}
      <div class="empty">
        <Icon name="book" size={32} />
        <p>{t('Choose a source to collect quotes, or “Own notes” for free ideas.')}</p>
      </div>
    {:else}
      <div class="inner">
        {#if ui.narrow}
          <button class="btn ghost sm" onclick={() => (ui.collectSourceId = null)}><Icon name="chevron-left" size={14} />{t('Sources')}</button>
        {/if}
        {#if source}
          <header class="sh">
            <div class="row">
              <h2 class="grow">{source.csl.title || t('Untitled')}</h2>
              <button class="btn sm" onclick={() => (ui.editSource = { id: source.id })}><Icon name="edit" size={14} />{t('Edit')}</button>
            </div>
            <p class="muted small">{authorsFull(source.csl)}{yearOf(source.csl) ? ` · ${yearOf(source.csl)}` : ''}</p>
            {#if ref}<p class="ref">{ref}</p>{/if}
            {#if source.note}<p class="small">{source.note}</p>{/if}
            {#if source.zoteroKey}
              <button class="btn sm" onclick={() => { ui.zoteroFor = source.id; ui.dialog = 'zotero'; }}>
                <Icon name="download" size={14} />{t('Import Zotero highlights…')}
              </button>
            {/if}
          </header>
        {:else}
          <h2 class="sh">{t(VIEW_LABEL[sel] ?? 'All items')}</h2>
          {#if sel === '~orphan'}<p class="small muted">{t('Quotes and notes that are neither selected for nor placed in any project.')}</p>{/if}
          {#if sel === '~dupes'}<p class="small muted">{t('Items with (almost) the same text, sorted next to each other.')}</p>{/if}
        {/if}

        {#if sel === '~none' || !sel?.startsWith('~')}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="capture card" data-tour="capture" onkeydown={captureKey}>
            <div class="row">
              <div class="seg">
                {#each ['quote', 'paraphrase', 'note'] as k (k)}
                  <button class:on={qKind === k} onclick={() => (qKind = k as ArtifactKind)}>{t(k)}</button>
                {/each}
              </div>
              <span class="grow"></span>
              <button class="btn ghost sm" onclick={() => (ui.editArtifact = { kind: 'image', sourceId: source?.id ?? null })}><Icon name="image" size={14} />{t('Image')}</button>
            </div>
            <textarea class="textarea" rows="3" bind:value={qText} placeholder={qKind === 'quote' ? t('Paste or type a quote… (Ctrl+Enter to add)') : t('Write… (Ctrl+Enter to add)')}></textarea>
            <div class="row">
              <input class="input page" bind:value={qPage} placeholder={t('Page')} />
              <input class="input grow" bind:value={qTags} placeholder={t('#tags, comma separated')} />
              <button class="btn primary" onclick={capture} disabled={!qText.trim()}><Icon name="plus" size={14} />{t('Add')}</button>
            </div>
          </div>
        {/if}

        {#if items.length}
          {#if selecting}
            <div class="selbar row small" role="toolbar" aria-label={t('Selected items')}>
              <button class="icon-btn sm" title={t('End selection')} aria-label={t('End selection')} onclick={endItemPick}><Icon name="x" size={16} /></button>
              <strong class="grow">{t('{n} selected', { n: selected.size })}</strong>
              <button class="btn ghost sm" onclick={() => (selected.size === items.length ? selected.clear() : items.forEach((a) => selected.add(a.id)))}>
                {selected.size === items.length ? t('None') : t('All')}
              </button>
              <button class="icon-btn sm" disabled={!selected.size} title={t('Add tag…')} aria-label={t('Add tag…')} onclick={() => { const v = prompt(t('Tag')); if (v) bulk('tag', v.trim().replace(/^#/, '')); }}><Icon name="tag" size={16} /></button>
              <Menu items={bulkMenu} label={t('Bulk actions')} icon="more" />
              <button class="icon-btn sm danger" disabled={!selected.size} title={t('Delete selected')} aria-label={t('Delete selected')} onclick={() => bulk('delete')}><Icon name="trash" size={16} /></button>
            </div>
          {:else}
            <div class="row bulk small">
              {#if ui.narrow}
                <span class="muted grow">{items.length} {t('items')} · {t('hold one to select')}</span>
                <button class="lnk" onclick={() => (itemPick = true)}>{t('Select')}</button>
              {:else}
                <label class="row"><input type="checkbox" checked={false} onchange={(e) => e.currentTarget.checked && items.forEach((a) => selected.add(a.id))} />{t('Select all')}</label>
                <span class="muted">{items.length} {t('items')}</span>
              {/if}
            </div>
          {/if}
        {/if}
        <div class="items" class:selpad={selecting && ui.narrow}>
          {#each items as a (a.id)}
            <ArtifactCard {a} context="collect" selectable {selecting} selected={selected.has(a.id)} onselect={(v) => toggleItem(a.id, v)} />
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

{#if delOpen}
  <Modal title={t('Delete sources')} onclose={() => (delOpen = false)} width="480px">
    <p>{t('Delete {n} sources?', { n: pickedSources.length })}</p>
    <ul class="small dl">
      {#each pickedSources.slice(0, 6) as x (x.id)}<li>{sourceLabel(x)} – {x.csl.title}</li>{/each}
      {#if pickedSources.length > 6}<li>… {t('and {n} more', { n: pickedSources.length - 6 })}</li>{/if}
    </ul>
    {#if pickedItems}<p class="small muted">{t('They contain {n} quotes and notes.', { n: pickedItems })}</p>{/if}
    {#snippet footer()}
      <button class="btn" onclick={() => (delOpen = false)}>{t('Cancel')}</button>
      <span class="grow"></span>
      {#if pickedItems}<button class="btn" onclick={() => deletePicked(false)}>{t('Delete, keep items')}</button>{/if}
      <button class="btn primary danger-bg" onclick={() => deletePicked(true)}>{pickedItems ? t('Delete with items') : t('Delete')}</button>
    {/snippet}
  </Modal>
{/if}

<style>
  .collect {
    display: grid;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
  .srcs {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }
  .stop {
    display: grid;
    gap: 6px;
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }
  .lnk {
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--muted);
    cursor: pointer;
    font-size: inherit;
  }
  .lnk.on {
    color: var(--accent-text);
    font-weight: 600;
  }
  .slist {
    flex: 1;
    min-height: 0;
    padding: 6px;
  }
  .src {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .src:hover {
    background: var(--surface-2);
  }
  .src.on {
    background: var(--accent-soft);
  }
  .src .grow {
    display: grid;
  }
  .sl {
    font-weight: 600;
    font-size: 0.875rem;
  }
  .st {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .selpad {
    padding-bottom: 80px;
  }
  .selbar {
    position: sticky;
    top: 0;
    z-index: 2;
    gap: 6px;
    margin: 6px 0;
    padding: 6px 8px;
    border-radius: 10px;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    box-shadow: var(--shadow);
  }
  @media (max-width: 700px) {
    /* thumb reach: the actions sit at the bottom on phones */
    .selbar {
      position: fixed;
      top: auto;
      left: 8px;
      right: 8px;
      bottom: calc(8px + env(safe-area-inset-bottom));
      z-index: 50;
      margin: 0;
      padding: 8px 10px;
      background: var(--surface);
    }
    .selbar .icon-btn {
      width: 40px;
      height: 40px;
    }
    .src {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
  }
  .pickbar {
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--accent-soft);
  }
  .src.picked {
    background: var(--accent-soft);
  }
  .ck {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    flex: none;
    border: 1.5px solid var(--border-strong);
    border-radius: 4px;
    color: var(--accent-text);
  }
  .src.picked .ck {
    border-color: var(--accent);
  }
  .dl {
    padding-left: 1.2em;
  }
  :global(.danger-bg) {
    background: var(--danger) !important;
    border-color: var(--danger) !important;
    color: #fff !important;
  }
  .views {
    margin: 4px 0 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .vh {
    display: block;
    padding: 6px 10px 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .special.sub {
    font-weight: 400;
  }
  .special {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .cnt {
    font-size: 0.72rem;
    color: var(--faint);
  }
  .main {
    min-height: 0;
  }
  .inner {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 20px 24px 100px;
    display: grid;
    gap: 12px;
  }
  .sh h2 {
    font-size: 1.3rem;
  }
  .sh p {
    margin: 4px 0;
  }
  .ref {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-2);
    font-family: var(--font-serif);
    font-size: 0.875rem;
  }
  .capture {
    display: grid;
    gap: 8px;
    padding: 10px;
  }
  .page {
    width: 90px;
  }
  .bulk {
    gap: 12px;
  }
  .items {
    display: grid;
    gap: 6px;
  }
  @media (max-width: 700px) {
    .collect {
      grid-template-columns: 1fr;
    }
    .collect .main {
      display: none;
    }
    .collect.detail .srcs {
      display: none;
    }
    .collect.detail .main {
      display: block;
    }
    .inner {
      padding: 12px 12px 100px;
    }
  }
</style>
