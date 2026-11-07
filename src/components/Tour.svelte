<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui, type Stage } from '../lib/ui.svelte';
  import { setPanelOpen, settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { comboFor, displayCombo } from '../lib/shortcuts';
  import { askRemoveDemo, createDemo, hasDemo } from '../lib/demo';

  interface Step {
    target?: string; // CSS selector
    stage?: Stage;
    panel?: boolean;
    before?: () => void;
    title: string;
    text: string;
  }

  const k = (id: string) => displayCombo(comboFor(id)) || t('(unassigned)');

  const steps: Step[] = [
    { title: 'Welcome to Structed', text: 'This short tour shows every part of the app. You can leave it any time and restart it in Settings → About & help.' },
    { target: '[data-tour="project"]', title: 'Projects', text: 'Each essay, paper or thesis is a project. Open the menu to switch projects, export, take snapshots or import from Zotero.' },
    { target: '[data-tour="stages"]', title: 'Five stages', text: 'Work in stages, like tabs: Outline the structure, Collect quotes, Select what this project needs, Arrange it under headings, then Write. Shortcuts: {a}–{b}.' },
    { target: '[data-tour="tree"]', stage: 'outline', title: 'Outline', text: 'Type headings like in an outliner: {enter} for a new heading, {tab} / {stab} to indent or outdent, {notes} to write the gist of a section. The dot sets the status, the note icon opens notes.' },
    { target: '[data-tour="sources"]', stage: 'collect', title: 'Sources', text: 'All your sources live in one library shared by all projects – add them by hand or import from Zotero.' },
    { target: '[data-tour="zotero"]', stage: 'collect', title: 'Zotero', text: 'Switch on the Zotero sync in Settings and your sources stay up to date by themselves. Highlights from your PDFs you go through per source, taking or skipping each one. Files (BibTeX, RIS, CSL-JSON) can be imported here too.' },
    { target: '[data-tour="capture"]', stage: 'collect', before: () => { if (!ui.collectSourceId || ui.collectSourceId === '~all') ui.collectSourceId = db.all('sources')[0]?.id ?? '~none'; }, title: 'Capture quotes fast', text: 'Paste a quote, add the page, press Ctrl+Enter. Paraphrases, own notes and images work the same way.' },
    { target: '[data-tour="select"]', stage: 'select', title: 'Select', text: 'Choose what this project needs: whole sources (including their future quotes) or single quotes – everything else stays out of your way in the other stages.' },
    { target: '[data-tour="library"]', stage: 'arrange', panel: true, title: 'Library panel', text: 'Shows the quotes of this project (or, switched, the whole library), grouped by source, author, topic, publication or year. Drag an item onto a heading (long-press on touch). One item can sit under several headings.' },
    { target: '[data-tour="tree"]', stage: 'arrange', title: 'Arrange', text: 'Placed items appear under their heading. Drag them to reorder or move, or drag them back to the panel to remove them.' },
    { target: '[data-tour="compose"]', stage: 'write', title: 'Write', text: 'Write the final text, section by section along your outline. Insert quotes from the panel – they stay linked to the library – add footnotes, and export to Word with your template, table of contents and live Zotero citations.' },
    { target: '[data-tour="search"]', title: 'Search everything', text: 'Press {search} to jump to any heading, quote, source or command.' },
    { target: '[data-tour="sync"]', title: 'Sync & backup', text: 'Connect Google Drive to sync between laptop, tablet and phone. Everything works offline and is stored on your device.' },
    { target: '[data-tour="settings"]', title: 'Make it yours', text: 'Themes, contrast, fonts, citation style, adjustable keyboard shortcuts, backups and this tour live in Settings.' },
    { title: 'You’re ready', text: 'Have fun structuring!' }
  ];

  let i = $state(0);
  let rect = $state<DOMRect | null>(null);
  let createdDemo = $state(false);
  let raf = 0;
  let bh = $state(160);
  const step = $derived(steps[i]);
  const last = $derived(i === steps.length - 1);

  function fill(s: string) {
    return t(s)
      .replace('{a}', k('stageOutline'))
      .replace('{b}', k('stageWrite'))
      .replace('{enter}', k('outline.newHeading'))
      .replace('{tab}', k('outline.indent'))
      .replace('{stab}', k('outline.outdent'))
      .replace('{notes}', k('outline.notes'))
      .replace('{search}', k('search'));
  }

  function measure() {
    const el = step?.target ? document.querySelector(step.target) : null;
    rect = el ? el.getBoundingClientRect() : null;
    raf = requestAnimationFrame(measure);
  }

  async function show(n: number) {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const s = steps[i];
    if (s.stage || s.target) {
      if (!ui.projectId && !db.all('projects').length) {
        ui.projectId = createDemo(settings.language);
        createdDemo = true;
      } else if (!ui.projectId) ui.projectId = db.all('projects')[0].id;
    }
    ui.dialog = null;
    if (s.stage) ui.stage = s.stage;
    s.before?.();
    if (s.panel) {
      if (ui.narrow) ui.panelMobileOpen = true;
      else setPanelOpen(ui.stage, true);
    } else if (ui.narrow) ui.panelMobileOpen = false;
    await tick();
    document.querySelector(s.target ?? '')?.scrollIntoView({ block: 'nearest' });
  }

  function finish() {
    settings.tourDone = true;
    ui.tour = false;
  }
  /** Remove the demo – after a question if you changed it; your own data is never touched. */
  async function removeAndFinish() {
    finish();
    await askRemoveDemo('', true);
  }
  const offerRemove = $derived(last && (createdDemo || hasDemo()));

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      finish();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') show(i + 1);
    else if (e.key === 'ArrowLeft') show(i - 1);
  }

  onMount(() => {
    show(0);
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  });

  const PAD = 6;
  const bubble = $derived.by(() => {
    if (!rect) return 'left:50%; top:50%; transform:translate(-50%,-50%)';
    const w = Math.min(340, innerWidth - 24);
    const h = bh + 4;
    const left = Math.max(12, Math.min(innerWidth - w - 12, rect.left + rect.width / 2 - w / 2));
    const spaceBelow = innerHeight - rect.bottom - PAD - 10;
    const spaceAbove = rect.top - PAD - 10;
    let top: number;
    if (spaceBelow >= h) top = rect.bottom + PAD + 10;
    else if (spaceAbove >= h) top = rect.top - PAD - 10 - h;
    else top = innerHeight - h - 12; // target fills the screen: pin to bottom
    top = Math.max(12, Math.min(top, innerHeight - h - 12));
    return `left:${left}px; top:${top}px; width:${w}px`;
  });
