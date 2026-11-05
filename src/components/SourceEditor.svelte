<script lang="ts">
  import Modal from './Modal.svelte';
  import TagInput from './TagInput.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { deleteSource, nameStr, yearOf } from '../lib/ops';
  import { referenceOf } from '../lib/cite';
  import type { CSLItem, CSLName } from '../lib/types';

  const req = ui.editSource!;
  const existing = req.id ? db.get('sources', req.id) : undefined;
  const c: CSLItem = existing ? JSON.parse(JSON.stringify(existing.csl)) : { id: '', type: 'book', title: '', author: [] };

  const TYPES = ['book', 'chapter', 'article-journal', 'article-newspaper', 'article-magazine', 'paper-conference', 'thesis', 'report', 'webpage', 'entry-encyclopedia', 'manuscript', 'interview', 'motion_picture', 'legislation', 'legal_case', 'dataset', 'software'];

  const namesToText = (n?: CSLName[]) => (n ?? []).map((x) => (x.literal ? x.literal : [x.family, x.given].filter(Boolean).join(', '))).join('\n');
  const textToNames = (s: string): CSLName[] =>
    s
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        if (l.includes(',')) {
          const [family, ...g] = l.split(',');
          return { family: family.trim(), given: g.join(',').trim() };
        }
        const parts = l.split(/\s+/);
        if (parts.length === 1) return { literal: l };
        return { family: parts.pop()!, given: parts.join(' ') };
      });

  let type = $state(c.type);
  let title = $state(c.title ?? '');
  let authors = $state(namesToText(c.author));
  let editors = $state(namesToText(c.editor));
  let year = $state(yearOf(c));
  let container = $state((c['container-title'] as string) ?? '');
  let publisher = $state(c.publisher ?? '');
  let place = $state(c['publisher-place'] ?? '');
  let pages = $state(c.page ?? '');
  let volume = $state(c.volume ?? '');
  let issue = $state(c.issue ?? '');
  let doi = $state(c.DOI ?? '');
  let url = $state(c.URL ?? '');
  let isbn = $state(c.ISBN ?? '');
  let tags = $state<string[]>([...(existing?.tags ?? [])]);
  let note = $state(existing?.note ?? '');
  let preview = $state('');
  let advanced = $state(false);
  let raw = $state(JSON.stringify(c, null, 2));
  let rawErr = $state('');

  function build(): CSLItem {
    const out: CSLItem = { ...c, type, title };
    const set = (k: string, v: string) => {
      if (v.trim()) out[k] = v.trim();
      else delete out[k];
    };
    out.author = textToNames(authors);
    const ed = textToNames(editors);
    if (ed.length) out.editor = ed;
    else delete out.editor;
    if (year.trim()) out.issued = /^\d{4}$/.test(year.trim()) ? { 'date-parts': [[+year.trim()]] } : { raw: year.trim() };
    else delete out.issued;
    set('container-title', container);
    set('publisher', publisher);
    set('publisher-place', place);
    set('page', pages);
    set('volume', volume);
    set('issue', issue);
    set('DOI', doi);
    set('URL', url);
    set('ISBN', isbn);
    return out;
  }

  $effect(() => {
    const csl = build();
    const fake = { ...(existing ?? {}), id: existing?.id ?? 'preview', csl } as never;
    const timer = setTimeout(() => referenceOf(fake).then((r) => (preview = r)).catch(() => (preview = '')), 250);
    return () => clearTimeout(timer);
  });

  function save() {
    let csl = build();
    if (advanced) {
      try {
        csl = JSON.parse(raw);
      } catch (e) {
        rawErr = String(e);
        return;
      }
    }
    if (existing) db.update('sources', existing.id, { csl, tags, note });
    else {
      const s = db.create('sources', { csl, tags, note });
      ui.collectSourceId = s.id;
    }
    ui.editSource = null;
  }
  function del() {
    if (!existing) return;
    const n = db.all('artifacts').filter((a) => a.sourceId === existing.id).length;
    const withItems = n > 0 && confirm(t('Also delete the {n} items of this source? (Cancel keeps them as unsourced items)', { n }));
    deleteSource(existing, withItems);
    ui.editSource = null;
    ui.toast(t('Source deleted'), { action: { label: t('Undo'), run: () => db.undo() } });
  }
</script>

<Modal title={existing ? t('Edit source') : t('New source')} onclose={() => (ui.editSource = null)} width="680px">
  <div class="grid">
    <label class="field span2"><span>{t('Title')}</span><input class="input" bind:value={title} /></label>
    <label class="field"><span>{t('Type')}</span>
      <select class="select" bind:value={type}>{#each TYPES as ty (ty)}<option value={ty}>{ty}</option>{/each}</select>
    </label>
    <label class="field"><span>{t('Year')}</span><input class="input" bind:value={year} /></label>
    <label class="field"><span>{t('Authors (one per line: Family, Given)')}</span><textarea class="textarea" rows="3" bind:value={authors}></textarea></label>
    <label class="field"><span>{t('Editors')}</span><textarea class="textarea" rows="3" bind:value={editors}></textarea></label>
    <label class="field span2"><span>{t('Journal / book / container')}</span><input class="input" bind:value={container} /></label>
    <label class="field"><span>{t('Publisher')}</span><input class="input" bind:value={publisher} /></label>
    <label class="field"><span>{t('Place')}</span><input class="input" bind:value={place} /></label>
    <label class="field"><span>{t('Volume')}</span><input class="input" bind:value={volume} /></label>
    <label class="field"><span>{t('Issue')}</span><input class="input" bind:value={issue} /></label>
    <label class="field"><span>{t('Pages')}</span><input class="input" bind:value={pages} /></label>
    <label class="field"><span>ISBN</span><input class="input" bind:value={isbn} /></label>
    <label class="field"><span>DOI</span><input class="input" bind:value={doi} /></label>
    <label class="field"><span>URL</span><input class="input" bind:value={url} /></label>
    <label class="field span2"><span>{t('Tags / topics')}</span><TagInput bind:tags /></label>
    <label class="field span2"><span>{t('Notes on this source')}</span><textarea class="textarea" rows="2" bind:value={note}></textarea></label>
  </div>
  {#if preview}
    <div class="preview"><span class="tiny muted">{t('Reference preview')}</span><div>{preview}</div></div>
  {/if}
  {#if existing?.zoteroKey}<p class="tiny muted">Zotero: {existing.zoteroLibrary}/{existing.zoteroKey}</p>{/if}
  <button class="btn ghost sm" onclick={() => { advanced = !advanced; raw = JSON.stringify(build(), null, 2); }}>
    <Icon name={advanced ? 'chevron-down' : 'chevron-right'} size={14} />{t('Raw CSL-JSON (advanced)')}
  </button>
  {#if advanced}
    <textarea class="textarea mono" rows="10" bind:value={raw}></textarea>
    {#if rawErr}<p class="small" style="color:var(--danger)">{rawErr}</p>{/if}
  {/if}
  {#snippet footer()}
    {#if existing}<button class="btn danger" onclick={del}><Icon name="trash" size={14} />{t('Delete')}</button>{/if}
    <span class="grow"></span>
    <button class="btn" onclick={() => (ui.editSource = null)}>{t('Cancel')}</button>
    <button class="btn primary" onclick={save}>{t('Save')}</button>
  {/snippet}
</Modal>

<style>
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 12px;
  }
  .span2 {
    grid-column: span 2;
  }
  .preview {
    margin: 14px 0 6px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--surface-2);
    font-family: var(--font-serif);
    font-size: 0.9rem;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .span2 {
      grid-column: auto;
    }
  }
</style>
