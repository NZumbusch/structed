<script lang="ts">
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { draggable } from '../lib/dnd';
  import { addToProject, artifactLabel, deleteArtifact, membership, projectsOf, removeFromProject, shortCite, sourceLabel, tagColor, usageCount } from '../lib/ops';
  import { copyText } from '../lib/clipboard';
  import { citeArtifact } from '../lib/cite';
  import { settings } from '../lib/settings.svelte';
  import { renderMd } from '../lib/markdown';
  import type { Artifact, Placement } from '../lib/types';

  let {
    a,
    placement,
    context = 'panel',
    selectable = false,
    selected = false,
    onselect
  }: {
    a: Artifact;
    placement?: Placement;
    context?: 'panel' | 'placed' | 'collect' | 'write';
    selectable?: boolean;
    selected?: boolean;
    onselect?: (v: boolean) => void;
  } = $props();

  const key = $derived(`${placement?.id ?? context}:${a.id}`);
  const expanded = $derived(ui.expandedArtifacts.has(key));
  const source = $derived(db.get('sources', a.sourceId));
  const used = $derived(ui.projectId ? usageCount(a.id, ui.projectId) : 0);
  let showContext = $state(false);
  let imgUrl = $state<string | null>(null);

  $effect(() => {
    if (a.kind !== 'image' || !a.imageId) return;
    let url: string | null = null;
    db.getBlob(a.imageId).then((b) => {
      if (b) imgUrl = url = URL.createObjectURL(b);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  });

  const KIND_ICON: Record<string, string> = { quote: 'quote', paraphrase: 'paraphrase', note: 'note', image: 'image' };

  function wrapQuote(s: string) {
    return settings.citationLocale.startsWith('de') ? `„${s}“` : `“${s}”`;
  }

  async function copy(mode: 'text' | 'cite' | 'both') {
    let out = '';
    if (mode === 'text') out = a.text;
    else {
      const c = (await citeArtifact(a)) || shortCite(a);
      if (mode === 'cite') out = c;
      else out = a.kind === 'quote' ? `${wrapQuote(a.text)} ${c}` : `${a.text} ${c}`;
    }
    if (await copyText(out)) ui.toast(t('Copied'), { kind: 'ok' }, 1500);
  }

  function remove() {
    if (placement) {
      db.remove('placements', placement.id);
      ui.toast(t('Removed from heading'), { action: { label: t('Undo'), run: () => db.undo() } });
    }
  }
  function del() {
    deleteArtifact(a);
    ui.toast(t('Item deleted'), { action: { label: t('Undo'), run: () => db.undo() } });
  }

  const menu = $derived([
    { label: t('Copy text'), icon: 'copy', run: () => copy('text') },
    a.sourceId ? { label: t('Copy with citation'), icon: 'quote', run: () => copy('both') } : null,
    a.sourceId ? { label: t('Copy citation only'), icon: 'book', run: () => copy('cite') } : null,
    null,
    { label: t('Edit'), icon: 'edit', run: () => (ui.editArtifact = { id: a.id }) },
    ui.projectId ? { label: t('Place under heading…'), icon: 'layers', run: () => (ui.placeTarget = a.id) } : null,
    ui.projectId && !membership(a, ui.projectId) ? { label: t('Add to this project'), icon: 'plus', run: () => addToProject(ui.projectId!, 'artifact', a.id) } : null,
    ui.projectId && (membership(a, ui.projectId) === 'item' || membership(a, ui.projectId) === 'source')
      ? { label: t('Remove from project'), icon: 'x', run: () => removeFromProject(ui.projectId!, a) }
      : null,
    source ? { label: t('Open source'), icon: 'book', run: () => { ui.collectSourceId = source.id; ui.stage = 'collect'; } } : null,
    placement ? { label: t('Remove from heading'), icon: 'x', run: remove } : null,
    { label: t('Delete item'), icon: 'trash', run: del, danger: true }
  ]);

  const payload = $derived(
    placement
      ? { type: 'placement' as const, id: placement.id, label: artifactLabel(a, 60) }
      : { type: 'artifact' as const, id: a.id, label: artifactLabel(a, 60) }
  );
</script>

<div
  class="card art k-{a.kind}"
  class:expanded
  class:selected
  style:--tag={a.color || (a.tags[0] && tagColor(a.tags[0])) || undefined}
  use:draggable={{ payload, disabled: context === 'collect' }}
>
  <div class="head">
    {#if selectable}
      <input type="checkbox" checked={selected} onchange={(e) => onselect?.(e.currentTarget.checked)} aria-label="select" />
    {/if}
    <button class="toggle" onclick={() => ui.toggle(ui.expandedArtifacts, key)} aria-expanded={expanded}>
      <span class="kind" title={t(a.kind)}><Icon name={KIND_ICON[a.kind]} size={14} /></span>
      <span class="label" class:clamp={!expanded}>
        {#if a.title}<strong>{a.title}</strong>{#if !expanded && a.text} — <span class="muted">{artifactLabel({ ...a, title: '' }, 120)}</span>{/if}
        {:else}{artifactLabel(a, expanded ? 60 : 180)}{/if}
      </span>
    </button>
    <Menu items={menu} />
  </div>
  {#if !expanded}
    <div class="meta">
      {#if a.sourceId}<span class="cite">{shortCite(a)}</span>{/if}
      {#each a.tags.slice(0, 3) as tg (tg)}<span class="tg">#{tg}</span>{/each}
      {#if context === 'panel' && used}<span class="used" title={t('Placed in this project')}>×{used}</span>{/if}
      {#if context === 'collect'}
        {#each projectsOf(a) as pr (pr.id)}<span class="proj" title={t('Part of project')}>{pr.title || t('Untitled project')}</span>{/each}
      {/if}
      {#if placement?.note}<span class="pnote">· {placement.note}</span>{/if}
    </div>
  {:else}
    <div class="full" data-nodrag>
      {#if a.kind === 'image' && imgUrl}
        <img src={imgUrl} alt={a.title || a.text} />
      {/if}
      {#if a.text}
        {#if a.kind === 'note'}
          <div class="md">{@html renderMd(a.text)}</div>
        {:else}
          <p class="text" class:q={a.kind === 'quote'}>{a.text}</p>
        {/if}
      {/if}
      {#if a.fullText}
        <button class="btn ghost sm" onclick={() => (showContext = !showContext)}>
          <Icon name={showContext ? 'chevron-down' : 'chevron-right'} size={14} />{t('Context / full text')}
        </button>
        {#if showContext}<p class="context">{a.fullText}</p>{/if}
      {/if}
      {#if a.comment}<p class="comment"><Icon name="comment" size={13} /> {a.comment}</p>{/if}
      {#if placement}
        <input
          class="input pn"
          placeholder={t('Why here? (note for this placement)')}
          value={placement.note ?? ''}
          oninput={(e) => db.update('placements', placement.id, { note: e.currentTarget.value })}
        />
      {/if}
      <div class="foot">
        {#if source}<span class="src muted small">{sourceLabel(source)}{a.page ? `, ${t('p.')} ${a.page}` : ''}{source.csl.title ? ` — ${source.csl.title}` : ''}</span>{/if}
        <span class="grow"></span>
        <button class="icon-btn sm" title={t('Copy text')} onclick={() => copy('text')}><Icon name="copy" size={15} /></button>
        {#if a.sourceId}
          <button class="btn sm" title={t('Copy with citation')} onclick={() => copy('both')}><Icon name="quote" size={13} />{t('Cite')}</button>
        {/if}
        <button class="icon-btn sm" title={t('Edit')} onclick={() => (ui.editArtifact = { id: a.id })}><Icon name="edit" size={15} /></button>
      </div>
    </div>
  {/if}
</div>

<style>
  .art {
    --k: var(--k-quote);
    position: relative;
    padding: 6px 6px 6px 12px;
    border-radius: 8px;
    touch-action: pan-y;
    -webkit-touch-callout: none;
    transition: border-color var(--dur), box-shadow var(--dur);
    cursor: grab;
  }
  .art::before {
    content: '';
    position: absolute;
    left: 4px;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 2px;
    background: var(--tag, var(--k));
    opacity: 0.85;
  }
  .art:hover {
    border-color: var(--border-strong);
  }
  .art.selected {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .k-paraphrase {
    --k: var(--k-paraphrase);
  }
  .k-note {
    --k: var(--k-note);
  }
  .k-image {
    --k: var(--k-image);
  }
  .head {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  .head input[type='checkbox'] {
    margin: 6px 2px 0 0;
  }
  .toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 6px;
    align-items: flex-start;
    border: 0;
    background: none;
    padding: 2px 0;
    text-align: left;
    cursor: pointer;
    font-size: 0.875rem;
    line-height: 1.4;
  }
  .kind {
    color: var(--k);
    margin-top: 2px;
  }
  .label {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 2px 0 0 20px;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .cite {
    font-weight: 500;
  }
  .tg {
    color: var(--faint);
  }
  .proj {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--muted);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .used {
    margin-left: auto;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
  .full {
    padding: 4px 4px 2px 20px;
    cursor: auto;
    user-select: text;
    -webkit-user-select: text;
  }
  .text {
    margin: 4px 0 8px;
    font-family: var(--font-text);
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .text.q {
    padding-left: 10px;
    border-left: 2px solid var(--border-strong);
  }
  .context {
    margin: 4px 0 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 0.875rem;
    white-space: pre-wrap;
    font-family: var(--font-text);
  }
  .comment {
    margin: 4px 0 8px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  img {
    max-width: 100%;
    border-radius: 6px;
    margin: 4px 0;
  }
  .pn {
    font-size: 0.8rem;
    min-height: 30px;
    margin-bottom: 6px;
  }
  .pnote {
    font-style: italic;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .src {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
