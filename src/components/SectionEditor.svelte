<script lang="ts">
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { db } from '../lib/db.svelte';
  import { t } from '../lib/i18n';
  import { droppable } from '../lib/dnd';
  import { settings } from '../lib/settings.svelte';
  import { createEditor, insertArtifact } from '../lib/editor.svelte';
  import { editorState, type InsertMode } from '../lib/editorState.svelte';
  import type { Heading } from '../lib/types';

  let { h, onEditor }: { h: Heading; onEditor?: (id: string, e: Editor) => void } = $props();
  let host: HTMLDivElement;
  let editor: Editor | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaved = '';

  function api() {
    return {
      headingId: h.id,
      insertArtifact: (id: string, mode: InsertMode, pos?: number) => editor && insertArtifact(editor, id, mode, pos),
      focus: () => editor?.commands.focus()
    };
  }

  onMount(() => {
    lastSaved = h.draft ?? '';
    editor = createEditor({
      element: host,
      content: h.draft,
      placeholder: t('Write this section…'),
      onChange: (json) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          lastSaved = json;
          db.update('headings', h.id, { draft: json });
        }, 250);
      },
      onFocus: () => (editorState.active = api())
    });
    onEditor?.(h.id, editor);
    return () => {
      if (timer) {
        clearTimeout(timer);
        if (editor) db.update('headings', h.id, { draft: JSON.stringify(editor.getJSON()) });
      }
      if (editorState.active?.headingId === h.id) editorState.active = null;
      editor?.destroy();
    };
  });

  // reflect external changes (sync from another device, undo) when not typing here
  $effect(() => {
    const d = h.draft ?? '';
    if (editor && d !== lastSaved && !editor.isFocused) {
      lastSaved = d;
      try {
        editor.commands.setContent(d ? JSON.parse(d) : '', { emitUpdate: false });
      } catch {
        /* ignore malformed */
      }
    }
  });
  $effect(() => {
    editor?.view.dom.setAttribute('spellcheck', String(settings.editorSpellcheck));
    editor?.view.dom.setAttribute('lang', settings.editorLang);
    editor?.view.dom.setAttribute('aria-label', t('Text for “{h}”', { h: h.title || t('Untitled') }));
  });
</script>

<div
  class="sed"
  bind:this={host}
  use:droppable={{
    accepts: (p) => p.type === 'artifact' || p.type === 'placement',
    onDrop: (p, info) => {
      if (!editor) return;
      const id = p.type === 'placement' ? db.get('placements', p.id)?.artifactId : p.id;
      if (!id) return;
      const pos = editor.view.posAtCoords({ left: info.x, top: info.y })?.pos;
      insertArtifact(editor, id, settings.insertMode, pos);
    }
  }}
></div>

<style>
  .sed {
    min-height: 2.2em;
  }
</style>
