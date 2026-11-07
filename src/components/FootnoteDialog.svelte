<script lang="ts">
  // A footnote is free text, like the main text: combine any number of quotes and
  // citations with your own words ("Vgl. …; ferner …", "Zit. n. …").
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { editorState } from '../lib/editorState.svelte';
  import { artifactLabel, projectArtifacts, shortCite } from '../lib/ops';
  import { createFootnoteEditor, editableQuote, footnoteEditorContent, makeEditable, selectedQuotePos } from '../lib/editor.svelte';

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

  const items = $derived(
    (ui.projectId ? projectArtifacts(ui.projectId) : db.all('artifacts')).filter((a) => a.kind === 'quote' || a.kind === 'paraphrase')
  );
  const insertMenu = $derived(
    items.length
      ? items.map((a) => ({ label: `${artifactLabel(a, 60)} — ${shortCite(a)}`, icon: a.kind, run: () => insert(a.id) }))
      : [{ label: t('No quotes in this project yet'), run: () => {} }]
  );

  function insert(id: string) {
    if (!editor) return;
    // focus right away (TipTap's focus() waits a frame; typing in between would be lost)
    editor.view.focus();
    const chain = editor.chain().focus();
    if (mode === 'editable') chain.insertContent(editableQuote(id)).run();
    // no space after it: what follows may be punctuation ("…; ferner …")
    else chain.insertContent({ type: 'quoteRef', attrs: { id, mode } }).run();
  }

  const is = (name: string) => {
    void tick;
    return editor?.isActive(name) ?? false;
  };
  const quoteSelected = () => {
    void tick;
    return !!editor && selectedQuotePos(editor) != null;
  };

  onMount(() => {
    editor = createFootnoteEditor({ element: host, content: fn.content, placeholder: t('Text, quotes and citations, e.g. “Vgl. …; ferner …”') });
    editor.on('transaction', () => tick++);
    setTimeout(() => editor?.commands.focus('end'), 30);
    return () => editor?.destroy();
  });

  function close() {
    editorState.footnote = null;
  }
  function save() {
    if (editor) fn.save(footnoteEditorContent(editor));
    close();
  }
  function remove() {
    fn.remove();
    close();
  }
  function key(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  }
</script>

<Modal title={t('Footnote')} onclose={close} width="620px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fd" onkeydown={key}>
    <div class="tools row" role="toolbar" aria-label={t('Formatting')}>
      <button class="icon-btn fmt" class:active={is('bold')} aria-label={t('Bold')} title="{t('Bold')} (Ctrl+B)" onclick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
      <button class="icon-btn fmt" class:active={is('italic')} aria-label={t('Italic')} title="{t('Italic')} (Ctrl+I)" onclick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button class="icon-btn fmt" class:active={is('underline')} aria-label={t('Underline')} title="{t('Underline')} (Ctrl+U)" onclick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
      <span class="sep"></span>
      <Menu items={insertMenu} label={t('Insert a quote or citation')}>
        {#snippet trigger()}<Icon name="plus" size={14} />{t('Insert citation')}{/snippet}
      </Menu>
      <select class="select mode" bind:value={mode} aria-label={t('Insert as')} title={t(MODES.find((m) => m.id === mode)!.hint)}>
        {#each MODES as m (m.id)}<option value={m.id}>{t(m.label)}</option>{/each}
      </select>
      {#if quoteSelected()}
        <button class="btn sm" title={t('Turn the selected quote into editable text to shorten or adapt it; the citation stays linked')} onclick={() => { if (editor) { const p = selectedQuotePos(editor); if (p != null) makeEditable(editor, p); } }}>
          <Icon name="edit" size={14} />{t('Edit quote text')}
        </button>
      {/if}
    </div>
    <div class="fed" bind:this={host} aria-label={t('Footnote text')}></div>
    <p class="tiny muted">{t('Combine as many quotes and citations as you like with your own words. Citations stay linked to the library; right-click a quote to edit its text.')}</p>
  </div>
  {#snippet footer()}
    <button class="btn danger" onclick={remove}><Icon name="trash" size={14} />{t('Delete footnote')}</button>
    <span class="grow"></span>
    <button class="btn" onclick={close}>{t('Cancel')}</button>
    <button class="btn primary" onclick={save} title="Ctrl+Enter">{t('Save')}</button>
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
