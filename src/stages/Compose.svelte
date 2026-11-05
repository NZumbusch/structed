<script lang="ts">
  // "Schreiben": the final text, one editor per heading of the outline.
  import type { Editor } from '@tiptap/core';
  import Icon from '../components/Icon.svelte';
  import Menu from '../components/Menu.svelte';
  import SectionEditor from '../components/SectionEditor.svelte';
  import FootnoteDialog from '../components/FootnoteDialog.svelte';
  import WordExport from '../components/WordExport.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { flatten, wordCount, placementsOf, artifactLabel } from '../lib/ops';
  import { draftText } from '../lib/editor.svelte';
  import { editorState, type InsertMode } from '../lib/editorState.svelte';
  import { matches } from '../lib/shortcuts';
  import type { Project } from '../lib/types';

  let { project }: { project: Project } = $props();
  const flat = $derived(flatten(project.id));
  const editors = new Map<string, Editor>();
  let tick = $state(0); // re-render toolbar state on selection changes
  let exportOpen = $state(false);

  const total = $derived(flat.reduce((n, f) => n + wordCount(draftText(f.h.draft)), 0));
  const activeEditor = () => (editorState.active ? editors.get(editorState.active.headingId) : undefined);

  function reg(id: string, e: Editor) {
    editors.set(id, e);
    e.on('selectionUpdate', () => tick++);
    e.on('transaction', () => tick++);
  }
  const is = (name: string) => {
    void tick; // re-evaluate when the selection changes
    return activeEditor()?.isActive(name) ?? false;
  };
  const cmd = (fn: (e: Editor) => void) => {
    const e = activeEditor();
    if (e) fn(e);
  };

  function footnote() {
    cmd((e) => {
      e.chain().focus().insertContent({ type: 'footnote', attrs: { before: '', quoteId: null, after: '' } }).run();
      // open the dialog for the new footnote
      setTimeout(() => {
        const marks = e.view.dom.querySelectorAll<HTMLElement>('sup.fn');
        const sel = e.state.selection.from;
        let best: HTMLElement | null = null;
        let dist = Infinity;
        marks.forEach((m) => {
          const pos = e.view.posAtDOM(m, 0);
          if (Math.abs(pos - sel) < dist) {
            dist = Math.abs(pos - sel);
            best = m;
          }
        });
        (best as HTMLElement | null)?.click();
      }, 30);
    });
  }

  function keys(e: KeyboardEvent) {
    if (matches(e, 'write.footnote')) {
      e.preventDefault();
      footnote();
    }
  }

  const MODES: { id: InsertMode; label: string; icon: string }[] = [
    { id: 'inline', label: 'In the sentence', icon: 'quote' },
    { id: 'block', label: 'Block quote', icon: 'paraphrase' },
    { id: 'footnote', label: 'In a footnote', icon: 'note' },
    { id: 'cite', label: 'Citation only', icon: 'book' }
  ];

  // quick insert from the items placed under the current section
  const here = $derived(editorState.active ? placementsOf(editorState.active.headingId).map((p) => db.get('artifacts', p.artifactId)).filter((a) => !!a) : []);
  const quickMenu = $derived(
    here.length
      ? here.flatMap((a) => [{ label: artifactLabel(a!, 50), icon: a!.kind, run: () => editorState.active?.insertArtifact(a!.id, settings.insertMode) }])
      : [{ label: t('No items placed under this heading – use the library panel'), run: () => {} }]
  );
</script>

<svelte:window onkeydown={keys} />

