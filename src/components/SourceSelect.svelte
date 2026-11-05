<script lang="ts">
  import { db } from '../lib/db.svelte';
  import { t } from '../lib/i18n';
  import { sourceLabel } from '../lib/ops';

  let { value = $bindable(null) }: { value: string | null } = $props();
  let q = $state('');
  let open = $state(false);
  let hi = $state(0);

  const current = $derived(db.get('sources', value));
  const list = $derived.by(() => {
    const qq = q.trim().toLowerCase();
    const all = db
      .all('sources')
      .map((s) => ({ s, label: sourceLabel(s), title: s.csl.title ?? '' }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return (qq ? all.filter((x) => (x.label + ' ' + x.title).toLowerCase().includes(qq)) : all).slice(0, 50);
  });

  function pick(id: string | null) {
    value = id;
    q = '';
    open = false;
  }
  function createNew() {
    const title = q.trim();
    const s = db.create('sources', { csl: { id: '', type: 'book', title, author: [] }, tags: [] });
    pick(s.id);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      hi = Math.min(hi + 1, list.length);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      hi = Math.max(hi - 1, 0);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hi < list.length) pick(list[hi].s.id);
      else if (q.trim()) createNew();
    }
  }
</script>

<div class="ss">
  <input
    class="input"
    value={open ? q : current ? `${sourceLabel(current)} — ${current.csl.title ?? ''}` : ''}
    placeholder={t('No source (search…)')}
    onfocus={() => {
      open = true;
      hi = 0;
    }}
    onblur={() => setTimeout(() => (open = false), 150)}
    oninput={(e) => {
      q = e.currentTarget.value;
      hi = 0;
    }}
    onkeydown={key}
  />
  {#if open}
    <div class="dd scroll">
      <button class="opt muted" onpointerdown={(e) => { e.preventDefault(); pick(null); }}>{t('No source')}</button>
      {#each list as x, i (x.s.id)}
        <button class="opt" class:hi={i === hi} onpointerdown={(e) => { e.preventDefault(); pick(x.s.id); }}>
          <strong>{x.label}</strong> <span class="muted">{x.title}</span>
        </button>
      {/each}
      {#if q.trim()}
        <button class="opt new" class:hi={hi === list.length} onpointerdown={(e) => { e.preventDefault(); createNew(); }}>
          + {t('New source')} “{q.trim()}”
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ss {
    position: relative;
  }
  .dd {
    position: absolute;
    z-index: 10;
    left: 0;
    right: 0;
    top: 100%;
    margin-top: 4px;
    max-height: 260px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .opt {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: none;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .opt:hover,
  .opt.hi {
    background: var(--surface-2);
  }
  .new {
    color: var(--accent-text);
  }
</style>
