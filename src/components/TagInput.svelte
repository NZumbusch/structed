<script lang="ts">
  import { allTagNames, tagColor, visibleTags } from '../lib/ops';
  import { t } from '../lib/i18n';
  let { tags = $bindable([]) }: { tags: string[] } = $props();
  let text = $state('');
  let focused = $state(false);
  const all = $derived(allTagNames());
  // hidden bookkeeping tags stay on the item but are not shown or removable here
  const shown = $derived(visibleTags(tags));
  const suggestions = $derived(
    text.trim() ? all.filter((x) => x.toLowerCase().includes(text.trim().toLowerCase()) && !tags.includes(x)).slice(0, 6) : []
  );
  function add(name: string) {
    const n = name.trim().replace(/^#/, '');
    if (n && !tags.includes(n)) tags = [...tags, n];
    text = '';
  }
  function key(e: KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ',') && text.trim()) {
      e.preventDefault();
      add(suggestions[0] && e.key === 'Enter' && suggestions[0].toLowerCase().startsWith(text.toLowerCase()) ? suggestions[0] : text);
    } else if (e.key === 'Backspace' && !text && shown.length) tags = tags.filter((x) => x !== shown[shown.length - 1]);
  }
</script>

<div class="tagin input" class:focused>
  {#each shown as tg (tg)}
    <span class="chip" style:background={tagColor(tg) ? `color-mix(in srgb, ${tagColor(tg)} 22%, transparent)` : undefined}>
      #{tg}<button onclick={() => (tags = tags.filter((x) => x !== tg))} aria-label="remove">×</button>
    </span>
  {/each}
  <input
    bind:value={text}
    onkeydown={key}
    onfocus={() => (focused = true)}
    onblur={() => {
      focused = false;
      if (text.trim()) add(text);
    }}
    placeholder={shown.length ? '' : t('Add tags…')}
  />
  {#if focused && suggestions.length}
    <div class="sugg">
      {#each suggestions as s (s)}
        <button onpointerdown={(e) => { e.preventDefault(); add(s); }}>#{s}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tagin {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    padding: 4px 6px;
  }
  .tagin.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  input {
    flex: 1;
    min-width: 80px;
    border: 0;
    outline: 0;
    background: transparent;
    height: 26px;
  }
  .chip {
    min-width: 0;
  }
  .chip button {
    border: 0;
    background: none;
    cursor: pointer;
    color: inherit;
    padding: 0 0 0 2px;
  }
  .sugg {
    position: absolute;
    left: 0;
    top: 100%;
    margin-top: 4px;
    z-index: 5;
    min-width: 180px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .sugg button {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: none;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .sugg button:hover {
    background: var(--surface-2);
  }
</style>
