<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    items,
    icon = 'more',
    label = 'More',
    trigger
  }: {
    items: ({ label: string; icon?: string; run: () => void; danger?: boolean } | null)[];
    icon?: string;
    label?: string;
    trigger?: Snippet;
  } = $props();
  let open = $state(false);
  let btn: HTMLButtonElement;
  let pos = $state({ x: 0, y: 0, up: false });
  function toggle(e: MouseEvent) {
    e.stopPropagation();
    const r = btn.getBoundingClientRect();
    const up = r.bottom + 260 > innerHeight;
    pos = { x: Math.min(r.right, innerWidth - 8), y: up ? r.top : r.bottom, up };
    open = !open;
  }
</script>

<svelte:window onpointerdown={() => (open = false)} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<button bind:this={btn} class={trigger ? 'btn ghost sm' : 'icon-btn sm'} onclick={toggle} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}>
  {#if trigger}{@render trigger()}{:else}<Icon name={icon} size={16} />{/if}
</button>
{#if open}
  <div
    class="menu"
    role="menu"
    tabindex="-1"
    style="left:{pos.x}px; top:{pos.y}px; transform: translate(-100%, {pos.up ? 'calc(-100% - 4px)' : '4px'})"
    onpointerdown={(e) => e.stopPropagation()}
  >
    {#each items as it, i (i)}
      {#if it}
        <button role="menuitem" class:danger={it.danger} onclick={() => { open = false; it.run(); }}>
          {#if it.icon}<Icon name={it.icon} size={15} />{/if}{it.label}
        </button>
      {:else}
        <div class="sep"></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 200;
    min-width: 200px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    cursor: pointer;
    font-size: 0.875rem;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .menu button.danger {
    color: var(--danger);
  }
  .sep {
    height: 1px;
    margin: 4px 0;
    background: var(--border);
  }
</style>
