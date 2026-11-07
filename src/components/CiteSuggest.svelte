<script lang="ts">
  // Suggestions for "@…" typed in a text: quotes of the project first (recently used on
  // top), then the rest of the library. Enter/Tab inserts the citation (Name, year, page).
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { editorState } from '../lib/editorState.svelte';
  import { authorsFull, projectArtifacts, sourceLabel, visibleTags } from '../lib/ops';
  import { citeText } from '../lib/citecache.svelte';
  import type { Artifact } from '../lib/types';

  const m = $derived(editorState.mention);
  let active = $state(0);
  const MAX = 8;

  const results = $derived.by(() => {
    if (!m) return [] as { a: Artifact; inProject: boolean }[];
    const words = m.query.toLowerCase().split(/\s+/).filter(Boolean);
    const recent = settings.recentQuotes ?? [];
    const inProject = new Set(ui.projectId ? projectArtifacts(ui.projectId).map((a) => a.id) : []);
    const hits = db
      .all('artifacts')
      .filter((a) => a.sourceId && a.kind !== 'image' && a.kind !== 'note')
      .filter((a) => {
        if (!words.length) return inProject.has(a.id) || recent.includes(a.id);
        const s = db.get('sources', a.sourceId);
        const hay = [a.text, a.page, a.title, visibleTags(a.tags).join(' '), s ? `${sourceLabel(s)} ${s.csl.title ?? ''} ${authorsFull(s.csl)}` : ''].join(' ').toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    const rank = (a: Artifact) => {
      const r = recent.indexOf(a.id);
      return (inProject.has(a.id) ? 0 : 1000) + (r < 0 ? 500 : r);
    };
    return hits
      .sort((a, b) => rank(a) - rank(b) || sourceLabel(db.get('sources', a.sourceId)).localeCompare(sourceLabel(db.get('sources', b.sourceId))))
      .slice(0, MAX)
      .map((a) => ({ a, inProject: inProject.has(a.id) }));
  });
  $effect(() => {
    void m?.query;
    active = 0;
  });

  function insert(a: Artifact) {
    const cur = editorState.mention;
    if (!cur) return;
    settings.recentQuotes = [a.id, ...(settings.recentQuotes ?? []).filter((x) => x !== a.id)].slice(0, 60);
    editorState.mention = null;
    cur.editor.chain().focus().insertContentAt({ from: cur.from, to: cur.to }, { type: 'quoteRef', attrs: { id: a.id, mode: 'cite' } }).run();
  }
  // the editor hands us its keys while the list is open
  $effect(() => {
    editorState.mentionKey = (key) => {
      if (!results.length) return false;
      if (key === 'ArrowDown') active = (active + 1) % results.length;
      else if (key === 'ArrowUp') active = (active - 1 + results.length) % results.length;
      else insert(results[active].a);
      return true;
    };
    return () => (editorState.mentionKey = null);
  });

  // below the "@", or above it when there is no room
  const pos = $derived.by(() => {
    if (!m) return '';
    const w = Math.min(420, innerWidth - 16);
    const left = Math.max(8, Math.min(m.left, innerWidth - w - 8));
    const below = innerHeight - m.bottom > 300;
    return `left:${left}px; width:${w}px; ${below ? `top:${m.bottom + 6}px` : `bottom:${innerHeight - m.top + 6}px`}`;
  });
</script>

{#if m}
  <div class="cite-suggest" style={pos} role="listbox" aria-label={t('Citations')}>
    <div class="head tiny muted">
      <Icon name="book" size={12} />
      {m.query ? t('Citation for “{q}”', { q: m.query }) : t('Type to search: author, words of the quote, page…')}
    </div>
    {#each results as r, i (r.a.id)}
      <button
        role="option"
        aria-selected={i === active}
        class="row"
        class:on={i === active}
        onmousedown={(e) => e.preventDefault()}
        onmouseenter={() => (active = i)}
        onclick={() => insert(r.a)}
      >
        <span class="cite">{citeText(r.a)}{#if !r.inProject}<span class="lib tiny"> · {t('library')}</span>{/if}</span>
        <span class="txt tiny muted">{r.a.text}</span>
      </button>
    {:else}
      <div class="none small muted">{m.query ? t('No citation found') : t('No quotes in this project yet')}</div>
    {/each}
    <div class="foot tiny muted">↑↓ · Enter {t('inserts the citation')} · Esc</div>
  </div>
{/if}

<style>
  .cite-suggest {
    position: fixed;
    z-index: 350;
    display: grid;
    gap: 1px;
    max-height: 340px;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .head,
  .foot {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
  }
  .row {
    display: grid;
    gap: 1px;
    padding: 5px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .row.on {
    background: var(--accent-soft);
  }
  .cite {
    font-size: 0.85rem;
    font-weight: 500;
  }
  .lib {
    color: var(--muted);
    font-weight: 400;
  }
  .txt {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .none {
    padding: 6px 8px;
  }
</style>
