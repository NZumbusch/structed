<script lang="ts">
  // Find and replace in the text of all sections (Write). Matches are highlighted in the
  // editors; quotes and footnotes are not searched, because their text lives in the library.
  import type { Editor } from '@tiptap/core';
  import { onMount, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n';
  import { ui } from '../lib/ui.svelte';
  import { findIn, findKey, type Match } from '../lib/typing';

  let {
    editors,
    tick,
    replace = $bindable(false),
    initial = '',
    onclose
  }: { editors: () => Editor[]; tick: number; replace?: boolean; initial?: string; onclose: () => void } = $props();

  let query = $state(untrack(() => initial));
  let replacement = $state('');
  let caseSensitive = $state(false);
  let idx = $state(0);
  let input: HTMLInputElement;

  type Hit = Match & { editor: Editor };
  const hits = $derived.by((): Hit[] => {
    void tick; // the text changed
    return editors().flatMap((editor) => findIn(editor.state.doc, query, caseSensitive).map((m) => ({ ...m, editor })));
  });
  const cur = $derived(hits.length ? hits[Math.min(idx, hits.length - 1)] : null);

  // highlight in every editor; only the editor holding the current match marks it
  $effect(() => {
    const q = query;
    const cs = caseSensitive;
    const c = cur;
    untrack(() => {
      for (const e of editors()) {
        const st = findKey.getState(e.state);
        const current = c && c.editor === e ? { from: c.from, to: c.to } : null;
        if (st && st.query === q && st.caseSensitive === cs && st.current?.from === current?.from && st.current?.to === current?.to) continue;
        e.view.dispatch(e.state.tr.setMeta(findKey, { query: q, caseSensitive: cs, current }).setMeta('addToHistory', false));
      }
    });
  });

  function reveal() {
    requestAnimationFrame(() => document.querySelector('.find-cur')?.scrollIntoView({ block: 'center', behavior: 'auto' }));
  }
  function step(d: 1 | -1) {
    if (!hits.length) return;
    idx = (Math.min(idx, hits.length - 1) + d + hits.length) % hits.length;
    reveal();
  }
  $effect(() => {
    // a new query starts at the first match
    void query;
    void caseSensitive;
    untrack(() => {
      idx = 0;
      if (hits.length) reveal();
    });
  });

  function replaceOne() {
    const c = cur;
    if (!c) return;
    c.editor.view.dispatch(c.editor.state.tr.insertText(replacement, c.from, c.to));
    // idx now points at the next match
    reveal();
  }
  function replaceAll() {
    let n = 0;
    for (const e of editors()) {
      const ms = findIn(e.state.doc, query, caseSensitive);
      if (!ms.length) continue;
      const tr = e.state.tr;
      for (const m of [...ms].reverse()) tr.insertText(replacement, m.from, m.to);
      e.view.dispatch(tr);
      n += ms.length;
    }
    ui.toast(t('{n} replaced', { n }), { kind: n ? 'ok' : undefined }, 2500);
  }

  function close() {
    const c = cur;
    for (const e of editors()) e.view.dispatch(e.state.tr.setMeta(findKey, { query: '', caseSensitive: false, current: null }).setMeta('addToHistory', false));
    onclose();
    // continue writing at the match
    if (c) c.editor.chain().focus().setTextSelection({ from: c.from, to: c.to }).run();
  }

  function keys(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && (e.target as HTMLElement).id === 'find-q') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter' && (e.target as HTMLElement).id === 'find-r') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) replaceAll();
      else replaceOne();
    }
  }

  export function focus() {
    input?.focus();
    input?.select();
  }
  onMount(focus);
</script>

<div class="findwrap">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="find" role="search" aria-label={t('Find in the text')} onkeydown={keys}>
    <div class="row">
      <button class="icon-btn sm" aria-expanded={replace} title={t('Replace')} aria-label={t('Replace')} onclick={() => (replace = !replace)}>
        <Icon name={replace ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      <input id="find-q" class="input" bind:this={input} bind:value={query} placeholder={t('Find in the text')} aria-label={t('Find in the text')} autocomplete="off" spellcheck="false" />
      <span class="count tiny muted" aria-live="polite">{query ? (hits.length ? `${Math.min(idx, hits.length - 1) + 1}/${hits.length}` : t('No results')) : ''}</span>
      <button class="icon-btn sm case" class:active={caseSensitive} aria-pressed={caseSensitive} title={t('Match case')} aria-label={t('Match case')} onclick={() => (caseSensitive = !caseSensitive)}>Aa</button>
      <button class="icon-btn sm" disabled={!hits.length} title="{t('Previous')} (Shift+Enter)" aria-label={t('Previous')} onclick={() => step(-1)}><Icon name="chevron-up" size={14} /></button>
      <button class="icon-btn sm" disabled={!hits.length} title="{t('Next')} (Enter)" aria-label={t('Next')} onclick={() => step(1)}><Icon name="chevron-down" size={14} /></button>
      <button class="icon-btn sm" title="{t('Close')} (Esc)" aria-label={t('Close')} onclick={close}><Icon name="x" size={14} /></button>
    </div>
    {#if replace}
      <div class="row">
        <span class="pad"></span>
        <input id="find-r" class="input" bind:value={replacement} placeholder={t('Replace with')} aria-label={t('Replace with')} autocomplete="off" spellcheck="false" />
        <button class="btn sm" disabled={!cur} title="{t('Replace')} (Enter)" onclick={replaceOne}>{t('Replace')}</button>
        <button class="btn sm" disabled={!hits.length} title="{t('Replace all')} (Ctrl+Enter)" aria-label={t('Replace all')} onclick={replaceAll}>{t('All')}</button>
      </div>
    {/if}
  </div>
</div>

<style>
  /* floats over the text below the toolbar, without pushing it down */
  .findwrap {
    position: sticky;
    top: 48px;
    z-index: 4;
    height: 0;
  }
  .find {
    position: absolute;
    right: 16px;
    top: 4px;
    display: grid;
    gap: 4px;
    max-width: calc(100vw - 32px);
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .input {
    width: 220px;
    min-width: 0;
    flex: 1 1 auto;
    height: 28px;
    font-size: 0.85rem;
  }
  .count {
    min-width: 4.5em;
    text-align: center;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .case {
    font-size: 0.75rem;
    font-weight: 600;
  }
  .pad {
    width: 28px;
    flex: none;
  }
  .btn.sm {
    height: 28px;
  }
</style>
