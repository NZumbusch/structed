<script lang="ts">
  // Import sources from a file or pasted text (BibTeX, RIS, CSL-JSON, DOIs). Zotero itself
  // comes in through the sync (Settings → Zotero); its highlights through "Go through
  // highlights" on a source in Collect.
  import Modal from './Modal.svelte';
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { parseBibliography } from '../lib/cite';
  import { authorsShort, yearOf } from '../lib/ops';
  import { findDuplicate } from '../lib/zotero';
  import { zoteroSyncActive } from '../lib/zoterosync.svelte';
  import type { CSLItem, Source } from '../lib/types';

  let err = $state('');
  let busy = $state('');
  let fileItems: { csl: CSLItem; include: boolean; dup?: Source }[] = $state([]);
  let pasted = $state('');

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    busy = label;
    err = '';
    try {
      return await fn();
    } catch (e) {
      err = String((e as Error).message ?? e);
    } finally {
      busy = '';
    }
  }
  async function parse(text: string) {
    const r = await run(t('Parsing…'), () => parseBibliography(text));
    if (!r) return;
    fileItems = r.map((csl) => {
      const dup = findDuplicate(csl);
      return { csl, include: !dup, dup };
    });
    if (!r.length) err = t('No entries found.');
  }
  async function onFile(f: File | undefined) {
    if (f) await parse(await f.text());
  }
  function importFile() {
    const chosen = fileItems.filter((x) => x.include);
    db.batch('file import', () => {
      for (const x of chosen) {
        const csl = $state.snapshot(x.csl) as CSLItem;
        if (x.dup) db.update('sources', x.dup.id, { csl: { ...csl, id: x.dup.csl.id || csl.id } });
        else db.create('sources', { csl, tags: [] });
      }
    });
    ui.toast(t('{n} sources imported', { n: chosen.length }), { kind: 'ok' });
    ui.dialog = null;
  }
  function toZotero() {
    ui.settingsTab = 'zotero';
    ui.dialog = 'settings';
  }
</script>

<Modal title={t('Import sources')} onclose={() => (ui.dialog = null)} width="760px">
  <div class="zinfo card small">
    <Icon name="book" size={16} />
    <span class="grow">
      {#if zoteroSyncActive()}{t('Zotero is synced automatically – new items show up as sources by themselves. Highlights: open a source in Collect → “Go through highlights”.')}
      {:else}{t('Using Zotero? Switch on the sync instead: your sources stay up to date by themselves, and you go through highlights per source.')}{/if}
    </span>
    <button class="btn sm" onclick={toZotero}>{t('Zotero settings')}</button>
  </div>
  {#if err}<p class="err small">{err}</p>{/if}
  {#if busy}<p class="small muted busy"><span class="spin"></span>{busy}</p>{/if}
    <div class="file">
      <p class="small">{t('In Zotero: select items → right-click → Export… → choose CSL JSON (best), Better BibTeX, BibTeX or RIS. Then drop the file here.')}</p>
      <label
        class="drop"
        ondragover={(e) => e.preventDefault()}
        ondrop={(e) => { e.preventDefault(); onFile(e.dataTransfer?.files?.[0]); }}
      >
        <Icon name="upload" size={22} />
        <span>{t('Drop .json / .bib / .ris here or click to choose')}</span>
        <input type="file" accept=".json,.bib,.bibtex,.ris,.txt" hidden onchange={(e) => onFile(e.currentTarget.files?.[0])} />
      </label>
      <details>
        <summary class="small">{t('…or paste BibTeX / RIS / CSL-JSON / DOIs')}</summary>
        <textarea class="textarea" rows="5" bind:value={pasted}></textarea>
        <button class="btn sm" onclick={() => parse(pasted)} disabled={!pasted.trim()}>{t('Parse')}</button>
      </details>
      {#if fileItems.length}
        <div class="ilist scroll">
          {#each fileItems as x, i (i)}
            <label class="it">
              <input type="checkbox" bind:checked={x.include} />
              <span class="grow">
                <span class="ellipsis it-t">{x.csl.title || '—'}</span>
                <span class="tiny muted">{authorsShort(x.csl)} {yearOf(x.csl)} · {x.csl.type}{x.dup ? ' · ' + t('exists – will update') : ''}</span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
    </div>

  {#snippet footer()}
    <span class="grow"></span>
    <button class="btn primary" disabled={!fileItems.some((x) => x.include)} onclick={importFile}>{t('Import {n} sources', { n: fileItems.filter((x) => x.include).length })}</button>
  {/snippet}
</Modal>

<style>
  .zinfo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }
  .err {
    color: var(--danger);
    margin: 0 0 8px;
  }
  .busy {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spin {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: sp 0.8s linear infinite;
  }
  @keyframes sp {
    to {
      transform: rotate(360deg);
    }
  }
  .ilist {
    flex: 1;
    min-height: 0;
    max-height: 52vh;
    display: grid;
    align-content: start;
    gap: 2px;
  }
  .it {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .it:hover {
    background: var(--surface-2);
  }
  .it .grow {
    display: grid;
  }
  .it-t {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .file {
    display: grid;
    gap: 12px;
  }
  .drop {
    display: grid;
    place-items: center;
    gap: 6px;
    padding: 28px;
    border: 2px dashed var(--border-strong);
    border-radius: 12px;
    color: var(--muted);
    cursor: pointer;
    text-align: center;
  }
  .drop:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  @media (max-width: 700px) {
  }
</style>
