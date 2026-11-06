<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    items,
    icon = 'more',
    label = 'More',
    trigger,
    open = $bindable(false)
  }: {
    items: ({ label: string; icon?: string; run: () => void; danger?: boolean } | null)[];
    icon?: string;
    label?: string;
    trigger?: Snippet;
    /** bind to open the menu from outside (e.g. a keyboard shortcut) */
    open?: boolean;
  } = $props();
  let btn: HTMLButtonElement;
  let menuEl = $state<HTMLDivElement>();
  let pos = $state<{ x: number; y: number } | null>(null);
  const M = 8; // keep this far from the screen edges

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    pos = null;
    open = !open;
  }

  /** Place the opened menu next to its button, fully inside the viewport. */
  function place() {
    if (!menuEl) return;
    const r = btn.getBoundingClientRect();
    const w = menuEl.offsetWidth;
    const h = menuEl.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    // buttons on the left half open to the right, others open to the left
    let x = r.left + r.width / 2 < vw / 2 ? r.left : r.right - w;
    x = Math.max(M, Math.min(x, vw - w - M));
    let y = r.bottom + 4;
    if (y + h > vh - M) y = r.top - 4 - h >= M ? r.top - 4 - h : Math.max(M, vh - h - M);
    pos = { x, y };
  }
  $effect(() => {
    if (open && menuEl) place();
  });
  /** arrow keys move between the items, Enter runs one */
  function nav(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuEl?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
</script>

<svelte:window onpointerdown={() => (open = false)} onkeydown={(e) => e.key === 'Escape' && (open = false)} onresize={() => open && place()} />

<button bind:this={btn} class={trigger ? 'btn ghost sm' : 'icon-btn sm'} onclick={toggle} aria-label={trigger ? undefined : label} title={label} aria-haspopup="menu" aria-expanded={open}>
  {#if trigger}{@render trigger()}{:else}<Icon name={icon} size={16} />{/if}
</button>
{#if open}
  <div
    bind:this={menuEl}
    class="menu"
    role="menu"
    tabindex="-1"
    style="left:{pos?.x ?? 0}px; top:{pos?.y ?? 0}px; visibility:{pos ? 'visible' : 'hidden'}; max-height:calc(100vh - {2 * M}px)"
    onpointerdown={(e) => e.stopPropagation()}
    onkeydown={nav}
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
    max-width: calc(100vw - 16px);
    overflow-y: auto;
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