</script>

<svelte:window onkeydown={key} />

<div class="tour" role="dialog" aria-modal="true" aria-label={t('Guided tour')}>
  {#if rect}
    <div class="spot" style="left:{rect.left - PAD}px; top:{rect.top - PAD}px; width:{rect.width + PAD * 2}px; height:{rect.height + PAD * 2}px"></div>
  {:else}
    <div class="dim"></div>
  {/if}
  <div class="bubble" style={bubble} bind:offsetHeight={bh}>
    <div class="row">
      <span class="tiny muted grow">{i + 1} / {steps.length}</span>
      <button class="icon-btn sm" onclick={() => finish()} aria-label={t('Close tour')}><Icon name="x" size={14} /></button>
    </div>
    <h3>{t(step.title)}</h3>
    <p>{fill(step.text)}</p>
    {#if offerRemove}
      <div class="demo">
        <p class="small"><b>{t('Start with a clean slate?')}</b> {t('The demo project and its sample sources and quotes are only for trying things out. Remove them before you start your own work – otherwise they show up in your library and, with Drive sync, on all your devices.')}</p>
        <p class="hint muted">{t('Only demo content is removed – your own projects, sources and quotes stay. You can also remove it later from the project menu.')}</p>
      </div>
    {/if}
    <div class="row actions">
      {#if i > 0}<button class="btn sm" onclick={() => show(i - 1)}>{t('Back')}</button>{/if}
      <span class="grow"></span>
      {#if !last}
        <button class="btn ghost sm" onclick={() => finish()}>{t('Skip tour')}</button>
        <button class="btn primary sm" onclick={() => show(i + 1)}>{t('Next')}</button>
      {:else if offerRemove}
        <button class="btn ghost sm" onclick={() => finish()}>{t('Keep it for now')}</button>
        <button class="btn primary sm" onclick={removeAndFinish}><Icon name="trash" size={14} />{t('Remove demo & start fresh')}</button>
      {:else}
        <button class="btn primary sm" onclick={() => finish()}>{t('Done')}</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 400;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: rgb(10 12 16 / 0.55);
  }
  .spot {
    position: fixed;
    border-radius: 10px;
    box-shadow: 0 0 0 9999px rgb(10 12 16 / 0.55);
    outline: 2px solid var(--accent);
    transition: all 220ms var(--ease);
    pointer-events: none;
  }
  .bubble {
    position: fixed;
    width: min(340px, calc(100vw - 24px));
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  h3 {
    font-size: 1rem;
    margin: 2px 0 6px;
  }
  p {
    margin: 0 0 10px;
    font-size: 0.9rem;
    line-height: 1.55;
  }
  .actions {
    gap: 6px;
  }
  .demo {
    margin: 0 0 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--surface-2);
  }
  .demo p {
    margin: 0 0 4px;
  }
  .demo p:last-child {
    margin: 0;
  }
  .hint {
    font-size: 0.78rem;
  }
</style>
