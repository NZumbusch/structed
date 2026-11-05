<script lang="ts">
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { copyText, download, safeName } from '../lib/clipboard';
  import { defaultMd, exportBib, toDocx, toMarkdown, usedSources, type MdOptions } from '../lib/export';

  const project = db.get('projects', ui.projectId!)!;
  let o: MdOptions = $state(JSON.parse(localStorage.getItem('structed.exportOpts') || 'null') ?? { ...defaultMd });
  $effect(() => localStorage.setItem('structed.exportOpts', JSON.stringify(o)));
  let preview = $state('');
  let busy = $state(false);
  let bibScope = $state<'project' | 'all'>('project');

  $effect(() => {
    const opts = $state.snapshot(o);
    const tm = setTimeout(() => toMarkdown(project, opts).then((m) => (preview = m)), 200);
    return () => clearTimeout(tm);
  });

  const name = safeName(project.title);
  async function md(copy = false) {
    const m = await toMarkdown(project, $state.snapshot(o));
    if (copy) {
      if (await copyText(m)) ui.toast(t('Copied'), { kind: 'ok' });
    } else download(`${name}.md`, m, 'text/markdown');
  }
  async function docx() {
    busy = true;
    try {
      download(`${name}.docx`, await toDocx(project, $state.snapshot(o)), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } finally {
      busy = false;
    }
  }
  async function bib(fmt: 'bibtex' | 'csljson') {
    const s = await exportBib(bibScope === 'project' ? project.id : null, fmt);
    download(fmt === 'bibtex' ? `${name}.bib` : `${name}.json`, s, fmt === 'bibtex' ? 'application/x-bibtex' : 'application/json');
  }
  const nUsed = usedSources(project.id).length;
</script>

<Modal title={t('Export')} onclose={() => (ui.dialog = null)} width="900px">
  <div class="ex">
    <div class="opts">
      <h4>{t('Content')}</h4>
      <label><input type="checkbox" bind:checked={o.numbering} />{t('Numbered headings')}</label>
      <label><input type="checkbox" bind:checked={o.bodies} />{t('Section texts / notes')}</label>
      <label><input type="checkbox" bind:checked={o.comments} />{t('Open comments')}</label>
      <label><input type="checkbox" bind:checked={o.itemComments} />{t('Item comments')}</label>
      <label><input type="checkbox" bind:checked={o.bibliography} />{t('Bibliography')}</label>
      <label class="field"><span>{t('Placed items')}</span>
        <select class="select" bind:value={o.items}>
          <option value="all">{t('All')}</option>
          <option value="quotes">{t('Quotes & paraphrases only')}</option>
          <option value="none">{t('None')}</option>
        </select>
      </label>
      <label class="field"><span>{t('Citations')}</span>
        <select class="select" bind:value={o.citations}>
          <option value="inline">{t('Formatted (citation style)')}</option>
          <option value="footnotes">{t('Footnotes')}</option>
          <option value="short">{t('Short (Author Year, p.)')}</option>
        </select>
      </label>
      <h4>Markdown</h4>
      <label class="field"><span>{t('Quote style')}</span>
        <select class="select" bind:value={o.itemStyle}>
          <option value="callout">{t('Obsidian callouts')}</option>
          <option value="blockquote">{t('Plain blockquotes')}</option>
        </select>
      </label>
      <label><input type="checkbox" bind:checked={o.frontmatter} />{t('YAML front matter')}</label>

      <div class="actions">
        <button class="btn primary" onclick={() => md()}><Icon name="download" size={15} />Markdown (.md)</button>
        <button class="btn" onclick={() => md(true)}><Icon name="copy" size={15} />{t('Copy Markdown')}</button>
        <button class="btn" onclick={docx} disabled={busy}><Icon name="file" size={15} />Word (.docx)</button>
      </div>
      <h4>{t('Bibliography data')}</h4>
      <div class="seg">
        <button class:on={bibScope === 'project'} onclick={() => (bibScope = 'project')}>{t('Used in project')} ({nUsed})</button>
        <button class:on={bibScope === 'all'} onclick={() => (bibScope = 'all')}>{t('All sources')}</button>
      </div>
      <div class="actions">
        <button class="btn" onclick={() => bib('bibtex')}>BibTeX (.bib)</button>
        <button class="btn" onclick={() => bib('csljson')}>CSL-JSON</button>
      </div>
    </div>
    <pre class="pv scroll">{preview}</pre>
  </div>
</Modal>

<style>
  .ex {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 18px;
  }
  .opts {
    display: grid;
    align-content: start;
    gap: 8px;
    font-size: 0.875rem;
  }
  .opts > label:not(.field) {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  h4 {
    margin-top: 8px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .pv {
    margin: 0;
    max-height: 64vh;
    padding: 14px;
    border-radius: 10px;
    background: var(--surface-2);
    font: 0.78rem/1.55 var(--font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  @media (max-width: 760px) {
    .ex {
      grid-template-columns: 1fr;
    }
    .pv {
      max-height: 40vh;
    }
  }
</style>
