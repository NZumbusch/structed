<script lang="ts">
  // Go through the Zotero highlights of one or more sources, one at a time: take it as a
  // quote (or paraphrase / note), or skip it. Skipped and deleted highlights do not come
  // back. Keys: Enter take · S skip · P paraphrase · N note · Z back · E edit the text.
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { annotationsFor, ZCOLORS, type ZAnnotation } from '../lib/zotero';
  import { cleanText } from '../lib/ocr';
  import { addToProject, sourceLabel } from '../lib/ops';
  import type { ArtifactKind, Source } from '../lib/types';
  import RepairText from './RepairText.svelte';
  import { learnFromEdit, loadDict, remember, type Dict } from '../lib/repair';
  import { settings, textLang } from '../lib/settings.svelte';
  import { autosize } from '../lib/autosize';

  const sources = (ui.reviewSources ?? []).map((id) => db.get('sources', id)).filter((s): s is Source => !!s && !!s.zoteroKey);
  interface Item extends ZAnnotation {
    source: Source;
    seen: boolean; // skipped or deleted before
  }
  let items = $state<Item[]>([]);
  let loading = $state(true);
  let error = $state('');
  let showSeen = $state(false);
  let i = $state(0);
  let text = $state('');
  let editing = $state(false);
  /** the text with the repairs chosen (umlauts read as "?", broken words) */
  let repaired = $state('');
  let editText = $state('');
  let dict = $state<Dict | null>(null);
  let repairer = $state<{ applySure: () => void } | null>(null);
  /** the text to take: as edited, or as repaired */
  const finalText = () => (editing ? editText : repaired || text);
  function startEdit() {
    editText = repaired || text;
    editing = true;
    setTimeout(() => textEl?.focus(), 0);
  }
  function endEdit() {
    if (!editing) return;
    remember(learnFromEdit(text, editText)); // "?" words fixed by hand are repaired by themselves next time
    text = editText;
    editing = false;
  }
  let textEl = $state<HTMLTextAreaElement>();
  /** decisions made here, to step back */
  let history: { index: number; taken: boolean }[] = [];
  let taken = $state(0);
  let skipped = $state(0);

  /** keys belong to the review, not to a button that happens to have focus */
  const unfocus = () => (document.activeElement as HTMLElement | null)?.blur?.();
  onMount(async () => {
    unfocus();
    loadDict().then((d) => (dict = d)); // the word list for repairs (once, then kept offline)
    try {
      const imported = new Set(db.all('artifacts').map((a) => a.zoteroKey).filter(Boolean));
      const seen = new Set(db.deletedOf('artifacts').map((a) => a.zoteroKey).filter(Boolean));
      const out: Item[] = [];
      const byLib = new Map<string, Source[]>();
      for (const s of sources) (byLib.get(s.zoteroLibrary!) ?? byLib.set(s.zoteroLibrary!, []).get(s.zoteroLibrary!)!).push(s);
      for (const [lib, srcs] of byLib) {
        const byKey = new Map(srcs.map((s) => [s.zoteroKey!, s]));
        const res = await annotationsFor(lib, [...byKey.keys()]);
        for (const a of res.items) {
          if (imported.has(a.key) || a.type === 'ink' || a.type === 'image') continue;
          if (!(a.text || a.comment).trim()) continue;
          out.push({ ...a, source: byKey.get(a.parentItem)!, seen: seen.has(a.key) });
        }
        if (res.failed.length) error = t('{n} sources could not be read and were skipped:', { n: res.failed.length });
      }
      // in the order of the sources chosen, then by position in the document
      const order = new Map(sources.map((s, n) => [s.id, n]));
      items = out.sort((a, b) => order.get(a.source.id)! - order.get(b.source.id)! || a.sort.localeCompare(b.sort));
    } catch (e) {
      error = String((e as Error).message ?? e);
    } finally {
      loading = false;
    }
  });

  const queue = $derived(items.filter((x) => showSeen || !x.seen));
  const cur = $derived(queue[i]);
  const isNote = (x: Item) => x.type === 'note' || x.type === 'childnote';
  $effect(() => {
    const c = cur;
    text = c ? (isNote(c) ? c.comment : cleanText(c.text)) : '';
    editing = false;
  });
  const leftInSource = $derived(cur ? queue.slice(i).filter((x) => x.source.id === cur.source.id).length : 0);
  const sourceNo = $derived(cur ? sources.findIndex((s) => s.id === cur.source.id) + 1 : 0);

  function take(kind: ArtifactKind = 'quote') {
    const c = cur;
    const value = finalText().trim();
    if (!c || !value) return;
    if (editing) remember(learnFromEdit(text, editText));
    db.batch('take highlight', () => {
      const note = kind === 'note';
      const a = db.create('artifacts', {
        kind,
        sourceId: c.source.id,
        text: value,
        comment: note || isNote(c) ? '' : c.comment,
        page: c.page,
        tags: [...c.tags],
        zoteroKey: c.key
      });
      if (ui.projectId) addToProject(ui.projectId, 'artifact', a.id);
    });
    history.push({ index: i, taken: true });
    taken++;
    i++;
    unfocus();
  }
  function skip() {
    const c = cur;
    if (!c) return;
    // remembered as a deleted item, so it does not come back (on other devices either)
    db.batch('skip highlight', () => {
      const a = db.create('artifacts', { kind: 'quote', sourceId: c.source.id, text: '', page: c.page, tags: [], zoteroKey: c.key });
      db.remove('artifacts', a.id);
    });
    history.push({ index: i, taken: false });
    skipped++;
    i++;
    unfocus();
  }
  function skipSource() {
    const id = cur?.source.id;
    while (cur && cur.source.id === id) skip();
  }
  function back() {
    const h = history.pop();
    if (!h) return;
    db.undo();
    if (h.taken) taken--;
    else skipped--;
    i = h.index;
    unfocus();
  }
  function key(e: KeyboardEvent) {
    if (editing || (e.target as HTMLElement).tagName === 'TEXTAREA') {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        take();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      enter: () => take(),
      arrowright: () => take(),
      s: skip,
      arrowleft: skip,
      backspace: skip,
      p: () => take('paraphrase'),
      n: () => take('note'),
      z: back,
      a: () => repairer?.applySure(),
      e: startEdit
    };
    if (map[k] && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      map[k]();
    }
  }
  const close = () => (ui.reviewSources = null);
