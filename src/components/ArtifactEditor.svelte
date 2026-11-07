<script lang="ts">
  import Modal from './Modal.svelte';
  import TagInput from './TagInput.svelte';
  import Icon from './Icon.svelte';
  import SourceSelect from './SourceSelect.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { cleanText } from '../lib/ocr';
  import { addToProject, deleteArtifact, place } from '../lib/ops';
  import { citeArtifact } from '../lib/cite';
  import { settings } from '../lib/settings.svelte';
  import { LOCATOR_LABELS, type ArtifactKind, type LocatorLabel } from '../lib/types';

  const req = ui.editArtifact!;
  const existing = req.id ? db.get('artifacts', req.id) : undefined;

  let kind: ArtifactKind = $state(existing?.kind ?? (req.kind as ArtifactKind) ?? 'quote');
  let sourceId: string | null = $state(existing?.sourceId ?? req.sourceId ?? null);
  let title = $state(existing?.title ?? '');
  let text = $state(existing?.text ?? '');
  let fullText = $state(existing?.fullText ?? '');
  let page = $state(existing?.page ?? '');
  let pageLabel = $state<LocatorLabel>(existing?.pageLabel ?? 'page');
  // secondary citation: the work quoted, as found in this source
  let origOpen = $state(!!existing?.original);
  let origId = $state<string | null>(existing?.original?.sourceId ?? null);
  let origPage = $state(existing?.original?.page ?? '');
  let origLabel = $state<LocatorLabel>(existing?.original?.pageLabel ?? 'page');
  const original = $derived(origOpen && origId && origId !== sourceId ? { sourceId: origId, page: origPage.trim(), pageLabel: origLabel === 'page' ? undefined : origLabel } : null);
  /** how it will be cited, with the current citation style */
  let preview = $state('');
  $effect(() => {
    const a = { id: '', kind, sourceId, text: '', tags: [], page: page.trim(), pageLabel: pageLabel === 'page' ? undefined : pageLabel, original, createdAt: 0, updatedAt: 0, device: '' };
    const o = { style: settings.citationStyle, locale: settings.citationLocale, words: settings.secondaryText };
    if (!sourceId) return void (preview = '');
    citeArtifact(a, o).then((c) => (preview = c)).catch(() => (preview = ''));
  });
  let comment = $state(existing?.comment ?? '');
  let tags = $state<string[]>([...(existing?.tags ?? [])]);
  let color = $state(existing?.color ?? '');
  let imageId = $state(existing?.imageId ?? '');
  let imgPreview = $state<string | null>(null);
  let showMore = $state(!!(existing?.fullText || existing?.title));
  let textEl: HTMLTextAreaElement;

  $effect(() => {
    if (!imageId) return;
    let u: string | null = null;
    db.getBlob(imageId).then((b) => b && (imgPreview = u = URL.createObjectURL(b)));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  });

  const KINDS: ArtifactKind[] = ['quote', 'paraphrase', 'note', 'image'];
  const LABEL_NAMES: Record<LocatorLabel, string> = {
    page: 'Page',
    column: 'Column',
    paragraph: 'Paragraph',
    section: 'Section',
    line: 'Line',
    chapter: 'Chapter',
    volume: 'Volume',
    folio: 'Folio',
    note: 'Note (n.)',
    number: 'Number',
    verse: 'Verse',
    'sub-verbo': 'Sub verbo (s.v.)',
    figure: 'Figure',
    table: 'Table'
  };

  function close() {
    ui.editArtifact = null;
  }

  function save(again = false) {
    if (!text.trim() && !imageId && !title.trim()) return close();
    const data = {
      kind,
      sourceId: kind === 'note' && !sourceId ? null : sourceId,
      title: title.trim(),
      text,
      fullText,
      page: page.trim(),
      pageLabel: pageLabel === 'page' ? undefined : pageLabel,
      original,
      comment,
      tags,
      color,
      imageId: imageId || undefined
    };
    if (existing) db.update('artifacts', existing.id, data);
    else {
      const a = db.create('artifacts', data);
      if (req.headingId && ui.projectId) place(ui.projectId, req.headingId, a.id);
      if (req.oncreated) {
        // made while writing: part of this project, then handed back (e.g. to insert it)
        if (ui.projectId) addToProject(ui.projectId, 'artifact', a.id);
        const cb = req.oncreated;
        queueMicrotask(() => cb(a.id));
      }
    }
    if (again) {
      text = '';
      fullText = '';
      page = '';
      origPage = '';
      comment = '';
      title = '';
      imageId = '';
      imgPreview = null;
      ui.toast(t('Saved'), { kind: 'ok' }, 1200);
      textEl?.focus();
    } else close();
  }

  async function setImage(file: Blob) {
    imageId = await db.putBlob(file);
    kind = 'image';
  }
  function paste(e: ClipboardEvent) {
    const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
    if (f) {
      e.preventDefault();
      setImage(f);
    }
  }
  function keys(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      save(e.shiftKey);
    }
  }
</script>

