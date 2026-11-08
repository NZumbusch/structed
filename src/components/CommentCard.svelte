<script lang="ts">
  // The comment on the passage at the cursor, shown just below it: write, resolve, close.
  import type { Editor } from '@tiptap/core';
  import { tick as svelteTick, untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import { t } from '../lib/i18n';
  import { addComment, commentAt, findComment, removeComment, setCommentText, type CommentAt } from '../lib/textComment';

  let { editor, tick, scrollTick }: { editor: () => Editor | undefined; tick: number; scrollTick: number } = $props();

  let shown = $state<{ editor: Editor; c: CommentAt } | null>(null);
  let draft = $state('');
  let box = $state<HTMLDivElement>();
  let area = $state<HTMLTextAreaElement>();
  /** the card was closed here: it stays closed until the cursor moves */
  let closedAt: { id: string; head: number } | null = null;

  const inCard = () => !!box && box.contains(document.activeElement);

  /** a comment without words when it is left behind is removed again */
  function dropIfEmpty(s: { editor: Editor; c: CommentAt } | null) {
    if (!s || draft.trim() || s.c.text.trim()) return;
    const c = findComment(s.editor, s.c.id);
    if (c && !c.text.trim()) removeComment(s.editor, c);
  }

  $effect(() => {
    void tick;
    untrack(() => {
      if (inCard()) return;
      const e = editor();
      if (!e || !e.isFocused) return;
      const c = commentAt(e);
      if (c && closedAt && c.id === closedAt.id && e.state.selection.head === closedAt.head) return;
      closedAt = null;
      if (c && shown && shown.c.id === c.id) {
        shown = { editor: e, c };
        return;
      }
      save();
      dropIfEmpty(shown);
      shown = c ? { editor: e, c } : null;
      draft = c?.text ?? '';
    });
  });

  function save() {
    if (!shown) return;
    const c = findComment(shown.editor, shown.c.id);
    if (c && c.text !== draft) setCommentText(shown.editor, c, draft);
  }

  /** comment the selected text and start writing */
  export async function start(e: Editor) {
    save();
    const c = addComment(e);
    if (!c) return false;
    shown = { editor: e, c };
    draft = '';
    await svelteTick();
    area?.focus();
    return true;
  }

  function resolve() {
    if (!shown) return;
    const c = findComment(shown.editor, shown.c.id);
    if (c) removeComment(shown.editor, c);
    shown.editor.commands.focus();
    shown = null;
  }
  function close() {
    if (!shown) return;
    save();
    const s = shown;
    dropIfEmpty(s);
    shown = null;
    s.editor.commands.focus();
    closedAt = { id: s.c.id, head: s.editor.state.selection.head };
  }

  const pos = $derived.by(() => {
    void scrollTick;
    void tick;
    if (!shown) return null;
    try {
      const c = findComment(shown.editor, shown.c.id);
      if (!c) return null;
      const a = shown.editor.view.coordsAtPos(c.from);
      const b = shown.editor.view.coordsAtPos(c.to);
      const left = Math.max(8, Math.min(a.left, window.innerWidth - 300));
      return { left, top: Math.max(a.bottom, b.bottom) + 6 };
    } catch {
      return null;
    }
  });
</script>

{#if shown && pos}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="ccard"
    bind:this={box}
    role="group"
    aria-label={t('Comment')}
    style="left:{pos.left}px; top:{pos.top}px"
    onfocusout={() => setTimeout(() => !inCard() && save(), 0)}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        close();
      }
    }}
  >
    <textarea bind:this={area} bind:value={draft} rows="2" placeholder={t('Comment on this passage…')} aria-label={t('Comment')}></textarea>
    <div class="row">
      <span class="tiny muted grow">{t('Ctrl+Enter or Esc: done')}</span>
      <button class="icon-btn sm" title={t('Resolve (removes the comment)')} aria-label={t('Resolve')} onclick={resolve}><Icon name="check" size={14} /></button>
      <button class="icon-btn sm" title={t('Close')} aria-label={t('Close')} onclick={close}><Icon name="x" size={14} /></button>
    </div>
  </div>
{/if}

<style>
  .ccard {
    position: fixed;
    z-index: 5;
    width: min(290px, calc(100vw - 16px));
    display: grid;
    gap: 4px;
    padding: 6px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--warn);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 2.6em;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 0.85rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .grow {
    flex: 1;
  }
</style>
