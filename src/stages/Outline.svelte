<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import HeadingRow from '../components/HeadingRow.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { droppable } from '../lib/dnd';
  import { addHeading, children, flatten, moveHeading, wordCount } from '../lib/ops';
  import type { Project } from '../lib/types';

  let { project, mode }: { project: Project; mode: 'outline' | 'arrange' } = $props();

  const flat = $derived(flatten(project.id, ui.collapsed));
  const all = $derived(db.all('headings').filter((h) => h.projectId === project.id));
  const words = $derived(all.reduce((n, h) => n + wordCount(h.body), 0));
  const placed = $derived(new Set(db.all('placements').filter((p) => p.projectId === project.id && db.get('headings', p.headingId)).map((p) => p.artifactId)).size);
  const done = $derived(all.filter((h) => h.status === 'done').length);

  function addTop() {
    const roots = children(project.id, null);
    ui.focusHeading = addHeading(project.id, null, roots[roots.length - 1]?.id).id;
  }
  function expandAll() {
    ui.collapsed.clear();
  }
  function collapseAll() {
    for (const f of flatten(project.id)) if (f.hasChildren) ui.collapsed.add(f.h.id);
  }
  function toggleBodies() {
    const anyOpen = all.some((h) => ui.openBodies.has(h.id));
    for (const h of all) anyOpen ? ui.openBodies.delete(h.id) : ui.openBodies.add(h.id);
  }
</script>

<div class="wrap scroll">
  <div class="page">
    <header class="ph">
      <input
        class="ptitle"
        value={project.title}
        placeholder={t('Project title')}
        oninput={(e) => db.update('projects', project.id, { title: e.currentTarget.value })}
      />
      <input
        class="psub"
        value={project.subtitle ?? ''}
        placeholder={t('Subtitle, research question or thesis statement…')}
        oninput={(e) => db.update('projects', project.id, { subtitle: e.currentTarget.value })}
      />
      <div class="stats row small muted">
        <span>{all.length} {t('headings')}</span>·
        <span>{words.toLocaleString()} {t('words')}{project.targetWords ? ` / ${project.targetWords.toLocaleString()}` : ''}</span>·
        <span>{placed} {t('items placed')}</span>·
        <span>{done}/{all.length} {t('done')}</span>
        <span class="grow"></span>
        <button class="btn ghost sm" onclick={expandAll} title={t('Expand all')}><Icon name="chevron-down" size={14} /></button>
        <button class="btn ghost sm" onclick={collapseAll} title={t('Collapse all')}><Icon name="chevron-right" size={14} /></button>
        {#if mode === 'outline'}
          <button class="btn ghost sm" onclick={toggleBodies}><Icon name="note" size={14} />{t('Notes')}</button>
        {/if}
      </div>
      {#if mode === 'arrange'}
        <p class="hint small muted">{t('Drag quotes, paraphrases and notes from the library onto headings. One item can be placed under several headings.')}</p>
      {/if}
    </header>

    <div class="tree">
      {#each flat as f (f.h.id)}
        <HeadingRow {f} {mode} />
      {/each}
    </div>

    <button
      class="btn ghost add"
      onclick={addTop}
      use:droppable={{
        accepts: (p) => p.type === 'heading',
        onDrop: (p) => {
          const roots = children(project.id, null);
          const last = roots[roots.length - 1];
          if (last && last.id !== p.id) moveHeading(p.id, last.id, 'after');
        }
      }}
    >
      <Icon name="plus" size={16} />{t('Add heading')}
    </button>

    {#if mode === 'outline'}
      <div class="keys tiny muted">
        <span><span class="kbd">Enter</span> {t('new heading')}</span>
        <span><span class="kbd">Tab</span>/<span class="kbd">⇧Tab</span> {t('indent / outdent')}</span>
        <span><span class="kbd">Alt ↑↓</span> {t('move')}</span>
        <span><span class="kbd">⇧Enter</span> {t('notes')}</span>
        <span><span class="kbd">Ctrl .</span> {t('collapse')}</span>
        <span><span class="kbd">Ctrl K</span> {t('search')}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .wrap {
    height: 100%;
  }
  .page {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 28px 24px 120px;
  }
  .ph {
    margin-bottom: 18px;
  }
  .ptitle,
  .psub {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    padding: 0;
  }
  .ptitle {
    font-size: 1.9em;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .psub {
    margin-top: 2px;
    color: var(--muted);
    font-size: 1.02em;
  }
  .stats {
    margin-top: 12px;
    gap: 6px;
    flex-wrap: wrap;
  }
  .hint {
    margin: 10px 0 0;
  }
  .tree {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1px;
  }
  .add {
    margin-top: 8px;
    color: var(--muted);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    margin-top: 36px;
  }
  @media (max-width: 600px) {
    .page {
      padding: 18px 12px 120px;
    }
    .keys {
      display: none;
    }
  }
</style>
