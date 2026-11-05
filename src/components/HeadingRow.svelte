<script lang="ts">
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import MdEditor from './MdEditor.svelte';
  import ArtifactCard from './ArtifactCard.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { draggable, droppable, zonePosition, type DragPayload } from '../lib/dnd';
  import {
    addChildHeading,
    addHeading,
    artifactLabel,
    children,
    deleteHeading,
    flatten,
    headingWords,
    indent,
    moveHeading,
    movePlacement,
    moveUpDown,
    outdent,
    place,
    placementsOf,
    wordCount
  } from '../lib/ops';
  import type { FlatHeading } from '../lib/ops';
  import type { HeadingStatus } from '../lib/types';

  let { f, mode }: { f: FlatHeading; mode: 'outline' | 'arrange' } = $props();
  const h = $derived(f.h);

  let input: HTMLInputElement;
  let dropPos = $state<null | 'before' | 'after' | 'inside'>(null);
  const bodyOpen = $derived(ui.openBodies.has(h.id));
  const placements = $derived(placementsOf(h.id));
  const comments = $derived(db.all('comments').filter((c) => c.targetId === h.id && !c.resolved).length);
  const words = $derived(wordCount(h.body));
  const collapsed = $derived(ui.collapsed.has(h.id));

  $effect(() => {
    if (ui.focusHeading === h.id) {
      tick().then(() => {
        input?.focus();
        input?.scrollIntoView({ block: 'nearest' });
        ui.focusHeading = null;
      });
    }
  });

  const STATUSES: HeadingStatus[] = ['idea', 'draft', 'revise', 'done'];
  function cycleStatus() {
    const i = STATUSES.indexOf(h.status ?? 'idea');
    db.update('headings', h.id, { status: STATUSES[(i + 1) % STATUSES.length] });
  }

  function focusSibling(dir: -1 | 1) {
    const flat = flatten(h.projectId, ui.collapsed);
    const i = flat.findIndex((x) => x.h.id === h.id);
    const n = flat[i + dir];
    if (n) ui.focusHeading = n.h.id;
  }

  function key(e: KeyboardEvent) {
    const el = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      // Split title at caret like an outliner.
      const pos = el.selectionStart ?? el.value.length;
      const rest = el.value.slice(pos);
      if (rest && pos > 0) db.update('headings', h.id, { title: el.value.slice(0, pos) });
      const asChild = f.hasChildren && !collapsed && pos > 0;
      const first = asChild ? children(h.projectId, h.id)[0] : undefined;
      const n = asChild ? addChildHeading(h, rest) : addHeading(h.projectId, h.parentId, h.id, pos > 0 ? rest : '');
      if (first) moveHeading(n.id, first.id, 'before');
      if (pos === 0 && el.value) {
        // caret at start: insert empty heading before
        moveHeading(n.id, h.id, 'before');
      }
      ui.focusHeading = pos === 0 && el.value ? h.id : n.id;
    } else if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ui.openBodies.add(h.id);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdent(h);
      else indent(h);
      ui.focusHeading = h.id;
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveUpDown(h, e.key === 'ArrowUp' ? -1 : 1);
      ui.focusHeading = h.id;
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault();
      focusSibling(-1);
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault();
      focusSibling(1);
    } else if (e.key === 'Backspace' && !el.value && !h.body && !placements.length && !f.hasChildren) {
      e.preventDefault();
      focusSibling(-1);
      db.remove('headings', h.id);
    } else if ((e.ctrlKey || e.metaKey) && e.key === '.') {
      e.preventDefault();
      ui.toggle(ui.collapsed, h.id);
    }
  }

  function bodyKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      ui.focusHeading = h.id;
      return true;
    }
  }

  function accepts(p: DragPayload) {
    return p.type === 'heading' ? p.id !== h.id : true;
  }
  function onDrop(p: DragPayload, info: { x: number; y: number; rect: DOMRect; el: HTMLElement }) {
    dropPos = null;
    if (p.type === 'heading') {
      moveHeading(p.id, h.id, zonePosition(info));
    } else if (p.type === 'artifact') {
      place(h.projectId, h.id, p.id);
      ui.toast(t('Placed under “{h}”', { h: h.title || t('Untitled') }), {}, 1800);
    } else if (p.type === 'placement') movePlacement(p.id, h.id);
  }

  const menu = $derived([
    { label: t('Add subheading'), icon: 'plus', run: () => { const n = addChildHeading(h); ui.collapsed.delete(h.id); ui.focusHeading = n.id; } },
    { label: t('Add heading below'), icon: 'plus', run: () => (ui.focusHeading = addHeading(h.projectId, h.parentId, h.id).id) },
    { label: bodyOpen ? t('Hide notes') : t('Write notes / gist'), icon: 'note', run: () => ui.toggle(ui.openBodies, h.id) },
    { label: t('New item here'), icon: 'quote', run: () => (ui.editArtifact = { kind: 'quote', headingId: h.id }) },
    null,
    { label: t('Indent'), icon: 'indent', run: () => indent(h) },
    { label: t('Outdent'), icon: 'outdent', run: () => outdent(h) },
    { label: t('Move up'), icon: 'arrow-up', run: () => moveUpDown(h, -1) },
    { label: t('Move down'), icon: 'arrow-down', run: () => moveUpDown(h, 1) },
    { label: t('Set word target…'), icon: 'target', run: () => {
        const v = prompt(t('Target words for this section (empty = none)'), h.targetWords ? String(h.targetWords) : '');
        if (v !== null) db.update('headings', h.id, { targetWords: +v || undefined });
      } },
    null,
    { label: t('Delete heading'), icon: 'trash', danger: true, run: () => {
        deleteHeading(h);
        ui.toast(t('Heading deleted'), { action: { label: t('Undo'), run: () => db.undo() } });
      } }
  ]);
  const totalWords = $derived(h.targetWords ? headingWords(h.projectId, h) : 0);
