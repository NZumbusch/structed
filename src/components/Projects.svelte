<script lang="ts">
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { settings } from '../lib/settings.svelte';
  import { createProject, deleteProject, wordCount } from '../lib/ops';

  let { embedded = false }: { embedded?: boolean } = $props();
  let title = $state('');
  let template = $state('seminar');

  const projects = $derived(db.all('projects').sort((a, b) => b.updatedAt - a.updatedAt));
  const TPL = $derived([
    ['blank', t('Blank')],
    ['essay', t('Essay')],
    ['seminar', t('Seminar paper')],
    ['imrad', t('Journal article (IMRaD)')],
    ['thesis', t('Thesis')]
  ]);

  function create() {
    const p = createProject(title.trim() || t('Untitled project'), template, settings.language);
    title = '';
    open(p.id);
  }
  function open(id: string) {
    ui.projectId = id;
    ui.dialog = null;
    if (ui.stage === 'collect') ui.stage = 'outline';
  }
  function del(id: string, name: string) {
    if (!confirm(t('Delete project “{name}”? Sources and quotes in the library are kept.', { name }))) return;
    deleteProject(id);
    if (ui.projectId === id) ui.projectId = null;
    ui.toast(t('Project deleted'), { action: { label: t('Undo'), run: () => db.undo() } });
  }
  const words = (pid: string) => db.all('headings').filter((h) => h.projectId === pid).reduce((n, h) => n + wordCount(h.body), 0);
</script>

<div class="projects" class:embedded>
  <form class="new card" onsubmit={(e) => { e.preventDefault(); create(); }}>
    <h3>{t('New project')}</h3>
    <input class="input" bind:value={title} placeholder={t('Working title')} />
    <div class="tpls">
      {#each TPL as [k, label] (k)}
        <button type="button" class="chip tpl" class:on={template === k} onclick={() => (template = k)}>{label}</button>
      {/each}
    </div>
    <button class="btn primary" type="submit"><Icon name="plus" size={15} />{t('Create')}</button>
  </form>

  {#if projects.length}
    <div class="list">
      {#each projects as p (p.id)}
        <div class="pr card" class:on={ui.projectId === p.id}>
          <button class="open" onclick={() => open(p.id)}>
            <strong>{p.title || t('Untitled project')}</strong>
            <span class="tiny muted">{db.all('headings').filter((h) => h.projectId === p.id).length} {t('headings')} · {words(p.id).toLocaleString()} {t('words')} · {new Date(p.updatedAt).toLocaleDateString()}</span>
          </button>
          <button class="icon-btn" title={t('Delete')} onclick={() => del(p.id, p.title)}><Icon name="trash" size={16} /></button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .projects {
    display: grid;
    gap: 14px;
  }
  .new {
    display: grid;
    gap: 10px;
    padding: 14px;
  }
  .new h3 {
    font-size: 0.95rem;
  }
  .tpls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tpl {
    border: 1px solid transparent;
    cursor: pointer;
    height: 28px;
  }
  .tpl.on {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .new .btn {
    justify-self: start;
  }
  .list {
    display: grid;
    gap: 6px;
  }
  .pr {
    display: flex;
    align-items: center;
    padding: 4px 6px 4px 4px;
  }
  .pr.on {
    border-color: var(--accent);
  }
  .open {
    flex: 1;
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    border-radius: 8px;
  }
  .open:hover {
    background: var(--surface-2);
  }
</style>
