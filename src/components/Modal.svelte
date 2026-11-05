<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  let {
    title,
    onclose,
    width = '560px',
    children,
    footer,
    header
  }: {
    title: string;
    onclose: () => void;
    width?: string;
    children: Snippet;
    footer?: Snippet;
    header?: Snippet;
  } = $props();

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={key} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} style="--w:{width}">
    <header>
      <h2>{title}</h2>
      {@render header?.()}
      <button class="icon-btn" onclick={onclose} aria-label="Close"><Icon name="x" /></button>
    </header>
    <div class="body scroll">
      {@render children()}
    </div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(10 12 16 / 0.4);
    backdrop-filter: blur(2px);
    animation: fade var(--dur) var(--ease);
  }
  .modal {
    width: min(var(--w), 100%);
    max-height: min(88vh, 900px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    animation: pop var(--dur) var(--ease);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 14px 10px 20px;
  }
  h2 {
    flex: 1;
    font-size: 1.05rem;
  }
  .body {
    padding: 4px 20px 20px;
    flex: 1;
    min-height: 0;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
  }
  @media (max-width: 600px) {
    .backdrop {
      padding: 0;
      place-items: end stretch;
    }
    .modal {
      width: 100%;
      max-height: 94vh;
      border-radius: 14px 14px 0 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.99);
    }
  }
</style>
