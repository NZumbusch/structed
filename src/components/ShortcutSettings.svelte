<script lang="ts">
  import Icon from './Icon.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import {
    SHORTCUTS,
    actionFor,
    assign,
    comboFor,
    displayCombo,
    eventCombo,
    resetAllShortcuts,
    resetShortcut,
    type ShortcutDef
  } from '../lib/shortcuts';

  let recording = $state<string | null>(null);
  let pending = $state<{ id: string; combo: string; conflict: ShortcutDef } | null>(null);
  let filter = $state('');

  const groups = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const m = new Map<string, ShortcutDef[]>();
    for (const s of SHORTCUTS) {
      if (q && !`${t(s.label)} ${s.label} ${displayCombo(comboFor(s.id))}`.toLowerCase().includes(q)) continue;
      (m.get(s.group) ?? m.set(s.group, []).get(s.group)!).push(s);
    }
    return [...m.entries()];
  });

  function start(id: string) {
    recording = id;
    pending = null;
    ui.recordingShortcut = true;
  }
  function stop() {
    recording = null;
    ui.recordingShortcut = false;
  }
  function onKey(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stop();
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      assign(recording, null);
      return stop();
    }
    const combo = eventCombo(e);
    if (!combo) return;
    const conflict = actionFor(combo, recording);
    if (conflict) pending = { id: recording, combo, conflict };
    else assign(recording, combo);
    stop();
  }
  function confirmSwap() {
    if (!pending) return;
    assign(pending.id, pending.combo, true);
    pending = null;
  }
  const reveal = (el: HTMLElement) => {
    requestAnimationFrame(() => {
      const sp = el.closest<HTMLElement>('.scroll');
      if (!sp) return el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const pr = sp.getBoundingClientRect();
      if (r.bottom > pr.bottom) sp.scrollTop += r.bottom - pr.bottom + 12;
      else if (r.top < pr.top) sp.scrollTop -= pr.top - r.top + 12;
    });
  };
  const custom = (id: string) => settings.shortcuts?.[id] !== undefined;
</script>

<svelte:window onkeydowncapture={onKey} />

<div class="sc">
  <div class="row">
    <input class="input grow" placeholder={t('Filter shortcuts…')} bind:value={filter} />
    <button class="btn sm" onclick={resetAllShortcuts}>{t('Reset all')}</button>
  </div>
  <p class="small muted">{t('Click a shortcut, then press the new key combination. Esc cancels, Backspace removes it.')}</p>



  {#each groups as [group, list] (group)}
    <h4>{t(group)}</h4>
    <div class="list">
      {#each list as s (s.id)}
        <div class="it" data-shortcut={s.id}>
          <span class="grow small">{t(s.label)}</span>
          <button class="key" class:rec={recording === s.id} class:none={!comboFor(s.id)} onclick={() => (recording === s.id ? stop() : start(s.id))}>
            {recording === s.id ? t('Press keys…') : displayCombo(comboFor(s.id)) || t('Not set')}
          </button>
          <button class="icon-btn sm" title={t('Reset to default')} disabled={!custom(s.id)} onclick={() => resetShortcut(s.id)}>
            <Icon name="undo" size={14} />
          </button>
        </div>
        {#if pending?.id === s.id}
          <div class="conflict card" role="alert" use:reveal>
            <span class="small grow">
              {t('{combo} is already used by “{action}”.', { combo: displayCombo(pending.combo), action: t(pending.conflict.label) })}
            </span>
            <button class="btn sm primary" onclick={confirmSwap}>{t('Reassign')}</button>
            <button class="btn sm" onclick={() => (pending = null)}>{t('Cancel')}</button>
          </div>
        {/if}
      {/each}
    </div>
  {/each}
</div>

<style>
  .sc {
    display: grid;
    gap: 8px;
  }
  h4 {
    margin-top: 10px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .list {
    display: grid;
    gap: 2px;
  }
  .it {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;
  }
  .it:hover {
    background: var(--surface-2);
  }
  .key {
    min-width: 110px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: 6px;
    background: var(--surface);
    font: 500 0.8rem var(--font-mono);
    cursor: pointer;
  }
  .key.none {
    color: var(--muted);
    font-family: var(--font-sans);
    font-style: italic;
  }
  .key.rec {
    border-color: var(--accent);
    color: var(--accent-text);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .conflict {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-color: var(--warn);
  }
</style>
