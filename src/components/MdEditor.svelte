<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, keymap, placeholder as ph, drawSelection } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { markdown } from '@codemirror/lang-markdown';
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { tags } from '@lezer/highlight';

  let {
    value,
    onchange,
    placeholder = '',
    autofocus = false,
    minHeight = '3em',
    onkeydown,
    onfocused,
    label = ''
  }: {
    value: string;
    onchange: (v: string) => void;
    placeholder?: string;
    autofocus?: boolean;
    minHeight?: string;
    onkeydown?: (e: KeyboardEvent) => boolean | void;
    onfocused?: () => void;
    label?: string;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;

  const live = HighlightStyle.define([
    { tag: tags.heading1, fontSize: '1.3em', fontWeight: '650' },
    { tag: tags.heading2, fontSize: '1.15em', fontWeight: '650' },
    { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '650' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: 'var(--accent-text)', textDecoration: 'underline' },
    { tag: tags.url, color: 'var(--muted)' },
    { tag: tags.quote, color: 'var(--muted)', fontStyle: 'italic' },
    { tag: tags.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.92em' },
    { tag: [tags.processingInstruction, tags.meta], color: 'var(--faint)' },
    { tag: tags.list, color: 'var(--accent-text)' }
  ]);

  const theme = EditorView.theme({
    '&': { background: 'transparent', fontSize: '1em' },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': {
      fontFamily: 'var(--font-text)',
      lineHeight: '1.65',
      padding: '4px 0',
      minHeight: 'var(--cm-min)',
      caretColor: 'var(--accent)'
    },
    '.cm-line': { padding: '0' },
    '.cm-placeholder': { color: 'var(--faint)', fontStyle: 'italic' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      background: 'color-mix(in srgb, var(--accent) 25%, transparent) !important'
    }
  });

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          EditorView.domEventHandlers({
            keydown: (e) => (onkeydown ? onkeydown(e) === true : false)
          }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          syntaxHighlighting(live),
          EditorView.lineWrapping,
          ph(placeholder),
          EditorView.contentAttributes.of({ 'aria-label': label || placeholder, 'aria-multiline': 'true' }),
          theme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onchange(u.state.doc.toString());
          })
        ]
      })
    });
    if (autofocus) {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      onfocused?.();
    }
    return () => view?.destroy();
  });

  // Reflect external changes (sync, undo) when not focused.
  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString() && !view.hasFocus) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  });

  export function focus() {
    view?.focus();
  }
</script>

<div class="mdedit" bind:this={host} style="--cm-min:{minHeight}"></div>

<style>
  .mdedit {
    width: 100%;
    cursor: text;
  }
</style>
