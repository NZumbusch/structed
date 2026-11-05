<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { editorState } from '../lib/editorState.svelte';
  import { artifactLabel, projectArtifacts, shortCite } from '../lib/ops';

  const fn = editorState.footnote!;
  let before = $state(fn.before);
  let quoteId = $state<string>(fn.quoteId ?? '');
  let after = $state(fn.after);
  const options = $derived(
    (ui.projectId ? projectArtifacts(ui.projectId) : db.all('artifacts')).filter((a) => a.kind === 'quote' || a.kind === 'paraphrase')
  );
  function close() {
    editorState.footnote = null;
  }
  function save() {
    fn.save({ before: before.trim(), quoteId: quoteId || null, after: after.trim() });
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
</style>
