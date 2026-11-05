<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { artifactLabel, flatten, place } from '../lib/ops';

  const a = db.get('artifacts', ui.placeTarget!);
  const pid = ui.projectId!;
  const flat = $derived(flatten(pid));
  const placedIn = $derived(new Map(db.all('placements').filter((p) => p.artifactId === a?.id && p.projectId === pid).map((p) => [p.headingId, p.id])));

  function toggle(hid: string) {
    if (!a) return;
    const pl = placedIn.get(hid);
    if (pl) db.remove('placements', pl);
    else place(pid, hid, a.id);
  }
</script>

<Modal title={t('Place under heading…')} onclose={() => (ui.placeTarget = null)} width="520px">
  {#if a}<p class="small muted">{artifactLabel(a, 140)}</p>{/if}
  <div class="list">
    {#each flat as f (f.h.id)}
      <button class="it" class:on={placedIn.has(f.h.id)} style="--d:{f.depth}" onclick={() => toggle(f.h.id)}>
        <span class="ck">{#if placedIn.has(f.h.id)}<Icon name="check" size={14} />{/if}</span>
        <span class="n">{f.num}</span>
        <span class="ellipsis">{f.h.title || t('Untitled')}</span>
      </button>
    {/each}
  </div>
  {#snippet footer()}<button class="btn primary" onclick={() => (ui.placeTarget = null)}>{t('Done')}</button>{/snippet}
</Modal>

<style>
  .list {
    display: grid;
    gap: 2px;
  }
  .it {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px 7px calc(8px + var(--d) * 16px);
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .it:hover {
    background: var(--surface-2);
  }
  .it.on {
    background: var(--accent-soft);
  }
  .ck {
    width: 16px;
    color: var(--accent-text);
  }
  .n {
    color: var(--faint);
    font-size: 0.8rem;
    min-width: 2em;
  }
</style>
