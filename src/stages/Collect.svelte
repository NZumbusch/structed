<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import Icon from '../components/Icon.svelte';
  import Menu from '../components/Menu.svelte';
  import ArtifactCard from '../components/ArtifactCard.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { authorsFull, deleteArtifact, sourceLabel, yearOf } from '../lib/ops';
  import { referenceOf } from '../lib/cite';
  import { cleanText } from '../lib/ocr';
  import type { ArtifactKind } from '../lib/types';

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
  const items = $derived.by(() => {
    const all = db.all('artifacts');
    const list = sel === '~all' ? all : sel === '~none' ? all.filter((a) => !db.get('sources', a.sourceId)) : all.filter((a) => a.sourceId === sel);
    const pn = (p?: string) => +(p?.match(/\d+/)?.[0] ?? 1e9);
    return list.sort((a, b) => pn(a.page) - pn(b.page) || a.createdAt - b.createdAt);
  });

  $effect(() => {
    sel;
    selected.clear();
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

  const bulkMenu = $derived([
    { label: t('Clean up text (OCR/PDF)'), icon: 'sparkle', run: () => bulk('clean') },
    { label: t('Add tag…'), icon: 'tag', run: () => { const v = prompt(t('Tag')); if (v) bulk('tag', v.trim().replace(/^#/, '')); } },
    { label: t('Make quotes'), icon: 'quote', run: () => bulk('kind', 'quote') },
    { label: t('Make paraphrases'), icon: 'paraphrase', run: () => bulk('kind', 'paraphrase') },
    { label: t('Make notes'), icon: 'note', run: () => bulk('kind', 'note') },
    null,
    { label: t('Delete selected'), icon: 'trash', danger: true, run: () => bulk('delete') }
  ]);
</script>

<div class="collect" class:detail={ui.narrow && !!sel}>
  <div class="srcs">
    <div class="stop">
      <div class="row">
        <input class="input grow" placeholder={t('Filter sources…')} bind:value={q} />
        <button class="icon-btn" title={t('New source')} onclick={() => (ui.editSource = {})}><Icon name="plus" /></button>
        <button class="icon-btn" title={t('Import from Zotero…')} onclick={() => (ui.dialog = 'zotero')}><Icon name="download" /></button>
      </div>
      <div class="row tiny muted">
        {t('Sort')}:
        {#each ['author', 'year', 'added', 'items'] as s (s)}
          <button class="lnk" class:on={sort === s} onclick={() => (sort = s as typeof sort)}>{t(s)}</button>
        {/each}
      </div>
    </div>
    <div class="slist scroll">
      <button class="src special" class:on={sel === '~all'} onclick={() => (ui.collectSourceId = '~all')}>
        <span class="grow">{t('All items')}</span><span class="cnt">{db.all('artifacts').length}</span>
      </button>
      <button class="src special" class:on={sel === '~none'} onclick={() => (ui.collectSourceId = '~none')}>
        <span class="grow">{t('Own notes & unsourced')}</span><span class="cnt">{counts.get('~none') ?? 0}</span>
      </button>
      {#each sources as s (s.id)}
        <button class="src" class:on={sel === s.id} onclick={() => (ui.collectSourceId = s.id)}>
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
          <h2 class="sh">{sel === '~all' ? t('All items') : t('Own notes & unsourced')}</h2>
        {/if}

        {#if sel !== '~all'}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="capture card" onkeydown={captureKey}>
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
          <div class="row bulk small">
            <label class="row"><input type="checkbox" checked={selected.size === items.length && items.length > 0} onchange={(e) => { if (e.currentTarget.checked) items.forEach((a) => selected.add(a.id)); else selected.clear(); }} />{t('Select all')}</label>
            <span class="muted">{items.length} {t('items')}{selected.size ? ` · ${selected.size} ${t('selected')}` : ''}</span>
            <span class="grow"></span>
            {#if selected.size}
              <Menu items={bulkMenu} label={t('Bulk actions')} icon="more" />
            {/if}
          </div>
        {/if}
        <div class="items">
          {#each items as a (a.id)}
            <ArtifactCard {a} context="collect" selectable selected={selected.has(a.id)} onselect={(v) => (v ? selected.add(a.id) : selected.delete(a.id))} />
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .collect {
    display: grid;
    grid-template-columns: 300px 1fr;
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
  @media (max-width: 900px) {
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
