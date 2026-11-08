<script lang="ts">
  // Earlier versions of one section: slide through them, see what changed, restore one.
  import Modal from './Modal.svelte';
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n';
  import { draftText } from '../lib/draft';
  import { versions, type TextVersion } from '../lib/textHistory';

  let { title, current, headingId, onrestore, onclose }: { title: string; current: string; headingId: string; onrestore: (draft: string) => void; onclose: () => void } =
    $props();

  let list = $state<TextVersion[] | null>(null);
  let i = $state(0);
  onMount(async () => {
    const vs = await versions(headingId);
    list = vs.length && vs[vs.length - 1].draft === current ? vs.slice(0, -1) : vs;
    i = Math.max(0, list.length - 1);
  });

  const plain = (d: string) => draftText(d).trim();
  const sel = $derived(list?.[i] ?? null);
  const prev = $derived(list && i > 0 ? list[i - 1] : null);

  type Part = { kind: 'same' | 'add' | 'del'; text: string };
  /** word-level difference between two texts (small sections only; else just the text) */
  function diff(a: string, b: string): Part[] {
    const A = a.split(/(\s+)/);
    const B = b.split(/(\s+)/);
    if (A.length * B.length > 4_000_000) return [{ kind: 'same', text: b }];
    const n = A.length;
    const m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let x = n - 1; x >= 0; x--) for (let y = m - 1; y >= 0; y--) L[x][y] = A[x] === B[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
    const out: Part[] = [];
    const push = (kind: Part['kind'], text: string) => (out.length && out[out.length - 1].kind === kind ? (out[out.length - 1].text += text) : out.push({ kind, text }));
    let x = 0;
    let y = 0;
    while (x < n && y < m) {
      if (A[x] === B[y]) push('same', A[x++]), y++;
      else if (L[x + 1][y] >= L[x][y + 1]) push('del', A[x++]);
      else push('add', B[y++]);
    }
    while (x < n) push('del', A[x++]);
    while (y < m) push('add', B[y++]);
    return out;
  }
  const parts = $derived(sel ? diff(prev ? plain(prev.draft) : '', plain(sel.draft)) : []);
  const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<Modal title="{t('Earlier versions')}: {title}" {onclose} width="720px">
  {#if list === null}
    <p class="muted">…</p>
  {:else if !list.length}
    <p class="muted">{t('No earlier versions of this section yet. While you write, a version is kept after each finished sentence (on this device).')}</p>
  {:else}
    <div class="top">
      <input id="hist-slider" type="range" min="0" max={list.length - 1} bind:value={i} aria-label={t('Version')} />
      <div class="meta tiny">
        <b>{when(sel!.at)}</b>
        <span class="muted">· {sel!.words.toLocaleString()} {t('words')} · {t('version {n} of {m}', { n: i + 1, m: list.length })}</span>
        <span class="grow"></span>
        <button class="btn sm" disabled={i === 0} onclick={() => i--}>←</button>
        <button class="btn sm" disabled={i === list.length - 1} onclick={() => i++}>→</button>
      </div>
    </div>
    <div class="text" aria-live="polite">
      {#each parts as p, k (k)}{#if p.kind === 'same'}{p.text}{:else if p.kind === 'add'}<ins>{p.text}</ins>{:else}<del>{p.text}</del>{/if}{/each}
    </div>
    <div class="foot">
      <span class="tiny muted grow">{t('Green: new in this version · struck out: removed. Restoring can be undone with Ctrl+Z.')}</span>
      <button class="btn primary" onclick={() => onrestore(sel!.draft)}>{t('Restore this version')}</button>
    </div>
  {/if}
</Modal>

<style>
  .top {
    display: grid;
    gap: 6px;
  }
  input[type='range'] {
    width: 100%;
  }
  .meta,
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  .text {
    margin: 10px 0;
    max-height: 50vh;
    overflow: auto;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--font-text);
    line-height: 1.6;
  }
  ins {
    text-decoration: none;
    background: color-mix(in srgb, var(--ok) 22%, transparent);
  }
  del {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }
</style>
