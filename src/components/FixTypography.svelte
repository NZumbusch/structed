<script lang="ts">
  // Apply the typing helpers (typographic quotes, …, dash, non-breaking spaces) to text that is
  // already there: older text, pasted or imported text. Shows what would change, by kind.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { settings } from '../lib/settings.svelte';
  import { applyTypography, scanTypography, type FixGroup } from '../lib/fixall';

  const changes = scanTypography();
  const GROUPS: [FixGroup, string, string][] = [
    ['quotes', 'Quotes and paraphrases in the library', 'quote'],
    ['notes', 'Notes, comments, captions and source notes', 'note'],
    ['outline', 'Project titles, headings and their notes', 'layers'],
    ['text', 'Written text in Write (with footnotes)', 'edit']
  ];
  const by = (g: FixGroup) => changes.filter((c) => c.group === g);
  let on = $state<Record<FixGroup, boolean>>({ quotes: true, notes: true, outline: true, text: true });
  let open = $state<FixGroup | null>(null);
  const chosen = $derived(changes.filter((c) => on[c.group]));
  /** items, not fields: a quote whose text and comment change counts once */
  const items = $derived(new Set(chosen.map((c) => c.table + '/' + c.id)).size);
  const none = !settings.editorSmartQuotes && !settings.editorAutoDash && !settings.editorNbsp;
  const close = () => (ui.fixTypography = false);

  function apply() {
    const n = applyTypography(chosen);
    close();
    ui.toast(t('Typography fixed in {n} items', { n }), { kind: 'ok', action: { label: t('Undo'), run: () => db.undo() } }, 8000);
  }
</script>

<Modal title={t('Fix typography in existing text')} onclose={close} width="720px">
  <div class="ft">
    <p class="small muted">{t('Applies what happens while typing to text that is already there – older, pasted or imported text: typographic quotation marks as set in Settings, … for "...", “ – ” for “ - ”, non-breaking spaces after “S.”, “§” and inside “z. B.”. A quote in a quote keeps double marks in the library; only where it stands in quotation marks in your text do they become nested ones.')}</p>
    {#if none}
      <p class="small">{t('All typing helpers are switched off in Settings → Editor & export, so there is nothing to fix.')}</p>
    {:else if !changes.length}
      <div class="done"><Icon name="check" size={28} /><p>{t('Everything is already consistent.')}</p></div>
    {:else}
      {#each GROUPS as [g, label, icon] (g)}
        {@const list = by(g)}
        {#if list.length}
          <div class="grp">
            <div class="row">
              <label class="chk grow"><input type="checkbox" bind:checked={on[g]} /><Icon name={icon} size={14} />{t(label)} <span class="muted">({list.length})</span></label>
              <button class="btn ghost sm" onclick={() => (open = open === g ? null : g)} aria-expanded={open === g}>
                <Icon name={open === g ? 'chevron-down' : 'chevron-right'} size={14} />{t('Show changes')}
              </button>
            </div>
            {#if open === g}
              <ul class="ex">
                {#each list.slice(0, 50) as c (c.table + c.id + Object.keys(c.patch).join())}
                  <li>
                    <span class="tiny muted ellipsis">{c.label || t('Untitled')}</span>
                    <span class="was">{c.example[0]}</span>
                    <span class="now">{c.example[1]}</span>
                  </li>
                {/each}
                {#if list.length > 50}<li class="tiny muted">{t('and {n} more', { n: list.length - 50 })}</li>{/if}
              </ul>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
  {#snippet footer()}
    <span class="tiny muted grow">{t('One step: Undo brings everything back.')}</span>
    <button class="btn" onclick={close}>{t('Cancel')}</button>
    {#if changes.length && !none}
      <button class="btn primary" onclick={apply} disabled={!chosen.length}><Icon name="check" size={14} />{t('Fix {n} items', { n: items })}</button>
    {/if}
  {/snippet}
</Modal>

<style>
  .ft {
    display: grid;
    gap: 10px;
  }
  .grp {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 10px;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ex {
    list-style: none;
    margin: 6px 0 2px;
    padding: 0;
    display: grid;
    gap: 8px;
    max-height: 320px;
    overflow: auto;
  }
  .ex li {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .was,
  .now {
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }
  .was {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--muted) 50%, transparent);
  }
  .done {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 20px;
    color: var(--muted);
  }
</style>
