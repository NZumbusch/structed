<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { editorState } from '../lib/editorState.svelte';
  import { artifactLabel, projectArtifacts, shortCite } from '../lib/ops';
  import { oneLine } from '../lib/citecache.svelte';

  const fn = editorState.footnote!;
  let before = $state(fn.before);
  let quoteId = $state<string>(fn.quoteId ?? '');
  let after = $state(fn.after);
  /** the quote's wording in this footnote; equal to the library text = not edited */
  const libText = (id: string) => oneLine(db.get('artifacts', id)?.text ?? '');
  let quoteText = $state(fn.quoteText ?? (fn.quoteId ? libText(fn.quoteId) : ''));
  let quoteEl = $state<HTMLTextAreaElement>();
  const edited = $derived(!!quoteId && quoteText.trim() !== libText(quoteId));
  // another quote picked: start from its library text
  let lastId = fn.quoteId ?? '';
  $effect(() => {
    if (quoteId !== lastId) {
      lastId = quoteId;
      quoteText = quoteId ? libText(quoteId) : '';
    }
  });
  /** put an omission mark at the cursor (replacing a selected passage) */
  function omit() {
    const el = quoteEl;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    quoteText = quoteText.slice(0, a) + '[…]' + quoteText.slice(b);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + 3, a + 3);
    });
  }
  const options = $derived(
    (ui.projectId ? projectArtifacts(ui.projectId) : db.all('artifacts')).filter((a) => a.kind === 'quote' || a.kind === 'paraphrase')
  );
  function close() {
    editorState.footnote = null;
  }
  function save() {
    fn.save({ before: before.trim(), quoteId: quoteId || null, quoteText: edited && quoteText.trim() ? quoteText.trim() : null, after: after.trim() });
    close();
  }
  function remove() {
    fn.remove();
    close();
  }
</script>

<Modal title={t('Footnote')} onclose={close} width="560px">
  <div class="fd">
    <label class="field"><span>{t('Text before the quote')}</span><textarea class="textarea" rows="2" bind:value={before}></textarea></label>
    <label class="field"><span>{t('Quote (optional, stays linked)')}</span>
      <select class="select" bind:value={quoteId}>
        <option value="">{t('No quote')}</option>
        {#each options as a (a.id)}<option value={a.id}>{artifactLabel(a, 70)} — {shortCite(a)}</option>{/each}
      </select>
    </label>
    {#if quoteId}
      <div class="field">
        <label for="fn-qt">{t('Wording of the quote (shorten with […], adapt with [ ])')}</label>
        <textarea id="fn-qt" class="textarea" rows="4" bind:this={quoteEl} bind:value={quoteText}></textarea>
        <div class="row qtools small">
          <button class="btn sm" type="button" onclick={omit} title={t('Replaces the selected passage with […]')}>[…] {t('Omission')}</button>
          {#if edited}
            <span class="muted tiny">{t('Edited – the citation stays linked')}</span>
            <span class="grow"></span>
            <button class="btn ghost sm" type="button" onclick={() => (quoteText = libText(quoteId))}><Icon name="undo" size={13} />{t('Back to the library text')}</button>
          {/if}
        </div>
      </div>
    {/if}
    <label class="field"><span>{t('Text after the quote')}</span><textarea class="textarea" rows="2" bind:value={after}></textarea></label>
  </div>
  {#snippet footer()}
    <button class="btn danger" onclick={remove}><Icon name="trash" size={14} />{t('Delete footnote')}</button>
    <span class="grow"></span>
    <button class="btn" onclick={close}>{t('Cancel')}</button>
    <button class="btn primary" onclick={save}>{t('Save')}</button>
  {/snippet}
</Modal>

<style>
  .fd {
    display: grid;
    gap: 12px;
  }
  .fd .field > label {
    font-size: 0.8125rem;
    color: var(--muted);
    font-weight: 500;
  }
  .qtools {
    gap: 8px;
    margin-top: 6px;
  }
</style>