</script>

<div
  class="hrow d{Math.min(f.depth, 5)} mode-{mode}"
  style="--depth:{f.depth}"
  data-heading={h.id}
  class:drop-before={dropPos === 'before'}
  class:drop-after={dropPos === 'after'}
  class:drop-inside={dropPos === 'inside'}
  use:droppable={{
    accepts,
    onOver: (p, info) => (dropPos = p.type === 'heading' ? zonePosition(info) : 'inside'),
    onLeave: () => (dropPos = null),
    onDrop
  }}
>
  <div class="line">
    <span class="grip" use:draggable={{ payload: () => ({ type: 'heading', id: h.id, label: h.title || t('Untitled') }), handle: '.grip' }} title={t('Drag to move')}>
      <Icon name="grip" size={14} />
    </span>
    <button class="tw" class:hidden={!f.hasChildren} onclick={() => ui.toggle(ui.collapsed, h.id)} aria-label={collapsed ? t('Expand') : t('Collapse')}>
      <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
    </button>
    <span class="num">{f.num}</span>
    <input
      bind:this={input}
      class="title"
      value={h.title}
      placeholder={f.depth === 0 ? t('Heading') : t('Subheading')}
      oninput={(e) => db.update('headings', h.id, { title: e.currentTarget.value })}
      onkeydown={key}
    />
    <div class="side">
      {#if h.targetWords}
        <span class="tgt" title={t('Words / target')}>{totalWords}/{h.targetWords}</span>
      {/if}
      {#if mode === 'outline' && placements.length}
        <button class="chip" onclick={() => (ui.stage = 'arrange')} title={t('Items placed here')}><Icon name="quote" size={11} />{placements.length}</button>
      {/if}
      {#if comments}
        <button class="chip" onclick={() => { ui.stage = 'write'; ui.focusHeading = h.id; }} title={t('Open comments')}><Icon name="comment" size={11} />{comments}</button>
      {/if}
      <button class="status s-{h.status ?? 'idea'}" onclick={cycleStatus} title={t('Status') + ': ' + t(h.status ?? 'idea')}>
        <span class="dot"></span><span class="slabel">{t(h.status ?? 'idea')}</span>
      </button>
      <button class="icon-btn sm" class:active={bodyOpen || !!h.body} onclick={() => ui.toggle(ui.openBodies, h.id)} title={t('Notes / gist')}>
        <Icon name="note" size={15} />
      </button>
      <Menu items={menu} />
    </div>
  </div>

  {#if bodyOpen}
    <div class="body">
      <MdEditor value={h.body} onchange={(v) => db.update('headings', h.id, { body: v })} placeholder={t('Gist, arguments, draft… (markdown)')} onkeydown={bodyKey} />
      {#if words}<span class="wc tiny muted">{words} {t('words')}</span>{/if}
    </div>
  {:else if h.body && mode === 'outline'}
    <button class="preview" onclick={() => ui.openBodies.add(h.id)}>{h.body.replace(/\s+/g, ' ').slice(0, 160)}</button>
  {/if}

  {#if mode === 'arrange'}
    <div class="placed">
      {#each placements as p (p.id)}
        {@const a = db.get('artifacts', p.artifactId)}
        {#if a}
          <div
            class="pslot"
            use:droppable={{
              accepts: (x) => x.type !== 'heading' && x.id !== p.id,
              onDrop: (x) => {
                if (x.type === 'artifact') place(h.projectId, h.id, x.id, p.id);
                else if (x.type === 'placement') movePlacement(x.id, h.id, p.id);
              }
            }}
          >
            <ArtifactCard {a} placement={p} context="placed" />
          </div>
        {/if}
      {/each}
      {#if !placements.length}
        <div class="dropzone tiny">{t('Drop quotes or notes here')}</div>
      {/if}
    </div>
  {:else if placements.length && mode === 'outline' && !collapsed}
    <div class="mini">
      {#each placements.slice(0, 6) as p (p.id)}
        {@const a = db.get('artifacts', p.artifactId)}
        {#if a}<span class="mchip k-{a.kind}">{artifactLabel(a, 40)}</span>{/if}
      {/each}
      {#if placements.length > 6}<span class="mchip">+{placements.length - 6}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .hrow {
    position: relative;
    padding-left: calc(var(--depth) * 22px);
    border-radius: 8px;
  }
  .hrow.drop-before::before,
  .hrow.drop-after::after {
    content: '';
    position: absolute;
    left: calc(var(--depth) * 22px);
    right: 0;
    height: 2px;
    background: var(--accent);
    border-radius: 2px;
  }
  .hrow.drop-before::before {
    top: -1px;
  }
  .hrow.drop-after::after {
    bottom: -1px;
  }
  .hrow:global(.dnd-over):not(.drop-inside) {
    outline: none;
    background: transparent !important;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 38px;
  }
  .grip {
    display: grid;
    place-items: center;
    width: 20px;
    height: 28px;
    color: var(--faint);
    cursor: grab;
    opacity: 0;
    touch-action: none;
    transition: opacity var(--dur);
  }
  .hrow:hover > .line .grip,
  .hrow:focus-within > .line .grip {
    opacity: 1;
  }
  @media (hover: none) {
    .grip {
      opacity: 0.6;
    }
  }
  .tw {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
    border-radius: 4px;
  }
  .tw:hover {
    background: var(--surface-2);
  }
  .tw.hidden {
    visibility: hidden;
  }
  .num {
    min-width: 2.2em;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    font-size: 0.8em;
  }
  .title {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    padding: 4px 0;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .d0 .title {
    font-size: 1.2em;
  }
  .d1 .title {
    font-size: 1.05em;
  }
  .d2 .title,
  .d3 .title,
  .d4 .title,
  .d5 .title {
    font-weight: 500;
  }
  .title::placeholder {
    color: var(--faint);
    font-weight: 400;
  }
  .side {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .side .chip {
    border: 0;
    cursor: pointer;
  }
  .tgt {
    font-size: 0.72rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 0.72rem;
    cursor: pointer;
  }
  .status:hover {
    background: var(--surface-2);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--faint);
  }
  .s-draft .dot {
    background: var(--k-quote);
  }
  .s-revise .dot {
    background: var(--warn);
  }
  .s-done .dot {
    background: var(--ok);
  }
  .s-idea .slabel {
    display: none;
  }
  .body {
    position: relative;
    margin: 0 0 8px 66px;
    padding: 6px 12px;
    border-left: 2px solid var(--border);
  }
  .wc {
    position: absolute;
    right: 4px;
    bottom: 2px;
  }
  .preview {
    display: block;
    max-width: calc(100% - 66px);
    margin: -4px 0 6px 66px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 0.85rem;
    text-align: left;
    cursor: text;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .placed {
    display: grid;
    gap: 6px;
    margin: 0 0 10px 66px;
  }
  .dropzone {
    padding: 8px;
    border: 1px dashed var(--border-strong);
    border-radius: 8px;
    color: var(--faint);
    text-align: center;
  }
  .mini {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: -2px 0 6px 66px;
  }
  .mchip {
    max-width: 220px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.72rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-left: 3px solid var(--k-quote);
  }
  .mchip.k-paraphrase {
    border-left-color: var(--k-paraphrase);
  }
  .mchip.k-note {
    border-left-color: var(--k-note);
  }
  .mchip.k-image {
    border-left-color: var(--k-image);
  }
  @media (max-width: 600px) {
    .hrow {
      padding-left: calc(var(--depth) * 12px);
    }
    .body,
    .placed,
    .mini,
    .preview {
      margin-left: 24px;
    }
    .slabel {
      display: none;
    }
    .num {
      min-width: 1.6em;
    }
  }
</style>
