<script lang="ts">
  // A footnote is free text, like the main text: combine any number of quotes and
  // citations with your own words ("Vgl. …; ferner …", "Zit. n. …").
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import QuotePicker from './QuotePicker.svelte';
  import { t } from '../lib/i18n';
  import { editorState } from '../lib/editorState.svelte';
  import { createFootnoteEditor, editableQuote, footnoteEditorContent, insertCitation, makeEditable, selectedQuotePos } from '../lib/editor.svelte';

  const fn = editorState.footnote!;
  let host: HTMLDivElement;
  let editor: Editor | null = null;
  let tick = $state(0); // re-render the toolbar on selection changes

  type Mode = 'inline' | 'cite' | 'editable';
  let mode = $state<Mode>('cite');
  const MODES: { id: Mode; label: string; hint: string }[] = [
    { id: 'cite', label: 'Citation only', hint: 'Only the reference, e.g. “Vgl. Assmann 1992, S. 31”' },
    { id: 'inline', label: 'Quote + citation', hint: 'The quote in quotation marks, then the reference' },
    { id: 'editable', label: 'As editable text', hint: 'The quote as text you can shorten or adapt; the reference stays linked' }
  ];

  /** the search to find a citation among many */
  let picking = $state(false);

  function insert(id: string, keep = false) {
    picking = keep;
    if (!editor) return;
    // focus right away (TipTap's focus() waits a frame; typing in between would be lost)
    editor.view.focus();
    const chain = editor.chain().focus();
    if (mode === 'editable') chain.insertContent(editableQuote(id)).run();
    // no space after it: what follows may be punctuation ("…; ferner …")
    else if (mode === 'cite') {
      chain.run();
      insertCitation(editor, editor.state.selection.from, editor.state.selection.to, id);
    } else chain.insertContent({ type: 'quoteRef', attrs: { id, mode } }).run();
  }

  const is = (name: string) => {
    void tick;
    return editor?.isActive(name) ?? false;
  };
  const quoteSelected = () => {
    void tick;
    return !!editor && selectedQuotePos(editor) != null;
  };

  // the footnote saves itself while you type, like everything else in the app;
  // closing it in any way keeps what was written
  const original = JSON.stringify(fn.content);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const current = () => (editor ? footnoteEditorContent(editor) : fn.content);

  onMount(() => {
    editor = createFootnoteEditor({ element: host, content: fn.content, placeholder: t('Text, quotes and citations, e.g. “Vgl. …; ferner …”') });
    editor.on('transaction', () => tick++);
    editor.on('update', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.save(current(), false);
      }, 300);
    });
    // focus at once, so the first keys typed land in the footnote
    editor.view.focus();
    editor.commands.focus('end');
    return () => {
      finish(); // e.g. switching to another stage
      editor?.destroy();
    };
  });

  /** final save: one undo step from the footnote as it was to the footnote as it is */
  function finish() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    const now = current();
    const json = JSON.stringify(now);
    try {
      if (!now.length && original === '[]') fn.remove(); // a new footnote left empty
      else if (json === original) fn.save(fn.content, false);
      else {
        fn.save(fn.content, false);
        fn.save(now, true);
      }
    } catch {
      /* the text was closed first */
    }
  }

  function close() {
    finish();
    editorState.footnote = null;
    setTimeout(() => fn.focusAfter?.(), 0); // after the dialog has gone, keep writing
  }
  function remove() {
    if (timer) clearTimeout(timer);
    closed = true;
    fn.remove();
    editorState.footnote = null;
  }
  function key(e: KeyboardEvent) {
    // (in the quote search, Ctrl+Enter means "insert and keep it open")
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !(e.target as HTMLElement).closest('.qp')) {
      e.preventDefault();
      close();
    }
  }
</script>

<Modal title={t('Footnote')} onclose={close} width="980px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fd" onkeydowncapture={key}>
    <div class="tools row" role="toolbar" aria-label={t('Formatting')}>
      <button class="icon-btn fmt" class:active={is('bold')} aria-label={t('Bold')} title="{t('Bold')} (Ctrl+B)" onclick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
      <button class="icon-btn fmt" class:active={is('italic')} aria-label={t('Italic')} title="{t('Italic')} (Ctrl+I)" onclick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button class="icon-btn fmt" class:active={is('underline')} aria-label={t('Underline')} title="{t('Underline')} (Ctrl+U)" onclick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
      <span class="sep"></span>
      <button class="btn sm" class:on={picking} aria-expanded={picking} onclick={() => (picking = !picking)} title={t('Insert a quote or citation')}>
        <Icon name="plus" size={14} />{t('Insert citation')}
      </button>
      <select class="select mode" bind:value={mode} aria-label={t('Insert as')} title={t(MODES.find((m) => m.id === mode)!.hint)}>
        {#each MODES as m (m.id)}<option value={m.id}>{t(m.label)}</option>{/each}
      </select>
      {#if quoteSelected()}
        <button class="btn sm" title={t('Turn the selected quote into editable text to shorten or adapt it; the citation stays linked')} onclick={() => { if (editor) { const p = selectedQuotePos(editor); if (p != null) makeEditable(editor, p); } }}>
          <Icon name="edit" size={14} />{t('Edit quote text')}
        </button>
      {/if}
    </div>
    {#if picking}
      <div class="picker">
        <QuotePicker headingId={editorState.active?.headingId ?? null} onpick={insert} onclose={() => ((picking = false), editor?.commands.focus())} />
      </div>
    {/if}
    <div class="fed" bind:this={host} aria-label={t('Footnote text')}></div>
    <p class="tiny muted">{t('Combine as many quotes and citations as you like with your own words. Citations stay linked to the library; right-click a quote to edit its text.')}</p>
  </div>
  {#snippet footer()}
    <button class="btn danger" onclick={remove}><Icon name="trash" size={14} />{t('Delete footnote')}</button>
    <span class="grow tiny muted saved">{t('Saved automatically')}</span>
    <button class="btn primary" onclick={close} title="Ctrl+Enter / Esc">{t('Done')}</button>
  {/snippet}
</Modal>

<style>
  .fd {
    display: grid;
    gap: 10px;
  }
  .tools {
    flex-wrap: wrap;
    gap: 4px;
  }
  .fmt {
    font-family: var(--font-serif);
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
  .picker {
    padding: 10px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .btn.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .fed {
    min-height: 110px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    cursor: text;
  }
  .fed:focus-within {
    border-color: var(--accent);
  }
  .fed :global(.fnprose) {
    outline: none;
    min-height: 90px;
    font-family: var(--font-text);
    line-height: 1.6;
  }
  .fed :global(.fnprose p) {
    margin: 0 0 0.4em;
  }
  .fed :global(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--faint);
    pointer-events: none;
    font-style: italic;
  }
  .fed :global(.qref) {
    border-radius: 4px;
    background: color-mix(in srgb, var(--k-quote) 10%, transparent);
    cursor: pointer;
  }
  .fed :global(.qref.cite-only) {
    background: color-mix(in srgb, var(--k-paraphrase) 12%, transparent);
  }
  .fed :global(.ProseMirror-selectednode) {
    outline: 2px solid var(--accent);
  }
  p {
    margin: 0;
  }
</style>
