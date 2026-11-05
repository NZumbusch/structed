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
    splitHeading,
    wordCount
  } from '../lib/ops';
  import type { FlatHeading } from '../lib/ops';
  import { matches } from '../lib/shortcuts';
  import { autosize, caretAtEdge } from '../lib/autosize';
  import type { HeadingStatus } from '../lib/types';

  let { f, mode }: { f: FlatHeading; mode: 'outline' | 'arrange' } = $props();
  const h = $derived(f.h);

  let input: HTMLTextAreaElement;
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
    const el = e.currentTarget as HTMLTextAreaElement;
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (matches(e, 'outline.newHeading'))
      run(() => (ui.focusHeading = splitHeading(h, el.value, el.selectionStart ?? el.value.length, f.hasChildren && !collapsed)));
    else if (matches(e, 'outline.notes'))
      run(() => {
        ui.openBodies.add(h.id);
        ui.focusBody = h.id;
      });
    else if (matches(e, 'outline.addChild'))
      run(() => {
        ui.collapsed.delete(h.id);
        ui.focusHeading = addChildHeading(h).id;
      });
    else if (matches(e, 'outline.indent')) run(() => (indent(h), (ui.focusHeading = h.id)));
    else if (matches(e, 'outline.outdent')) run(() => (outdent(h), (ui.focusHeading = h.id)));
    else if (matches(e, 'outline.moveUp')) run(() => (moveUpDown(h, -1), (ui.focusHeading = h.id)));
    else if (matches(e, 'outline.moveDown')) run(() => (moveUpDown(h, 1), (ui.focusHeading = h.id)));
    else if (matches(e, 'outline.prev') && caretAtEdge(el, -1)) run(() => focusSibling(-1));
    else if (matches(e, 'outline.next') && caretAtEdge(el, 1)) run(() => focusSibling(1));
    else if (matches(e, 'outline.collapse')) run(() => ui.toggle(ui.collapsed, h.id));
    else if (matches(e, 'outline.status')) run(cycleStatus);
    else if (matches(e, 'outline.delete'))
      run(() => {
        focusSibling(-1);
        deleteHeading(h);
        ui.toast(t('Heading deleted'), { action: { label: t('Undo'), run: () => db.undo() } });
      });
    else if (e.key === 'Backspace' && !el.value && !h.body && !placements.length && !f.hasChildren)
      run(() => {
        focusSibling(-1);
        db.remove('headings', h.id);
      });
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
  const plain = (md: string) =>
    md
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/[*_`#>]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
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
    <textarea
      bind:this={input}
      class="title"
      rows="1"
      value={h.title}
      use:autosize={h.title}
      aria-label={f.num + ' ' + (h.title || (f.depth === 0 ? t('Heading') : t('Subheading')))}
      placeholder={f.depth === 0 ? t('Heading') : t('Subheading')}
      oninput={(e) => {
        const v = e.currentTarget.value.replace(/\s*\n\s*/g, ' ');
        if (v !== e.currentTarget.value) e.currentTarget.value = v;
        db.update('headings', h.id, { title: v });
      }}
      onkeydown={key}
    ></textarea>
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
      <button class="status s-{h.status ?? 'idea'}" class:hov={(h.status ?? 'idea') === 'idea'} onclick={cycleStatus} title={t('Status') + ': ' + t(h.status ?? 'idea')}>
        <span class="dot"></span><span class="slabel">{t(h.status ?? 'idea')}</span>
      </button>
      <button class="icon-btn sm hov" class:active={bodyOpen} onclick={() => ui.toggle(ui.openBodies, h.id)} title={t('Notes / gist')}>
        <Icon name="note" size={15} />
      </button>
      <span class="hov"><Menu items={menu} /></span>
    </div>
  </div>

  {#if bodyOpen}
    <div class="body">
      <MdEditor
        value={h.body}
        onchange={(v) => db.update('headings', h.id, { body: v })}
        placeholder={t('Gist, arguments, draft… (markdown)')}
        onkeydown={bodyKey}
        label={t('Notes for “{h}”', { h: h.title || t('Untitled') })}
        autofocus={ui.focusBody === h.id}
        onfocused={() => ui.focusBody === h.id && (ui.focusBody = null)}
      />
      {#if words}<span class="wc tiny muted">{words} {t('words')}</span>{/if}
    </div>
  {:else if h.body && mode === 'outline'}
    <button class="preview" onclick={() => { ui.openBodies.add(h.id); ui.focusBody = h.id; }}>{plain(h.body)}</button>
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
    /* number column grows with depth so titles of siblings line up */
    --numw: calc(1.4rem + var(--depth) * 1rem);
    --textx: calc(42px + var(--numw));
    position: relative;
    min-width: 0;
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
    align-items: flex-start;
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
    flex: none;
    width: var(--numw);
    padding-right: 0.5rem;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .title {
    flex: 1;
    width: 0;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    padding: 4px 0;
    resize: none;
    overflow: hidden;
    line-height: 1.35;
    font-family: inherit;
    color: inherit;
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
    gap: 2px;
    padding-top: 3px;
  }
  .grip,
  .tw,
  .num {
    margin-top: 6px;
  }
  .d0 .grip,
  .d0 .tw,
  .d0 .num {
    margin-top: 9px;
  }
  /* calm by default: actions appear on hover/focus (touch devices always show them) */
  @media (hover: hover) {
    .side .hov {
      opacity: 0;
      transition: opacity var(--dur);
    }
    .hrow:hover > .line .side .hov,
    .hrow:focus-within > .line .side .hov {
      opacity: 1;
    }
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
    background: var(--deco);
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
    margin: 0 0 8px var(--textx);
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
    max-width: calc(100% - var(--textx));
    margin: -2px 0 8px var(--textx);
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
    margin: 0 0 10px var(--textx);
  }
  .mini {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: -2px 0 8px var(--textx);
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
