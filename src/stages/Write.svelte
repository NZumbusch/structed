<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import MdEditor from '../components/MdEditor.svelte';
  import ArtifactCard from '../components/ArtifactCard.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { flatten, headingWords, placementsOf, wordCount } from '../lib/ops';
  import { renderMd } from '../lib/markdown';
  import type { Project } from '../lib/types';

  let { project }: { project: Project } = $props();

  let showItems = $state(true);
  let showComments = $state(true);
  let showResolved = $state(false);
  let editing = $state<string | null>(null);
  let newComment = $state<Record<string, string>>({});
  let scroller: HTMLDivElement;
  let current = $state<string | null>(null);

  const flat = $derived(flatten(project.id));
  const comments = $derived(db.all('comments').filter((c) => c.projectId === project.id).sort((a, b) => a.createdAt - b.createdAt));
  const total = $derived(flat.reduce((n, f) => n + wordCount(f.h.body), 0));

  function go(id: string) {
    const el = scroller?.querySelector(`[data-sec="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $effect(() => {
    if (ui.focusHeading) {
      const id = ui.focusHeading;
      tick().then(() => {
        go(id);
        ui.focusHeading = null;
      });
    }
  });

  function onScroll() {
    const secs = scroller.querySelectorAll<HTMLElement>('[data-sec]');
    const top = scroller.getBoundingClientRect().top + 80;
    let cur: string | null = null;
    for (const s of secs) {
      if (s.getBoundingClientRect().top <= top) cur = s.dataset.sec!;
      else break;
    }
    current = cur;
  }

  function addComment(targetId: string) {
    const text = newComment[targetId]?.trim();
    if (!text) return;
    db.create('comments', { projectId: project.id, targetId, text });
    newComment[targetId] = '';
  }

  function expandAll(v: boolean) {
    for (const f of flat)
      for (const p of placementsOf(f.h.id)) {
        const k = `${p.id}:${p.artifactId}`;
        if (v) ui.expandedArtifacts.add(k);
        else ui.expandedArtifacts.delete(k);
      }
  }
</script>

<div class="write">
  <nav class="toc scroll">
    <div class="tochead tiny muted">{t('Contents')} · {total.toLocaleString()} {t('words')}</div>
    {#each flat as f (f.h.id)}
      <button class="ti" class:on={current === f.h.id} style="--d:{f.depth}" onclick={() => go(f.h.id)}>
        <span class="dot s-{f.h.status ?? 'idea'}"></span>
        <span class="tn">{f.num}</span>
        <span class="tt ellipsis">{f.h.title || t('Untitled')}</span>
      </button>
    {/each}
  </nav>

  <div class="doc scroll" bind:this={scroller} onscroll={onScroll}>
    <div class="tools row small">
      <label class="row"><input type="checkbox" bind:checked={showItems} />{t('Quotes & notes')}</label>
      <label class="row"><input type="checkbox" bind:checked={showComments} />{t('Comments')}</label>
      {#if showComments}<label class="row"><input type="checkbox" bind:checked={showResolved} />{t('Resolved')}</label>{/if}
      <span class="grow"></span>
      {#if showItems}
        <button class="btn ghost sm" onclick={() => expandAll(true)}>{t('Expand all')}</button>
        <button class="btn ghost sm" onclick={() => expandAll(false)}>{t('Collapse all')}</button>
      {/if}
    </div>
    <article class="paper">
      <h1 class="dtitle">{project.title || t('Untitled project')}</h1>
      {#if project.subtitle}<p class="dsub">{project.subtitle}</p>{/if}

      {#each flat as f (f.h.id)}
        {@const h = f.h}
        {@const ps = placementsOf(h.id)}
        {@const cs = comments.filter((c) => c.targetId === h.id && (showResolved || !c.resolved))}
        <section class="sec" data-sec={h.id} style="--d:{f.depth}">
          <div class="sh row">
            <svelte:element this={`h${Math.min(f.depth + 2, 6)}`} class="ht">
              <span class="hn">{f.num}</span>{h.title || t('Untitled')}
            </svelte:element>
            <span class="grow"></span>
            {#if h.targetWords}
              {@const w = headingWords(project.id, h)}
              <span class="prog" title="{w}/{h.targetWords}"><span style="width:{Math.min(100, (w / h.targetWords) * 100)}%"></span></span>
            {/if}
            <span class="chip s-{h.status ?? 'idea'}">{t(h.status ?? 'idea')}</span>
          </div>

          {#if editing === h.id}
            <div class="edit">
              <MdEditor value={h.body} onchange={(v) => db.update('headings', h.id, { body: v })} autofocus placeholder={t('Write…')} onkeydown={(e) => { if (e.key === 'Escape') { editing = null; return true; } }} />
              <div class="row"><span class="grow tiny muted">{wordCount(h.body)} {t('words')}</span><button class="btn sm" onclick={() => (editing = null)}>{t('Done')}</button></div>
            </div>
          {:else if h.body}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="md body" ondblclick={() => (editing = h.id)}>{@html renderMd(h.body)}</div>
            <button class="btn ghost sm editbtn" onclick={() => (editing = h.id)}><Icon name="edit" size={13} />{t('Edit')}</button>
          {:else}
            <button class="btn ghost sm addtext" onclick={() => (editing = h.id)}><Icon name="plus" size={13} />{t('Write text')}</button>
          {/if}

          {#if showItems && ps.length}
            <div class="items">
              {#each ps as p (p.id)}
                {@const a = db.get('artifacts', p.artifactId)}
                {#if a}<ArtifactCard {a} placement={p} context="write" />{/if}
              {/each}
            </div>
          {/if}

          {#if showComments}
            <div class="comments">
              {#each cs as c (c.id)}
                <div class="cm" class:resolved={c.resolved}>
                  <Icon name="comment" size={13} />
                  <span class="grow">{c.text}</span>
                  <span class="tiny muted">{new Date(c.createdAt).toLocaleDateString()}</span>
                  <button class="icon-btn sm" title={c.resolved ? t('Reopen') : t('Resolve')} onclick={() => db.update('comments', c.id, { resolved: !c.resolved })}><Icon name="check" size={14} /></button>
                  <button class="icon-btn sm" title={t('Delete')} onclick={() => db.remove('comments', c.id)}><Icon name="x" size={14} /></button>
                </div>
              {/each}
              <input
                class="cin"
                placeholder={t('Add a comment…')}
                value={newComment[h.id] ?? ''}
                oninput={(e) => (newComment[h.id] = e.currentTarget.value)}
                onkeydown={(e) => e.key === 'Enter' && addComment(h.id)}
              />
            </div>
          {/if}
        </section>
      {/each}
    </article>
  </div>
</div>

<style>
  .write {
    display: grid;
    grid-template-columns: 240px 1fr;
    height: 100%;
    min-height: 0;
  }
  .toc {
    padding: 14px 8px;
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  .tochead {
    padding: 0 8px 8px;
  }
  .ti {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 8px 4px calc(8px + var(--d) * 12px);
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .ti:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .ti.on {
    color: var(--text);
    background: var(--surface-2);
    font-weight: 500;
  }
  .tn {
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--faint);
    flex: none;
  }
  .dot.s-draft {
    background: var(--k-quote);
  }
  .dot.s-revise {
    background: var(--warn);
  }
  .dot.s-done {
    background: var(--ok);
  }
  .doc {
    min-height: 0;
  }
  .tools {
    position: sticky;
    top: 0;
    z-index: 2;
    gap: 14px;
    padding: 8px 24px;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--border);
  }
  .paper {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 28px 24px 160px;
  }
  .dtitle {
    font-size: 2em;
    letter-spacing: -0.02em;
  }
  .dsub {
    margin: 4px 0 0;
    color: var(--muted);
  }
  .sec {
    margin-top: 28px;
    scroll-margin-top: 50px;
  }
  .sec[style*='--d:0'] {
    margin-top: 40px;
  }
  .sh {
    gap: 10px;
  }
  .ht {
    margin: 0;
  }
  :global(h2.ht) {
    font-size: 1.45em;
  }
  :global(h3.ht) {
    font-size: 1.2em;
  }
  :global(h4.ht),
  :global(h5.ht),
  :global(h6.ht) {
    font-size: 1.02em;
  }
  .hn {
    margin-right: 10px;
    color: var(--faint);
    font-weight: 500;
  }
  .chip.s-draft {
    color: var(--k-quote);
  }
  .chip.s-revise {
    color: var(--warn);
  }
  .chip.s-done {
    color: var(--ok);
  }
  .prog {
    width: 60px;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .prog span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .body {
    margin-top: 8px;
  }
  .editbtn {
    opacity: 0;
    margin-top: 2px;
    color: var(--muted);
  }
  .sec:hover .editbtn {
    opacity: 1;
  }
  @media (hover: none) {
    .editbtn {
      opacity: 1;
    }
  }
  .addtext {
    margin-top: 4px;
    color: var(--faint);
  }
  .edit {
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--surface);
  }
  .items {
    display: grid;
    gap: 6px;
    margin-top: 10px;
  }
  .comments {
    margin-top: 8px;
    display: grid;
    gap: 4px;
  }
  .cm {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px 4px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    font-size: 0.85rem;
  }
  .cm.resolved {
    opacity: 0.55;
    text-decoration: line-through;
  }
  .cin {
    width: 100%;
    border: 0;
    border-bottom: 1px dashed transparent;
    background: transparent;
    padding: 4px 2px;
    font-size: 0.82rem;
    outline: none;
    color: var(--muted);
    opacity: 0.5;
  }
  .sec:hover .cin,
  .cin:focus {
    opacity: 1;
    border-bottom-color: var(--border);
  }
  @media (max-width: 900px) {
    .write {
      grid-template-columns: 1fr;
    }
    .toc {
      display: none;
    }
    .paper {
      padding: 18px 14px 120px;
    }
    .tools {
      padding: 8px 12px;
      flex-wrap: wrap;
    }
    .cin {
      opacity: 1;
    }
  }
</style>
