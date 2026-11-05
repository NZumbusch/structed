<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { download, safeName } from '../lib/clipboard';
  import { artifactLabel, projectArtifacts, shortCite } from '../lib/ops';
  import { COVER_FIELDS, TEMPLATES, buildWordDocument, defaultCover } from '../lib/word/export';
  import type { Project } from '../lib/types';

  let { project, onclose }: { project: Project; onclose: () => void } = $props();
  const initial = (() => project)(); // dialog edits a copy; saved on close/export
  let cover = $state<Record<string, string>>({ ...defaultCover(initial), ...(initial.cover ?? {}) });
  let mottoId = $state(initial.mottoId ?? '');
  let busy = $state(false);
  let err = $state('');
  const LABELS: Record<string, string> = {
    workType: 'Type of work',
    module: 'Module / course',
    institution: 'Institution',
    supervisor: 'Supervisor',
    title: 'Title (line breaks allowed)',
    author: 'Author block',
    placeDate: 'Place and date'
  };
  const quotes = $derived(projectArtifacts(project.id).filter((a) => a.kind === 'quote'));

  function persist() {
    db.update('projects', project.id, { cover: { ...cover }, mottoId: mottoId || null });
    // remember personal fields for the next project
    const { title: _t, ...rest } = cover;
    settings.coverDefaults = rest;
  }
  async function go() {
    busy = true;
    err = '';
    persist();
    try {
      const blob = await buildWordDocument(db.get('projects', project.id)!);
      download(`${safeName(project.title)}.docx`, blob, blob.type);
      ui.toast(t('Word file created. In Word: allow updating fields, then Zotero → Refresh.'), { kind: 'ok' }, 8000);
    } catch (e) {
      err = String((e as Error).message ?? e);
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={t('Word export')} onclose={() => { persist(); onclose(); }} width="720px">
  <div class="we">
    <div class="opts">
      <label class="field"><span>{t('Template')}</span>
        <select class="select" bind:value={settings.exportTemplate}>
          {#each Object.entries(TEMPLATES) as [id, tp] (id)}<option value={id}>{tp.label}</option>{/each}
        </select>
      </label>
      <label class="row small"><input type="checkbox" bind:checked={settings.exportCover} />{t('Title page')}</label>
      <label class="row small"><input type="checkbox" bind:checked={settings.exportToc} />{t('Table of contents')}</label>
      <label class="row small"><input type="checkbox" bind:checked={settings.exportBibliography} />{t('Bibliography')}</label>
      <label class="row small"><input type="checkbox" bind:checked={settings.exportZotero} />{t('Live Zotero citations (refresh in Word)')}</label>
      <p class="tiny muted">{t('After opening the file in Word: confirm “update fields” (table of contents), then click Zotero → Refresh to link citations and the bibliography to your library.')}</p>
    </div>
    {#if settings.exportCover}
      <div class="cover">
        <h4>{t('Title page')}</h4>
        {#each COVER_FIELDS as k (k)}
          <label class="field"><span>{t(LABELS[k])}</span>
            {#if k === 'title' || k === 'author'}
              <textarea class="textarea" rows={k === 'author' ? 4 : 2} bind:value={cover[k]}></textarea>
            {:else}
              <input class="input" bind:value={cover[k]} />
            {/if}
          </label>
        {/each}
        <label class="field"><span>{t('Motto (optional quote on its own page)')}</span>
          <select class="select" bind:value={mottoId}>
            <option value="">{t('No motto')}</option>
            {#each quotes as a (a.id)}<option value={a.id}>{artifactLabel(a, 60)} — {shortCite(a)}</option>{/each}
          </select>
        </label>
        <p class="tiny muted">{t('Your name and address are stored only on your devices (and your own Drive when syncing).')}</p>
      </div>
    {/if}
  </div>
  {#if err}<p class="small err">{err}</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={() => { persist(); onclose(); }}>{t('Close')}</button>
    <button class="btn primary" disabled={busy} onclick={go}><Icon name="download" size={14} />{busy ? t('Creating…') : t('Create Word file')}</button>
  {/snippet}
</Modal>

<style>
  .we {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 18px;
  }
  .opts,
  .cover {
    display: grid;
    align-content: start;
    gap: 8px;
  }
  h4 {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .err {
    color: var(--danger);
  }
  @media (max-width: 700px) {
    .we {
      grid-template-columns: 1fr;
    }
  }
</style>
