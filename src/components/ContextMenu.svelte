<script lang="ts">
  // Global right-click menu (one at a time), positioned inside the viewport.
  import Icon from './Icon.svelte';
  import { ui } from '../lib/ui.svelte';

  let el = $state<HTMLDivElement>();
  let pos = $state<{ x: number; y: number } | null>(null);
  const M = 8;

  $effect(() => {
    const cm = ui.contextMenu;
    pos = null;
    if (!cm || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    pos = {
      x: Math.max(M, Math.min(cm.x, vw - w - M)),
      y: cm.y + h > vh - M ? Math.max(M, cm.y - h) : cm.y
    };
    el.querySelector<HTMLButtonElement>('button')?.focus();
  });
  const close = () => (ui.contextMenu = null);
  function key(e: KeyboardEvent) {
    if (!ui.contextMenu) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const b = [...(el?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const i = b.indexOf(document.activeElement as HTMLButtonElement);
      b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length]?.focus();
    }
  }
</script>

<svelte:window onpointerdown={(e) => ui.contextMenu && !el?.contains(e.target as Node) && close()} onkeydowncapture={key} onscrollcapture={close} onresize={close} onblur={close} />

{#if ui.contextMenu}
  <div
    bind:this={el}
    class="cmenu"
    role="menu"
    tabindex="-1"
    aria-label={ui.contextMenu.title ?? 'Menu'}
    style="left:{pos?.x ?? 0}px; top:{pos?.y ?? 0}px; visibility:{pos ? 'visible' : 'hidden'}"
  >
    {#if ui.contextMenu.title}<div class="ttl tiny muted ellipsis">{ui.contextMenu.title}</div>{/if}
    {#each ui.contextMenu.items as it, i (i)}
      {#if it}
        <button role="menuitem" class:danger={it.danger} onclick={() => { close(); it.run(); }}>
          {#if it.icon}<Icon name={it.icon} size={15} />{/if}<span class="ellipsis">{it.label}</span>
        </button>
      {:else}
        <div class="sep"></div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .cmenu {
    position: fixed;
    z-index: 250;
    min-width: 210px;
    max-width: min(320px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  .ttl {
    padding: 4px 10px 6px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }
  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text);
  }
  button:hover,
  button:focus-visible {
    background: var(--surface-2);
    outline: none;
  }
  .danger {
    color: var(--danger);
  }
  .sep {
    height: 1px;
    margin: 4px 0;
    background: var(--border);
  }
</style>
