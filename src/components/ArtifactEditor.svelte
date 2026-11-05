<script lang="ts">
  import Modal from './Modal.svelte';
  import TagInput from './TagInput.svelte';
  import Icon from './Icon.svelte';
  import SourceSelect from './SourceSelect.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { cleanText } from '../lib/ocr';
  import { deleteArtifact, place } from '../lib/ops';
  import type { ArtifactKind } from '../lib/types';

  const req = ui.editArtifact!;
  const existing = req.id ? db.get('artifacts', req.id) : undefined;

  let kind: ArtifactKind = $state(existing?.kind ?? (req.kind as ArtifactKind) ?? 'quote');
  let sourceId: string | null = $state(existing?.sourceId ?? req.sourceId ?? null);
  let title = $state(existing?.title ?? '');
  let text = $state(existing?.text ?? '');
  let fullText = $state(existing?.fullText ?? '');
  let page = $state(existing?.page ?? '');
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
      comment,
      tags,
      color,
      imageId: imageId || undefined
    };
    if (existing) db.update('artifacts', existing.id, data);
    else {
      const a = db.create('artifacts', data);
      if (req.headingId && ui.projectId) place(ui.projectId, req.headingId, a.id);
    }
    if (again) {
      text = '';
      fullText = '';
      page = '';
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
      <label class="field page"><span>{t('Page')}</span><input class="input" bind:value={page} placeholder="12–14" /></label>
    </div>

    {#if kind === 'image'}
      <div class="img">
        {#if imgPreview}<img src={imgPreview} alt="" />{/if}
        <label class="btn sm">
          <Icon name="upload" size={14} />{imgPreview ? t('Replace image') : t('Choose image or paste')}
          <input type="file" accept="image/*" hidden onchange={(e) => e.currentTarget.files?.[0] && setImage(e.currentTarget.files[0])} />
        </label>
      </div>
    {/if}

    <label class="field">
      <span class="row">
        <span class="grow">{kind === 'quote' ? t('Quote (verbatim)') : kind === 'paraphrase' ? t('Paraphrase / summary') : kind === 'image' ? t('Caption') : t('Note (markdown)')}</span>
        <button class="btn ghost sm" onclick={(e) => { e.preventDefault(); text = cleanText(text); }} title={t('Fix PDF/OCR artifacts: hyphenation, line breaks, ligatures')}>
          <Icon name="sparkle" size={13} />{t('Clean up')}
        </button>
      </span>
      <textarea bind:this={textEl} class="textarea" rows="6" bind:value={text}></textarea>
    </label>

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
    width: 110px;
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