<Modal title={existing ? t('Edit item') : t('New item')} onclose={close} width="640px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="form" onkeydown={keys} onpaste={paste}>
    <div class="seg">
      {#each KINDS as k (k)}
        <button class:on={kind === k} onclick={() => (kind = k)}><Icon name={k} size={14} /> {t(k)}</button>
      {/each}
    </div>

    <div class="row two">
      <label class="field grow"><span>{t('Source')}</span><SourceSelect bind:value={sourceId} /></label>
      <div class="field page">
        <select class="select lsel" bind:value={pageLabel} aria-label={t('Kind of location')}>
          {#each LOCATOR_LABELS as l (l)}<option value={l}>{t(LABEL_NAMES[l])}</option>{/each}
        </select>
        <input class="input" bind:value={page} placeholder="12–14" aria-label={t(LABEL_NAMES[pageLabel])} />
      </div>
    </div>
    {#if sourceId && kind !== 'note' && kind !== 'image'}
      {#if origOpen}
        <div class="orig card">
          <div class="row">
            <span class="small grow"><b>{t('Secondary citation')}</b> – {t('the work quoted in this source:')}</span>
            <button class="icon-btn sm" title={t('Not a secondary citation')} aria-label={t('Not a secondary citation')} onclick={() => ((origOpen = false), (origId = null))}><Icon name="x" size={14} /></button>
          </div>
          <div class="row two">
            <label class="field grow"><span>{t('Original source')}</span><SourceSelect bind:value={origId} /></label>
            <div class="field page">
              <select class="select lsel" bind:value={origLabel} aria-label={t('Kind of location in the original')}>
                {#each LOCATOR_LABELS as l (l)}<option value={l}>{t(LABEL_NAMES[l])}</option>{/each}
              </select>
              <input class="input" bind:value={origPage} placeholder="1121" aria-label={t('Location in the original')} />
            </div>
          </div>
          {#if origId === sourceId}<p class="tiny err">{t('The original has to be another source.')}</p>{/if}
        </div>
      {:else}
        <button class="btn ghost sm more" onclick={() => (origOpen = true)}><Icon name="quote" size={13} />{t('Secondary citation (quoted from another work)…')}</button>
      {/if}
      {#if preview}<p class="tiny muted cprev" aria-label={t('Citation')}>{preview}</p>{/if}
    {/if}

    {#if kind === 'image'}
      <div class="img">
        {#if imgPreview}<img src={imgPreview} alt="" />{/if}
        <label class="btn sm">
          <Icon name="upload" size={14} />{imgPreview ? t('Replace image') : t('Choose image or paste')}
          <input type="file" accept="image/*" hidden onchange={(e) => e.currentTarget.files?.[0] && setImage(e.currentTarget.files[0])} />
        </label>
      </div>
    {/if}

    <div class="field">
      <div class="row">
        <label class="grow lbl" for="art-text">{kind === 'quote' ? t('Quote (verbatim)') : kind === 'paraphrase' ? t('Paraphrase / summary') : kind === 'image' ? t('Caption') : t('Note (markdown)')}</label>
        <button class="btn ghost sm" onclick={() => (text = cleanText(text))} title={t('Fix PDF/OCR artifacts: hyphenation, line breaks, ligatures')}>
          <Icon name="sparkle" size={13} />{t('Clean up')}
        </button>
      </div>
      <textarea id="art-text" bind:this={textEl} class="textarea" rows="6" bind:value={text}></textarea>
    </div>

    <label class="field"><span>{t('Comment')}</span><textarea class="textarea" rows="2" bind:value={comment} placeholder={t('Your thoughts on it…')}></textarea></label>
    <label class="field"><span>{t('Tags / topics')}</span><TagInput bind:tags /></label>

    <button class="btn ghost sm more" onclick={() => (showMore = !showMore)}>
      <Icon name={showMore ? 'chevron-down' : 'chevron-right'} size={14} />{t('More fields')}
    </button>
    {#if showMore}
      <label class="field"><span>{t('Short title (shown when collapsed)')}</span><input class="input" bind:value={title} /></label>
      <label class="field"><span>{t('Context / full text')}</span><textarea class="textarea" rows="4" bind:value={fullText}></textarea></label>
      <div class="field">
        <span>{t('Color')}</span>
        <div class="row">
          {#each ['', '#3b6fd8', '#2f9e75', '#c0582f', '#8a55c9', '#c94a73', '#b08a1e'] as c (c)}
            <button class="sw" class:on={color === c} style:background={c || 'var(--surface-2)'} onclick={() => (color = c)} aria-label={c || 'none'}></button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    {#if existing}
      <button class="btn danger" onclick={() => { deleteArtifact(existing); close(); }}><Icon name="trash" size={14} />{t('Delete')}</button>
    {/if}
    <span class="grow"></span>
    {#if !existing}<button class="btn" onclick={() => save(true)} title="Ctrl+Shift+Enter">{t('Save & add another')}</button>{/if}
    <button class="btn primary" onclick={() => save()} title="Ctrl+Enter">{t('Save')}</button>
  {/snippet}
</Modal>

<style>
  .form {
    display: grid;
    gap: 12px;
  }
  .two {
    align-items: end;
  }
  .page {
    width: 220px;
    display: flex;
    gap: 4px;
  }
  .page .lsel {
    width: 110px;
    flex: none;
  }
  .page .input {
    min-width: 0;
    flex: 1;
  }
  .orig {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
  }
  .cprev {
    margin: -4px 0 0;
  }
  .err {
    margin: 0;
    color: var(--danger);
  }
  @media (max-width: 520px) {
    .two {
      flex-wrap: wrap;
    }
    .page {
      width: 100%;
    }
  }
  .lbl {
    font-size: 0.8125rem;
    color: var(--muted);
    font-weight: 500;
  }
  .more {
    justify-self: start;
  }
  .img img {
    max-width: 100%;
    max-height: 260px;
    border-radius: 8px;
    display: block;
    margin-bottom: 6px;
  }
  .sw {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .sw.on {
    border-color: var(--text);
  }
</style>
