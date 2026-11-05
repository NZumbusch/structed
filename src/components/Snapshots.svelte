<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { restoreSnapshot, takeSnapshot } from '../lib/backup';

  const pid = ui.projectId!;
  let name = $state('');
  const list = $derived(db.all('snapshots').filter((s) => s.projectId === pid).sort((a, b) => b.createdAt - a.createdAt));

  function take() {
    takeSnapshot(pid, name.trim() || new Date().toLocaleString());
    name = '';
    ui.toast(t('Snapshot saved'), { kind: 'ok' });
  }
  function restore(id: string, n: string) {
    if (!confirm(t('Restore “{name}”? The current state is saved as a snapshot first.', { name: n }))) return;
    restoreSnapshot(id);
    ui.toast(t('Snapshot restored'), { action: { label: t('Undo'), run: () => db.undo() } });
  }
  const stats = (data: string) => {
    try {
      const d = JSON.parse(data);
      return `${d.headings?.length ?? 0} ${t('headings')} · ${d.placements?.length ?? 0} ${t('items placed')}`;
    } catch {
      return '';
    }
  };
</script>

<Modal title={t('Snapshots')} onclose={() => (ui.dialog = null)} width="560px">
  <p class="small muted">{t('Snapshots save the outline, texts, placements and comments of this project – e.g. before a big restructure. They sync like everything else.')}</p>
  <form class="row" onsubmit={(e) => { e.preventDefault(); take(); }}>
    <input class="input grow" bind:value={name} placeholder={t('Name (optional), e.g. “before restructuring”')} />
    <button class="btn primary" type="submit"><Icon name="history" size={15} />{t('Save snapshot')}</button>
  </form>
  <div class="list">
    {#each list as s (s.id)}
      <div class="sn card">
        <div class="grow">
          <strong class="small">{s.name}</strong>
          <div class="tiny muted">{new Date(s.createdAt).toLocaleString()} · {stats(s.data)}</div>
        </div>
        <button class="btn sm" onclick={() => restore(s.id, s.name)}>{t('Restore')}</button>
        <button class="icon-btn sm" title={t('Delete')} onclick={() => db.remove('snapshots', s.id)}><Icon name="trash" size={14} /></button>
      </div>
    {:else}
      <div class="empty small">{t('No snapshots yet.')}</div>
    {/each}
  </div>
</Modal>

<style>
  .list {
    display: grid;
    gap: 6px;
    margin-top: 14px;
  }
  .sn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
  }
</style>