</script>

<svelte:window onkeydown={key} />

<Modal title={t('Go through highlights')} onclose={close} width="880px">
  <div class="rv">
    {#if loading}
      <p class="muted">{t('Fetching highlights…')}</p>
    {:else if cur}
      <div class="where row small">
        <span class="grow ellipsis"><b>{sourceLabel(cur.source)}</b> <span class="muted">{cur.source.csl.title}</span></span>
        <span class="muted nowrap">{t('Source {a} of {b}', { a: sourceNo, b: sources.length })} · {t('{n} left', { n: queue.length - i })}</span>
      </div>
      <div class="bar"><span style="width:{(i / queue.length) * 100}%"></span></div>

      <article class="hl" style:--hc={cur.color || 'var(--k-quote)'}>
        <div class="meta tiny muted">
          {#if cur.color}<span class="dot" title={ZCOLORS[cur.color] ?? cur.color}></span>{/if}
          {isNote(cur) ? t('Note') : t('Highlight')}{cur.page ? ` · ${t('p.')} ${cur.page}` : ''}
          {#if cur.seen}<span class="seen">· {t('skipped before')}</span>{/if}
        </div>
        {#if editing}
          <textarea class="textarea txt-edit" rows="3" bind:this={textEl} bind:value={editText} use:autosize={editText} spellcheck="true" lang={textLang()} aria-label={t('Text')}></textarea>
        {:else}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="txt" ondblclick={startEdit}>
            {#if isNote(cur)}<p class="plain">{text}</p>{:else}<RepairText bind:this={repairer} base={text} {dict} bind:value={repaired} />{/if}
          </div>
        {/if}
        {#if cur.comment && !isNote(cur)}<p class="cmt small"><Icon name="comment" size={12} /> {cur.comment}</p>{/if}
      </article>

      <div class="acts row">
        <button class="btn" onclick={back} disabled={!taken && !skipped} title="Z"><Icon name="undo" size={14} />{t('Back')}</button>
        <span class="grow"></span>
        <button class="btn" onclick={skip} title="S / ←">{t('Skip')} <kbd>S</kbd></button>
        <button class="btn" onclick={() => take('paraphrase')} title="P">{t('paraphrase')} <kbd>P</kbd></button>
        <button class="btn" onclick={() => take('note')} title="N">{t('note')} <kbd>N</kbd></button>
        <button class="btn primary" onclick={() => take()} title="Enter / →"><Icon name="quote" size={14} />{t('Take as quote')} <kbd>↵</kbd></button>
      </div>
      <div class="more row tiny muted">
        <button class="lnk" onclick={() => (editing ? endEdit() : startEdit())}>{editing ? t('Done editing') : t('Edit the text first')} (E)</button>
        {#if leftInSource > 1}<button class="lnk" onclick={skipSource}>{t('Skip the remaining {n} of this source', { n: leftInSource })}</button>{/if}
        <span class="grow"></span>
        <span>{t('{a} taken · {b} skipped', { a: taken, b: skipped })}</span>
      </div>
    {:else}
      <div class="done">
        <Icon name="check" size={28} />
        <p>{queue.length || taken || skipped ? t('All highlights gone through: {a} taken, {b} skipped.', { a: taken, b: skipped }) : t('No new highlights in these sources.')}</p>
        {#if items.some((x) => x.seen) && !showSeen}
          <button class="btn sm" onclick={() => ((showSeen = true), (i = 0))}>{t('Show the {n} skipped before again', { n: items.filter((x) => x.seen).length })}</button>
        {/if}
      </div>
    {/if}
    {#if error}<p class="err small">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <span class="tiny muted grow">{t('Enter take · S skip · P paraphrase · N note · E edit · Z back')}{dict ? ' · ' + t('A apply sure repairs') : ''}</span>
    <button class="btn" onclick={close}>{t('Done')}</button>
  {/snippet}
</Modal>

<style>
  .rv {
    display: grid;
    /* the column may shrink below its content's width: nothing is cut off at the right */
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .rv > :global(*) {
    min-width: 0;
  }
  .where {
    gap: 10px;
  }
  .nowrap {
    white-space: nowrap;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
  .hl {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 14px 16px;
    border-left: 4px solid var(--hc);
    border-radius: 8px;
    background: var(--surface-2);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--hc);
  }
  .seen {
    color: var(--warn);
  }
  .txt {
    max-height: 50vh;
    overflow-y: auto;
    min-width: 0;
  }
  .plain {
    margin: 0;
    font-family: var(--font-text);
    font-size: 1.05rem;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* editing keeps the reading font and grows with the text */
  .txt-edit {
    width: 100%;
    min-height: 6em;
    max-height: 50vh;
    resize: vertical;
    font-family: var(--font-text);
    font-size: 1.05rem;
    line-height: 1.6;
  }
  .cmt {
    margin: 0;
    padding: 4px 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
  .acts {
    flex-wrap: wrap;
    gap: 6px;
  }
  kbd {
    margin-left: 4px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.7rem;
    opacity: 0.8;
  }
  .more {
    flex-wrap: wrap;
    gap: 12px;
  }
  .lnk {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
  }
  .done {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 24px 0;
    text-align: center;
  }
  .err {
    color: var(--danger);
  }
  @media (max-width: 600px) {
    kbd {
      display: none;
    }
  }
</style>
