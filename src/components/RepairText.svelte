<script lang="ts">
  // Text from a PDF with its repairs shown in colour (see lib/repair.ts):
  //  green  = sure, orange = to check, red = a "?" no word fits.
  // A repair is a suggestion until applied; applied ones show the new word, and the old one on
  // hover. Click a marked word (or focus it and press 1–9 / 0) to choose. Nothing is hidden.
  import { untrack } from 'svelte';
  import { t } from '../lib/i18n';
  import { ui, type MenuItem } from '../lib/ui.svelte';
  import { settings } from '../lib/settings.svelte';
  import { applyFixes, findFixes, remember, type Dict, type Fix } from '../lib/repair';

  let {
    base,
    dict,
    value = $bindable(''),
    cls = ''
  }: { base: string; dict: Dict | null; value?: string; cls?: string } = $props();

  const fixes = $derived(dict ? findFixes(base, dict) : []);
  let chosen = $state<(string | null)[]>([]);
  // new text: start over (sure repairs applied right away if set so)
  $effect(() => {
    const fx = fixes;
    untrack(() => (chosen = fx.map((f) => (settings.repairAuto && f.level === 'sure' ? f.options[0] : null))));
  });
  $effect(() => {
    value = applyFixes(base, fixes, chosen);
  });

  const parts = $derived.by(() => {
    const out: ({ s: string } | { f: Fix; i: number })[] = [];
    let at = 0;
    fixes.forEach((f, i) => {
      if (f.start > at) out.push({ s: base.slice(at, f.start) });
      out.push({ f, i });
      at = f.end;
    });
    if (at < base.length) out.push({ s: base.slice(at) });
    return out;
  });
  const count = (l: Fix['level']) => fixes.filter((f) => f.level === l).length;
  const pendingSure = $derived(fixes.some((f, i) => f.level === 'sure' && chosen[i] == null));
  const anyApplied = $derived(chosen.some((c) => c != null));

  function choose(i: number, v: string | null) {
    const f = fixes[i];
    chosen[i] = v;
    // a word decided by hand is repaired the same way next time
    if (v && f.level !== 'sure' && f.from.includes('?') && !f.from.includes(' ')) remember({ [f.from]: v });
  }
  /** apply all repairs that are sure (the ones to check stay for you) */
  export function applySure() {
    chosen = fixes.map((f, i) => (f.level === 'sure' ? f.options[0] : chosen[i]));
  }
  export function undoAll() {
    chosen = fixes.map(() => null);
  }
  export const hasPendingSure = () => pendingSure;

  function menu(e: MouseEvent, i: number) {
    const f = fixes[i];
    const items: MenuItem[] = f.options.slice(0, 9).map((o, k) => ({ label: `${k + 1}  ${o}`, icon: chosen[i] === o ? 'check' : undefined, run: () => choose(i, o) }));
    if (!f.options.length) items.push({ label: t('No word fits – edit the text (E)'), run: () => {} });
    items.push(null, { label: `0  ${t('Keep as it is')}: ${f.from}`, icon: chosen[i] == null ? 'check' : undefined, run: () => choose(i, null) });
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    ui.contextMenu = { x: r.left, y: r.bottom + 4, items, title: LABEL[f.level] };
  }
  function key(e: KeyboardEvent, i: number) {
    const f = fixes[i];
    if (/^[1-9]$/.test(e.key) && f.options[+e.key - 1]) choose(i, f.options[+e.key - 1]);
    else if (e.key === '0') choose(i, null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
  const LABEL: Record<Fix['level'], string> = {
    sure: t('Sure repair'),
    check: t('Please check'),
    unsolved: t('Not repaired')
  };
  const title = (f: Fix, i: number) =>
    `${LABEL[f.level]}${chosen[i] != null ? ` · ${t('was')}: ${f.from}` : f.options.length ? ` · ${t('suggestion')}: ${f.options.slice(0, 3).join(' / ')}` : ''}\n${t('Click, or 1–9 / 0 when focused')}`;
</script>

<p class="rt {cls}">
  {#each parts as p, k (k)}{#if 's' in p}{p.s}{:else}<button
        type="button"
        class="fx {p.f.level}"
        class:on={chosen[p.i] != null}
        title={title(p.f, p.i)}
        onclick={(e) => menu(e, p.i)}
        onkeydown={(e) => key(e, p.i)}>{chosen[p.i] ?? p.f.from}</button
      >{/if}{/each}
</p>
{#if fixes.length}
  <div class="rbar tiny">
    <span class="muted">
      {t('Repairs')}:
      {#if count('sure')}<span class="lg sure">{count('sure')} {t('sure')}</span>{/if}
      {#if count('check')}<span class="lg check">{count('check')} {t('to check')}</span>{/if}
      {#if count('unsolved')}<span class="lg unsolved">{count('unsolved')} {t('not repaired')}</span>{/if}
    </span>
    <span class="grow"></span>
    {#if pendingSure}<button type="button" class="btn sm" onclick={applySure} title="A">{t('Apply sure repairs')} <kbd>A</kbd></button>{/if}
    {#if anyApplied}<button type="button" class="btn sm ghost" onclick={undoAll}>{t('Undo repairs')}</button>{/if}
  </div>
{/if}

<style>
  .rt {
    margin: 0;
    font-family: var(--font-text);
    font-size: 1.05rem;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .fx {
    all: unset;
    cursor: pointer;
    border-radius: 3px;
    text-decoration-line: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }
  .fx:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  /* suggestions not applied yet: underlined */
  .fx.sure {
    text-decoration-style: dotted;
    text-decoration-color: var(--ok);
  }
  .fx.check {
    text-decoration-style: wavy;
    text-decoration-color: var(--warn);
  }
  .fx.unsolved {
    text-decoration-style: wavy;
    text-decoration-color: var(--danger);
  }
  /* applied: the new word on a coloured ground */
  .fx.on {
    text-decoration: none;
  }
  .fx.on.sure {
    background: color-mix(in srgb, var(--ok) 20%, transparent);
  }
  .fx.on.check {
    background: color-mix(in srgb, var(--warn) 24%, transparent);
  }
  .rbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .grow {
    flex: 1;
  }
  .lg {
    margin-left: 6px;
    padding: 0 6px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .lg.sure {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
  }
  .lg.check {
    background: color-mix(in srgb, var(--warn) 22%, transparent);
  }
  .lg.unsolved {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }
  kbd {
    margin-left: 4px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.7rem;
    opacity: 0.8;
  }
</style>
