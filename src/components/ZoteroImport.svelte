<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { parseBibliography } from '../lib/cite';
  import { cleanText, defaultClean, type CleanOptions } from '../lib/ocr';
  import { authorsShort, sourceLabel, yearOf } from '../lib/ops';
  import {
    annotationsFor,
    collections,
    deletedZoteroKeys,
    findDuplicate,
    items as fetchItems,
    libraries,
    upsertSource,
    zoteroConfigured,
    ZCOLORS,
    type ZAnnotation,
    type ZCollection,
    type ZItem,
    type ZLibrary
  } from '../lib/zotero';
  import type { CSLItem, Source } from '../lib/types';

  type Step = 'api' | 'annots' | 'file';
  let step: Step = $state(zoteroConfigured() ? 'api' : 'file');
  let err = $state('');
  let busy = $state('');

  // --- API browse ---
  let libs: ZLibrary[] = $state([]);
  let lib = $state('');
  let cols: ZCollection[] = $state([]);
  let col = $state('');
  let q = $state('');
  let list: ZItem[] = $state([]);
  let total = $state(0);
  const pick = new SvelteSet<string>();
  let updateExisting = $state(true);
  let importTags = $state(false);
  let withHighlights = $state(true);

  // --- annotations review ---
  interface Row extends ZAnnotation {
    sourceId: string;
    sourceLabel: string;
    include: boolean;
    exists: boolean;
  }
  let rows: Row[] = $state([]);
  let colorFilter = new SvelteSet<string>();
  let typeFilter = new SvelteSet<string>(['highlight', 'underline', 'note', 'childnote']);
  let minLen = $state(0);
  let clean: CleanOptions = $state({ ...defaultClean });
  let keepColors = $state(false);
  let annTags = $state(true);
  let extraTag = $state('');

  // --- file ---
  let fileItems: { csl: CSLItem; include: boolean; dup?: Source }[] = $state([]);
  let pasted = $state('');

  const imported = $derived(new Set(db.all('sources').filter((s) => s.zoteroKey).map((s) => `${s.zoteroLibrary}/${s.zoteroKey}`)));
  /** deleted here after an earlier import: skipped by “Import all”, shown greyed out */
  const deleted = $derived(deletedZoteroKeys());

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    busy = label;
    err = '';
    try {
      return await fn();
    } catch (e) {
      err = String((e as Error).message ?? e);
    } finally {
      busy = '';
    }
  }

  async function init() {
    if (!zoteroConfigured()) return;
    const ls = await run(t('Connecting…'), libraries);
    if (!ls) return;
    libs = ls;
    lib = ls[0].id;
    await loadLib();
    if (ui.zoteroFor) {
      const s = db.get('sources', ui.zoteroFor);
      ui.zoteroFor = null;
      if (s?.zoteroKey && s.zoteroLibrary) await reviewAnnotations([s]);
    }
  }
  async function loadLib() {
    col = '';
    cols = (await run(t('Loading collections…'), () => collections(lib))) ?? [];
    await loadItems();
  }
  let offset = 0; // raw position in Zotero's list (some top-level entries are hidden)
  function mergeItems(a: ZItem[], b: ZItem[]) {
    const seen = new Set(a.map((x) => x.key));
    return [...a, ...b.filter((x) => !seen.has(x.key))];
  }
  async function loadItems(more = false) {
    if (!more) offset = 0;
    const r = await run(t('Loading items…'), () => fetchItems(lib, { collection: col || undefined, q: q.trim() || undefined, start: offset }));
    if (!r) return;
    list = more ? mergeItems(list, r.items) : r.items;
    total = r.total;
    offset += r.raw;
  }
  const hasMore = $derived(offset < total);
  $effect(() => {
    init();
  });

  const colTree = $derived.by(() => {
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

  async function importSelected() {
    const chosen = list.filter((it) => pick.has(it.key));
    if (!chosen.length) return;
    const sources = db.batch('zotero import', () => chosen.map((it) => upsertSource($state.snapshot(it) as ZItem, updateExisting, importTags)));
    ui.toast(t('{n} sources imported', { n: sources.length }), { kind: 'ok' });
    pick.clear();
    if (withHighlights) await reviewAnnotations(sources);
  }

  let warn = $state('');

  async function reviewAnnotations(sources: Source[]) {
    const existingKeys = new Set(db.all('artifacts').map((a) => a.zoteroKey).filter(Boolean));
    const out: Row[] = [];
    warn = '';
    await run(t('Fetching highlights…'), async () => {
      // group by library (My Library / groups)
      const byLib = new Map<string, Source[]>();
      for (const s of sources) if (s.zoteroKey && s.zoteroLibrary) (byLib.get(s.zoteroLibrary) ?? byLib.set(s.zoteroLibrary, []).get(s.zoteroLibrary)!).push(s);
      const failed: string[] = [];
      for (const [libId, srcs] of byLib) {
        const byKey = new Map(srcs.map((s) => [s.zoteroKey!, s]));
        const res = await annotationsFor(libId, [...byKey.keys()], (m) => (busy = `${t('Fetching highlights…')} ${m}`));
        for (const a of res.items) {
          const s = byKey.get(a.parentItem)!;
          out.push({ ...a, sourceId: s.id, sourceLabel: `${authorsShort(s.csl)} ${yearOf(s.csl)}`, include: !existingKeys.has(a.key), exists: existingKeys.has(a.key) });
        }
        for (const f of res.failed) failed.push(`${sourceLabel(byKey.get(f.key)!)}: ${f.error}`);
      }
      if (failed.length) warn = t('{n} sources could not be read and were skipped:', { n: failed.length }) + ' ' + failed.join(' · ');
    });
    rows = out;
    step = 'annots';
  }

  /** Load every remaining page of the current view, then import all of it. */
  async function importAll() {
    await run(t('Loading items…'), async () => {
      while (offset < total) {
        busy = `${t('Loading items…')} ${offset}/${total}`;
        const r = await fetchItems(lib, { collection: col || undefined, q: q.trim() || undefined, start: offset });
        list = mergeItems(list, r.items);
        total = r.total;
        offset += r.raw;
        if (!r.raw) break;
      }
    });
    for (const it of list) if (!deleted.has(`${it.library}/${it.key}`)) pick.add(it.key);
    await importSelected();
  }

  const usedColors = $derived([...new Set(rows.map((r) => r.color).filter(Boolean))]);
  const visible = $derived(
    rows.filter(
      (r) =>
        typeFilter.has(r.type) &&
        (!colorFilter.size || colorFilter.has(r.color)) &&
        (r.type === 'note' || r.type === 'childnote' || cleanText(r.text, clean).length >= minLen)
    )
  );
  const chosenCount = $derived(visible.filter((r) => r.include).length);

  function importAnnotations() {
    const chosen = visible.filter((r) => r.include);
    db.batch('import highlights', () => {
      for (const r of chosen) {
        const isNote = r.type === 'note' || r.type === 'childnote';
        const tags = [...(annTags ? r.tags : []), ...(extraTag.trim() ? [extraTag.trim().replace(/^#/, '')] : [])];
        db.create('artifacts', {
          kind: isNote ? 'note' : 'quote',
          sourceId: r.sourceId,
          text: isNote ? r.comment : cleanText(r.text, clean),
          comment: isNote ? '' : r.comment,
          page: r.page,
          tags,
          color: keepColors && r.color ? r.color : undefined,
          zoteroKey: r.key
        });
      }
    });
    ui.toast(t('{n} items imported', { n: chosen.length }), { kind: 'ok', action: { label: t('Undo'), run: () => db.undo() } });
    ui.dialog = null;
  }

  // ---- file import ----
  async function parse(text: string) {
    const r = await run(t('Parsing…'), () => parseBibliography(text));
    if (!r) return;
    fileItems = r.map((csl) => {
      const dup = findDuplicate(csl);
      return { csl, include: !dup, dup };
    });
    if (!r.length) err = t('No entries found.');
  }
  async function onFile(f: File | undefined) {
    if (f) await parse(await f.text());
  }
  function importFile() {
    const chosen = fileItems.filter((x) => x.include);
    db.batch('file import', () => {
      for (const x of chosen) {
        const csl = $state.snapshot(x.csl) as CSLItem;
        if (x.dup) db.update('sources', x.dup.id, { csl: { ...csl, id: x.dup.csl.id || csl.id } });
        else db.create('sources', { csl, tags: [] });
      }
    });
    ui.toast(t('{n} sources imported', { n: chosen.length }), { kind: 'ok' });
    ui.dialog = null;
  }
</script>

<Modal title={t('Import sources')} onclose={() => (ui.dialog = null)} width="860px">
  {#snippet header()}
    <div class="seg">
      <button class:on={step === 'api' || step === 'annots'} onclick={() => (step = 'api')}>Zotero Web API</button>
      <button class:on={step === 'file'} onclick={() => (step = 'file')}>{t('File / paste')}</button>
    </div>
  {/snippet}

  {#if err}<p class="err small">{err}</p>{/if}
  {#if warn}<p class="warn small" role="status">{warn}</p>{/if}
  {#if busy}<p class="small muted busy"><span class="spin"></span>{busy}</p>{/if}

  {#if step === 'api'}
    {#if !zoteroConfigured()}
      <div class="cfg card">
        <p class="small">{t('Enter your Zotero user ID and an API key (zotero.org/settings/keys). They stay on this device.')}</p>
        <div class="row">
          <input class="input" bind:value={settings.zoteroUserId} placeholder={t('User ID')} />
          <input class="input" type="password" bind:value={settings.zoteroApiKey} placeholder={t('API key')} />
          <button class="btn primary" onclick={init} disabled={!zoteroConfigured()}>{t('Connect')}</button>
        </div>
        <a class="small" href="https://www.zotero.org/settings/keys" target="_blank" rel="noopener">zotero.org/settings/keys ↗</a>
      </div>
    {:else}
      <div class="browse">
        <aside class="cols scroll">
          {#if libs.length > 1}
            <select class="select" bind:value={lib} onchange={loadLib}>
              {#each libs as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
            </select>
          {/if}
          <button class="col" class:on={!col} onclick={() => { col = ''; loadItems(); }}>{t('All items')}</button>
          {#each colTree as { c, depth } (c.key)}
            <button class="col" class:on={col === c.key} style="padding-left:{10 + depth * 14}px" onclick={() => { col = c.key; loadItems(); }}>
              <Icon name="folder" size={14} /><span class="ellipsis">{c.name}</span>
            </button>
          {/each}
        </aside>
        <div class="its">
          <div class="row">
            <input class="input grow" placeholder={t('Search in Zotero…')} bind:value={q} onkeydown={(e) => e.key === 'Enter' && loadItems()} />
            <button class="btn" onclick={() => loadItems()}><Icon name="search" size={15} /></button>
          </div>
          <div class="row small">
            <label class="row"><input type="checkbox" checked={list.length > 0 && list.every((i) => pick.has(i.key))} onchange={(e) => list.forEach((i) => (e.currentTarget.checked ? pick.add(i.key) : pick.delete(i.key)))} />{t('Select all')}</label>
            <span class="muted">{list.length} {t('loaded')}{hasMore ? ` · ${t('more available')}` : ''}</span>
          </div>
          <div class="ilist scroll">
            {#each list as it (it.key)}
              <label class="it" class:done={imported.has(`${it.library}/${it.key}`) || deleted.has(`${it.library}/${it.key}`)}>
                <input type="checkbox" checked={pick.has(it.key)} onchange={(e) => (e.currentTarget.checked ? pick.add(it.key) : pick.delete(it.key))} />
                <span class="grow">
                  <span class="ellipsis it-t">{it.title || '—'}</span>
                  <span class="tiny muted">{it.creators} {it.year} · {it.itemType}{imported.has(`${it.library}/${it.key}`) ? ' · ' + t('already imported') : deleted.has(`${it.library}/${it.key}`) ? ' · ' + t('deleted here – tick to import again') : ''}</span>
                </span>
              </label>
            {/each}
            {#if hasMore}<button class="btn ghost sm" onclick={() => loadItems(true)}>{t('Load more')}</button>{/if}
          </div>
        </div>
      </div>
      <div class="opts small">
        <label class="row"><input type="checkbox" bind:checked={withHighlights} />{t('Then review PDF highlights & notes to import as quotes')}</label>
        <label class="row"><input type="checkbox" bind:checked={updateExisting} />{t('Update metadata of already imported sources')}</label>
        <label class="row"><input type="checkbox" bind:checked={importTags} />{t('Import Zotero tags')}</label>
      </div>
    {/if}
  {:else if step === 'annots'}
    <div class="filters">
      <div class="row wrap small">
        <strong>{t('Types')}:</strong>
        {#each [['highlight', t('Highlights')], ['underline', t('Underlines')], ['note', t('Note annotations')], ['childnote', t('Item notes')]] as [k, l] (k)}
          <label class="row"><input type="checkbox" checked={typeFilter.has(k)} onchange={(e) => (e.currentTarget.checked ? typeFilter.add(k) : typeFilter.delete(k))} />{l}</label>
        {/each}
      </div>
      {#if usedColors.length > 1}
        <div class="row wrap small">
          <strong>{t('Colors')}:</strong>
          {#each usedColors as c (c)}
            <button class="sw" class:on={colorFilter.has(c)} style:background={c} title={ZCOLORS[c] ?? c} onclick={() => (colorFilter.has(c) ? colorFilter.delete(c) : colorFilter.add(c))}></button>
          {/each}
          {#if colorFilter.size}<button class="btn ghost sm" onclick={() => colorFilter.clear()}>{t('all')}</button>{/if}
        </div>
      {/if}
      <div class="row wrap small">
        <strong>{t('Clean up')}:</strong>
        <label class="row"><input type="checkbox" bind:checked={clean.dehyphenate} />{t('hyphenation')}</label>
        <label class="row"><input type="checkbox" bind:checked={clean.joinLines} />{t('line breaks')}</label>
        <label class="row"><input type="checkbox" bind:checked={clean.ligatures} />{t('ligatures')}</label>
        <label class="row"><input type="checkbox" bind:checked={clean.whitespace} />{t('spacing')}</label>
        <label class="row"><input type="checkbox" bind:checked={clean.quotes} />{t('outer quotes')}</label>
        <label class="row">{t('min. length')} <input class="input mini" type="number" min="0" bind:value={minLen} /></label>
      </div>
      <div class="row wrap small">
        <label class="row"><input type="checkbox" bind:checked={annTags} />{t('Keep annotation tags')}</label>
        <label class="row"><input type="checkbox" bind:checked={keepColors} />{t('Keep colors')}</label>
        <label class="row">{t('Add tag')} <input class="input mini2" bind:value={extraTag} placeholder="#zotero" /></label>
      </div>
      <div class="row small">
        <button class="btn ghost sm" onclick={() => visible.forEach((r) => (r.include = true))}>{t('Select all')}</button>
        <button class="btn ghost sm" onclick={() => visible.forEach((r) => (r.include = false))}>{t('Select none')}</button>
        <span class="muted">{chosenCount}/{visible.length} {t('selected')} · {rows.length - visible.length} {t('filtered out')}</span>
      </div>
    </div>
    <div class="alist scroll">
      {#each visible as r (r.key)}
        <label class="ann" class:off={!r.include}>
          <input type="checkbox" bind:checked={r.include} />
          <span class="bar" style:background={r.color || 'var(--border-strong)'}></span>
          <span class="grow">
            <span class="tiny muted">{r.sourceLabel}{r.page ? ` · p. ${r.page}` : ''} · {r.type}{r.exists ? ' · ' + t('already imported') : ''}</span>
            {#if r.text}<span class="atext">{cleanText(r.text, clean)}</span>{/if}
            {#if r.comment}<span class="acom small">{r.comment}</span>{/if}
          </span>
        </label>
      {:else}
        <div class="empty small">{busy ? '' : t('No highlights found for these items (only annotations made in Zotero’s PDF reader and synced to zotero.org are available).')}</div>
      {/each}
    </div>
  {:else}
    <div class="file">
      <p class="small">{t('In Zotero: select items → right-click → Export… → choose CSL JSON (best), Better BibTeX, BibTeX or RIS. Then drop the file here.')}</p>
      <label
        class="drop"
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => { e.preventDefault(); onFile(e.dataTransfer?.files?.[0]); }}
      >
        <Icon name="upload" size={22} />
        <span>{t('Drop .json / .bib / .ris here or click to choose')}</span>
        <input type="file" accept=".json,.bib,.bibtex,.ris,.txt" hidden onchange={(e) => onFile(e.currentTarget.files?.[0])} />
      </label>
      <details>
        <summary class="small">{t('…or paste BibTeX / RIS / CSL-JSON / DOIs')}</summary>
        <textarea class="textarea" rows="5" bind:value={pasted}></textarea>
        <button class="btn sm" onclick={() => parse(pasted)} disabled={!pasted.trim()}>{t('Parse')}</button>
      </details>
      {#if fileItems.length}
        <div class="ilist scroll">
          {#each fileItems as x, i (i)}
            <label class="it">
              <input type="checkbox" bind:checked={x.include} />
              <span class="grow">
                <span class="ellipsis it-t">{x.csl.title || '—'}</span>
                <span class="tiny muted">{authorsShort(x.csl)} {yearOf(x.csl)} · {x.csl.type}{x.dup ? ' · ' + t('exists – will update') : ''}</span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    {#if step === 'api' && zoteroConfigured()}
      <span class="grow small muted">{pick.size} {t('selected')}</span>
      <button class="btn" disabled={!total || !!busy} onclick={importAll} title={t('Loads all pages of this view and imports everything')}>
        {t('Import all ({n})', { n: hasMore ? `${total}` : `${list.length}` })}
      </button>
      <button class="btn primary" disabled={!pick.size || !!busy} onclick={importSelected}>{t('Import selected')}</button>
    {:else if step === 'annots'}
      <button class="btn" onclick={() => (step = 'api')}>{t('Back')}</button>
      <span class="grow"></span>
      <button class="btn" onclick={() => (ui.dialog = null)}>{t('Skip')}</button>
      <button class="btn primary" disabled={!chosenCount} onclick={importAnnotations}>{t('Import {n} items', { n: chosenCount })}</button>
    {:else if step === 'file'}
      <span class="grow"></span>
      <button class="btn primary" disabled={!fileItems.some((x) => x.include)} onclick={importFile}>{t('Import {n} sources', { n: fileItems.filter((x) => x.include).length })}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .err {
    color: var(--danger);
    margin: 0 0 8px;
  }
  .warn {
    margin: 0 0 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    overflow-wrap: anywhere;
  }
  .busy {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spin {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: sp 0.8s linear infinite;
  }
  @keyframes sp {
    to {
      transform: rotate(360deg);
    }
  }
  .cfg {
    display: grid;
    gap: 10px;
    padding: 14px;
  }
  .browse {
    display: grid;
    grid-template-columns: 230px 1fr;
    gap: 12px;
    height: 52vh;
  }
  .cols {
    display: grid;
    align-content: start;
    gap: 2px;
    border-right: 1px solid var(--border);
    padding-right: 8px;
  }
  .col {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: 0.85rem;
    min-width: 0;
  }
  .col:hover {
    background: var(--surface-2);
  }
  .col.on {
    background: var(--accent-soft);
  }
  .its {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .ilist {
    flex: 1;
    min-height: 0;
    max-height: 52vh;
    display: grid;
    align-content: start;
    gap: 2px;
  }
  .it {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .it:hover {
    background: var(--surface-2);
  }
  .it .grow {
    display: grid;
  }
  .it-t {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .it.done .it-t {
    color: var(--muted);
  }
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin-top: 12px;
  }
  .filters {
    display: grid;
    gap: 8px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 8px;
  }
  .wrap {
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .mini {
    width: 70px;
    min-height: 28px;
    padding: 2px 6px;
  }
  .mini2 {
    width: 120px;
    min-height: 28px;
    padding: 2px 6px;
  }
  .sw {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .sw.on {
    border-color: var(--text);
  }
  .alist {
    max-height: 46vh;
    display: grid;
    gap: 4px;
  }
  .ann {
    display: flex;
    gap: 8px;
    padding: 8px;
    border-radius: 8px;
    cursor: pointer;
  }
  .ann:hover {
    background: var(--surface-2);
  }
  .ann.off {
    opacity: 0.45;
  }
  .ann .grow {
    display: grid;
    gap: 2px;
  }
  .bar {
    width: 3px;
    border-radius: 2px;
    flex: none;
  }
  .atext {
    font-family: var(--font-text);
    font-size: 0.875rem;
    line-height: 1.5;
  }
  .acom {
    color: var(--muted);
    font-style: italic;
  }
  .file {
    display: grid;
    gap: 12px;
  }
  .drop {
    display: grid;
    place-items: center;
    gap: 6px;
    padding: 28px;
    border: 2px dashed var(--border-strong);
    border-radius: 12px;
    color: var(--muted);
    cursor: pointer;
    text-align: center;
  }
  .drop:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  @media (max-width: 700px) {
    .browse {
      grid-template-columns: 1fr;
      height: auto;
    }
    .cols {
      max-height: 160px;
      border-right: 0;
    }
  }
</style>
