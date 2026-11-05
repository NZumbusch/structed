<script lang="ts">
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui, type Stage } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { artifactLabel, authorsFull, flatten, sourceLabel } from '../lib/ops';

  interface Hit {
    icon: string;
    label: string;
    sub?: string;
    score: number;
    run: () => void;
  }
  let q = $state('');
  let hi = $state(0);
  let input: HTMLInputElement;
  $effect(() => input?.focus());

  function score(hay: string, qq: string): number {
    const h = hay.toLowerCase();
    if (!qq) return 1;
    const words = qq.split(/\s+/).filter(Boolean);
    let s = 0;
    for (const w of words) {
      const i = h.indexOf(w);
      if (i < 0) return 0;
      s += i === 0 ? 3 : /\W/.test(h[i - 1] ?? ' ') ? 2 : 1;
    }
    return s;
  }

  const hits = $derived.by(() => {
    const qq = q.trim().toLowerCase();
    const out: Hit[] = [];
    const stages: [Stage, string][] = [
      ['outline', t('Outline')],
      ['collect', t('Collect')],
      ['arrange', t('Arrange')],
      ['write', t('Write')]
    ];
    for (const [s, l] of stages) {
      const sc = score(`${t('Go to')} ${l}`, qq);
      if (sc && qq) out.push({ icon: 'layers', label: `${t('Go to')} ${l}`, score: sc - 0.5, run: () => (ui.stage = s) });
    }
    for (const [lab, icon, run] of [
      [t('Settings'), 'settings', () => (ui.dialog = 'settings')],
      [t('Export…'), 'upload', () => (ui.dialog = 'export')],
      [t('Import from Zotero…'), 'download', () => (ui.dialog = 'zotero')],
      [t('Snapshots'), 'history', () => (ui.dialog = 'snapshots')],
      [t('New quote'), 'quote', () => (ui.editArtifact = { kind: 'quote' })],
      [t('New note'), 'note', () => (ui.editArtifact = { kind: 'note' })]
    ] as [string, string, () => void][]) {
      const sc = score(lab, qq);
      if (sc && qq) out.push({ icon, label: lab, score: sc - 0.5, run });
    }
    if (ui.projectId) {
      for (const f of flatten(ui.projectId)) {
        const sc = score(f.h.title + ' ' + f.h.body, qq);
        if (sc)
          out.push({
            icon: 'menu',
            label: `${f.num} ${f.h.title || t('Untitled')}`,
            sub: f.h.body.slice(0, 80),
            score: sc + (score(f.h.title, qq) ? 2 : 0),
            run: () => {
              for (let p = f.h.parentId; p; p = db.get('headings', p)?.parentId ?? null) ui.collapsed.delete(p);
              if (ui.stage === 'collect') ui.stage = 'outline';
              ui.focusHeading = f.h.id;
            }
          });
      }
    }
    if (qq) {
      for (const a of db.all('artifacts')) {
        const s = db.get('sources', a.sourceId);
        const sc = score(`${a.title} ${a.text} ${a.comment} ${a.tags.join(' ')} ${s ? sourceLabel(s) : ''}`, qq);
        if (sc)
          out.push({
            icon: a.kind,
            label: artifactLabel(a, 80),
            sub: s ? sourceLabel(s) + (a.page ? `, ${a.page}` : '') : undefined,
            score: sc,
            run: () => (ui.editArtifact = { id: a.id })
          });
      }
      for (const s of db.all('sources')) {
        const sc = score(`${sourceLabel(s)} ${s.csl.title} ${authorsFull(s.csl)}`, qq);
        if (sc)
          out.push({
            icon: 'book',
            label: sourceLabel(s),
            sub: s.csl.title,
            score: sc + 0.5,
            run: () => {
              ui.collectSourceId = s.id;
              ui.stage = 'collect';
            }
          });
      }
      for (const p of db.all('projects')) {
        const sc = score(p.title, qq);
        if (sc) out.push({ icon: 'folder', label: p.title, sub: t('Project'), score: sc + 1, run: () => (ui.projectId = p.id) });
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 40);
  });

  function go(h: Hit | undefined) {
    if (!h) return;
    ui.dialog = null;
    h.run();
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      hi = Math.min(hi + 1, hits.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hi = Math.max(hi - 1, 0);
    } else if (e.key === 'Enter') go(hits[hi]);
    else if (e.key === 'Escape') ui.dialog = null;
  }
</script>

<div class="bd" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && (ui.dialog = null)}>
  <div class="pal" role="dialog" aria-label={t('Search')}>
    <div class="in">
      <Icon name="search" />
      <input bind:this={input} bind:value={q} oninput={() => (hi = 0)} onkeydown={key} placeholder={t('Search headings, quotes, sources, commands…')} />
      <span class="kbd">Esc</span>
    </div>
    <div class="res scroll">
      {#each hits as h, i (i)}
        <button class="hit" class:on={i === hi} onpointerenter={() => (hi = i)} onclick={() => go(h)}>
          <Icon name={h.icon} size={15} />
          <span class="grow ellipsis">{h.label}{#if h.sub}<span class="muted small"> — {h.sub}</span>{/if}</span>
        </button>
      {:else}
        <div class="empty small">{t('Nothing found')}</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .bd {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgb(10 12 16 / 0.35);
    display: flex;
    justify-content: center;
    padding: 10vh 16px 16px;
  }
  .pal {
    width: min(640px, 100%);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .in {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }
  .in input {
    flex: 1;
    border: 0;
    outline: 0;
    background: none;
    font-size: 1.05rem;
    color: var(--text);
  }
  .res {
    padding: 6px;
  }
  .hit {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--text);
  }
  .hit.on {
    background: var(--accent-soft);
  }
</style>
