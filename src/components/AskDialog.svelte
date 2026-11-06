<script lang="ts">
  import Modal from './Modal.svelte';
  import { ui } from '../lib/ui.svelte';

  const q = ui.question!;
  let okBtn = $state<HTMLButtonElement>();
  $effect(() => okBtn?.focus());
</script>

<Modal title={q.title} onclose={() => q.answer(false)} width="480px">
  <div class="ask">
    {#each q.text.split('\n\n') as p, i (i)}<p>{p}</p>{/each}
  </div>
  {#snippet footer()}
    <span class="grow"></span>
    <button class="btn" onclick={() => q.answer(false)}>{q.cancel}</button>
    <button class="btn {q.danger ? 'danger' : 'primary'}" bind:this={okBtn} onclick={() => q.answer(true)}>{q.ok}</button>
  {/snippet}
</Modal>

<style>
  .ask p {
    margin: 0 0 10px;
    line-height: 1.55;
  }
</style>
