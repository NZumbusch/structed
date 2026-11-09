<script lang="ts">
  // Repair quotes already in the library (text from PDFs: "?" for umlauts, broken words),
  // one at a time with every repair shown in colour, or all sure repairs at once.
  import { onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import RepairText from './RepairText.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { applyFixes, findFixes, loadDict, type Dict } from '../lib/repair';
  import { artifactLabel, sourceLabel } from '../lib/ops';
  import type { Artifact } from '../lib/types';

  let dict = $state<Dict | null>(null);
  let failed = $state(false);
  let list = $state<Artifact[]>([]);
  let i = $state(0);
  let saved = $state(0);
  let repaired = $state('');
  let repairer = $state<{ applySure: () => void } | null>(null);

  onMount(async () => {
    // keys belong to the dialog, not to the button that opened it
    (document.activeElement as HTMLElement | null)?.blur?.();
    const d = await loadDict();
    if (!d) return void (failed = true);
    dict = d;
    const ids = new Set(ui.repairItems ?? []);
    list = db
      .all('artifacts')
      .filter((a) => ids.has(a.id) && a.kind !== 'image' && a.text && findFixes(a.text, d).length)
      .sort((a, b) => (a.sourceId ?? '').localeCompare(b.sourceId ?? '') || (a.page ?? '').localeCompare(b.page ?? '', undefined, { numeric: true }));
  });

  const cur = $derived(list[i]);
  const src = $derived(cur ? db.get('sources', cur.sourceId) : undefined);

  function save() {
    if (!cur) return;
    if (repaired && repaired !== cur.text) {
      db.update('artifacts', cur.id, { text: repaired });
      saved++;
    }
    i++;
  }
  const skip = () => i++;
  /** every sure repair in the remaining quotes, saved at once (the ones to check stay as they are) */
  function allSure() {
    if (!dict) return;
    let n = 0;
    db.batch('repair quotes', () => {
      for (const a of list.slice(i)) {
        const fx = findFixes(a.text, dict!);
        const text = applyFixes(a.text, fx, fx.map((f) => (f.level === 'sure' ? f.options[0] : null)));
        if (text !== a.text) {
          db.update('artifacts', a.id, { text });
          n++;
        }
      }
    });
    saved += n;
    i = list.length;
    ui.toast(t('{n} quotes repaired', { n }), { kind: 'ok', action: { label: t('Undo'), run: () => db.undo() } }, 6000);
  }
  function key(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = { enter: save, s: skip, a: () => repairer?.applySure() };
    if (map[k] && cur) {
      e.preventDefault();
      map[k]();
    }
  }
  const close = () => (ui.repairItems = null);
</script>

<svelte:window onkeydown={key} />

<Modal title={t('Repair text from PDFs')} onclose={close} width="880px">
  <div class="rq">
    {#if failed}
      <p class="err">{t('The word list could not be loaded. Check the connection and try again.')}</p>
    {:else if !dict}
      <p class="muted">{t('Loading the word list (once, about 0.7 MB)…')}</p>
    {:else if cur}
      <div class="where row small">
        <span class="grow ellipsis"><b>{src ? sourceLabel(src) : ''}</b> <span class="muted">{cur.page ? `${t('p.')} ${cur.page} · ` : ''}{artifactLabel(cur, 60)}</span></span>
        <span class="muted nowrap">{t('{a} of {b}', { a: i + 1, b: list.length })}</span>
      </div>
      <article class="box">
        <RepairText bind:this={repairer} base={cur.text} {dict} bind:value={repaired} />
      </article>
      <div class="row acts">
        <button class="btn ghost sm" onclick={allSure} title={t('Applies only the sure (green) repairs; the ones to check stay unchanged')}>
          <Icon name="sparkle" size={14} />{t('Apply all sure repairs to the remaining {n}', { n: list.length - i })}
        </button>
        <span class="grow"></span>
        <button class="btn" onclick={skip}>{t('Skip')} <kbd>S</kbd></button>
        <button class="btn primary" onclick={save}><Icon name="check" size={14} />{t('Save and next')} <kbd>↵</kbd></button>
      </div>
    {:else}
      <div class="done">
        <Icon name="check" size={28} />
        <p>{list.length ? t('Done: {n} quotes repaired.', { n: saved }) : t('Nothing to repair in these quotes.')}</p>
      </div>
    {/if}
  </div>
  {#snippet footer()}
    <span class="tiny muted grow">{t('Green: sure · orange: please check · red: not repaired. Click a marked word to choose.')}</span>
    <button class="btn" onclick={close}>{t('Done')}</button>
  {/snippet}
</Modal>

<style>
  .rq {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }
  .where {
    gap: 10px;
  }
  .nowrap {
    white-space: nowrap;
  }
  .box {
    padding: 14px 16px;
    border-radius: 8px;
    background: var(--surface-2);
    max-height: 55vh;
    overflow-y: auto;
  }
  .acts {
    flex-wrap: wrap;
    gap: 6px;
  }
  kbd {
    margin-left: 4px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.7rem;
    opacity: 0.8;
  }
  .done {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 24px 0;
    text-align: center;
  }
  .err {
    color: var(--danger);
  }
  @media (max-width: 600px) {
    kbd {
      display: none;
    }
  }
</style>