<div class="compose scroll" data-tour="compose">
  <div class="bar" role="toolbar" aria-label={t('Formatting')}>
    <button class="icon-btn fmt" class:active={is('bold')} title="{t('Bold')} (Ctrl+B)" aria-label={t('Bold')} onclick={() => cmd((e) => e.chain().focus().toggleBold().run())}><b>B</b></button>
    <button class="icon-btn fmt" class:active={is('italic')} title="{t('Italic')} (Ctrl+I)" aria-label={t('Italic')} onclick={() => cmd((e) => e.chain().focus().toggleItalic().run())}><i>I</i></button>
    <button class="icon-btn fmt" class:active={is('underline')} title="{t('Underline')} (Ctrl+U)" aria-label={t('Underline')} onclick={() => cmd((e) => e.chain().focus().toggleUnderline().run())}><u>U</u></button>
    <span class="sep"></span>
    <button class="icon-btn" class:active={is('bulletList')} title={t('Bullet list')} aria-label={t('Bullet list')} onclick={() => cmd((e) => e.chain().focus().toggleBulletList().run())}><Icon name="menu" size={16} /></button>
    <button class="icon-btn" class:active={is('blockquote')} title={t('Block quote (own text)')} aria-label={t('Block quote (own text)')} onclick={() => cmd((e) => e.chain().focus().toggleBlockquote().run())}><Icon name="quote" size={16} /></button>
    <button class="btn sm" title="{t('Footnote')} (Ctrl+Alt+F)" onclick={footnote}><sup>1</sup> {t('Footnote')}</button>
    <span class="sep"></span>
    <Menu items={quickMenu} label={t('Insert a quote placed here')}>
      {#snippet trigger()}<Icon name="plus" size={14} />{t('Insert quote')}{/snippet}
    </Menu>
    <select class="select mode" bind:value={settings.insertMode} aria-label={t('Insert quotes as')} title={t('Insert quotes as')}>
      {#each MODES as m (m.id)}<option value={m.id}>{t(m.label)}</option>{/each}
    </select>
    <span class="grow"></span>
    <span class="tiny muted wc">{total.toLocaleString()} {t('words')}</span>
    <button class="icon-btn" title={t('Undo')} aria-label={t('Undo')} onclick={() => cmd((e) => e.chain().focus().undo().run())}><Icon name="undo" size={16} /></button>
    <button class="btn sm primary" onclick={() => (exportOpen = true)}><Icon name="file" size={14} />{t('Word export')}</button>
  </div>

  <article class="paper w-{settings.editorWidth}">
    <h1 class="dtitle">{project.title || t('Untitled project')}</h1>
    {#if project.subtitle}<p class="dsub">{project.subtitle}</p>{/if}
    {#each flat as f (f.h.id)}
      <section class="sec d{Math.min(f.depth, 2)}" data-sec={f.h.id}>
        <svelte:element this={`h${Math.min(f.depth + 2, 4)}`} class="ht">
          <span class="hn">{f.num}</span>{f.h.title || t('Untitled')}
        </svelte:element>
        {#if f.h.body.trim() && !f.h.draft}
          <p class="gist small muted"><Icon name="note" size={12} /> {f.h.body.replace(/\s+/g, ' ').slice(0, 200)}</p>
        {/if}
        <SectionEditor h={f.h} onEditor={reg} />
      </section>
    {:else}
      <div class="empty">{t('Add headings in the Outline first – each heading becomes a section here.')}</div>
    {/each}
  </article>
</div>

{#if editorState.footnote}<FootnoteDialog />{/if}
{#if exportOpen}<WordExport {project} onclose={() => (exportOpen = false)} />{/if}

<style>
  .compose {
    height: 100%;
    counter-reset: fn;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 6px 16px;
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--border);
  }
  .fmt {
    font-family: var(--font-serif);
    font-size: 1rem;
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
  }
  .mode {
    width: auto;
    min-height: 28px;
    height: 28px;
    padding: 0 6px;
    font-size: 0.8rem;
  }
  .wc {
    margin-right: 6px;
  }
  .paper {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 28px 24px 200px;
  }
  .paper.w-narrow {
    max-width: 640px;
  }
  .paper.w-wide {
    max-width: 1000px;
  }
  .dtitle {
    font-size: 1.9em;
    letter-spacing: -0.02em;
  }
  .dsub {
    margin: 4px 0 0;
    color: var(--muted);
  }
  .sec {
    margin-top: 26px;
  }
  .ht {
    margin: 0 0 6px;
  }
  :global(.compose h2.ht) {
    font-size: 1.35em;
  }
  :global(.compose h3.ht) {
    font-size: 1.12em;
  }
  :global(.compose h4.ht) {
    font-size: 1em;
  }
  .hn {
    margin-right: 10px;
    color: var(--faint);
    font-weight: 500;
  }
  .gist {
    margin: 0 0 6px;
    font-style: italic;
  }
  .empty {
    padding: 40px 0;
    color: var(--muted);
  }
  /* editor typography */
  .compose :global(.prose) {
    outline: none;
    font-family: var(--font-text);
    line-height: 1.7;
    text-align: justify;
    hyphens: auto;
    overflow-wrap: break-word;
    min-height: 2em;
  }
  .compose :global(.prose p) {
    margin: 0 0 0.7em;
  }
  .compose :global(.prose p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--faint);
    pointer-events: none;
    font-style: italic;
  }
  .compose :global(.prose blockquote),
  .compose :global(.qblock) {
    margin: 0.8em 2.2em;
    font-style: italic;
    text-align: left;
  }
  .compose :global(.qblock) {
    padding: 2px 4px;
    border-radius: 6px;
    cursor: grab;
  }
  .compose :global(.qb-text) {
    margin: 0;
  }
  .compose :global(.qb-cite) {
    margin: 2px 0 0;
    text-align: center;
    font-style: normal;
    color: var(--muted);
  }
  .compose :global(.qref) {
    border-radius: 4px;
    background: color-mix(in srgb, var(--k-quote) 10%, transparent);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    cursor: pointer;
  }
  .compose :global(.qref.cite-only) {
    background: color-mix(in srgb, var(--k-paraphrase) 12%, transparent);
  }
  .compose :global(.qref[data-kind='missing']) {
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }
  .compose :global(.ProseMirror-selectednode) {
    outline: 2px solid var(--accent);
  }
  .compose :global(sup.fn) {
    cursor: pointer;
    color: var(--accent-text);
    font-weight: 600;
    padding: 0 1px;
  }
  .compose :global(sup.fn::after) {
    counter-increment: fn;
    content: counter(fn);
  }
  .compose :global(.prose ul),
  .compose :global(.prose ol) {
    padding-left: 1.4em;
  }
  @media (max-width: 700px) {
    .paper {
      padding: 16px 14px 160px;
    }
    .compose :global(.prose) {
      text-align: left;
    }
    .bar {
      padding: 6px 8px;
    }
    .wc {
      display: none;
    }
  }
</style>
