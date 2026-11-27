<script lang="ts">
  import Icon from './Icon.svelte';
  import { db } from '../lib/db.svelte';
  import { ui, type Stage } from '../lib/ui.svelte';
  import { t } from '../lib/i18n';
  import { artifactLabel, authorsFull, flatten, sourceLabel } from '../lib/ops';
  import { draftText } from '../lib/draft';
  import { wholeText } from '../lib/footnote';
  import { copyText } from '../lib/clipboard';
  import { allCommands, markUsed, recentCommands, type Command } from '../lib/commands.svelte';
  import { comboFor, displayCombo } from '../lib/shortcuts';

  /** the text is searched from this many characters on, and shows at most this many places */
  const TEXT_MIN = 3;
  const TEXT_MAX = 8;

  /** commands of the palette that only make sense without Write open (Write has its own) */
  function printText() {
    ui.stage = 'write';
    ui.focus = false;
    // wait until the sections are rendered
    const go = (n = 0) => (document.querySelector('.compose .ProseMirror') || n > 40 ? setTimeout(() => window.print(), 150) : setTimeout(() => go(n + 1), 50));
    go();
  }
  async function copyAll() {
    if (!ui.projectId) return;
    const { html, text } = wholeText(ui.projectId);
    const ok = await copyText(text, html);
    ui.toast(ok ? t('Whole text copied with citations and footnotes') : t('Could not copy'), { kind: ok ? 'ok' : 'error' }, 3000);
  }
  const fallback: Command[] = [
    { id: 'write.copyAll', label: 'Copy whole text with citations', group: 'Project', icon: 'copy', when: () => !!ui.projectId, run: copyAll },
    { id: 'write.print', label: 'Print or save as PDF', group: 'Project', icon: 'file', keywords: 'pdf drucken', when: () => !!ui.projectId, run: printText }
  ];

  interface Hit {
    icon: string;
    label: string;
    sub?: string;
    score: number;
    run: () => unknown;
    /** a command: its id, keys and on/off state */
    cmd?: string;
    kbd?: string;
    state?: 'on' | 'off' | 'current';
    /** a heading above this hit ("Recently used") */
    head?: string;
  }
  let q = $state(ui.paletteQuery);
  /** ">" at the start: commands only (as in VS Code) */
  const cmdMode = $derived(q.trimStart().startsWith('>'));
  let hi = $state(0);
  let input: HTMLInputElement;
  let rows: HTMLElement[] = $state([]);
  // keep the marked row in view while moving with the arrow keys
  $effect(() => rows[hi]?.scrollIntoView({ block: 'nearest' }));
  $effect(() => input?.focus());

  /** lower case, without accents, ß = ss: "fussn" finds "Fußnote" */
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');

  function score(hay: string, qq: string): number {
    const h = fold(hay);
    qq = fold(qq);
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
    const qq = q.trim().replace(/^>\s*/, '').toLowerCase();
    const out: Hit[] = [];
    // commands: every action, setting and tool (Write adds its own while open)
    const recent = recentCommands();
    const byId = new Map<string, Command>();
    for (const c of [...fallback, ...allCommands()]) if (!c.when || c.when()) byId.set(c.id, c);
    const cmdHit = (c: Command, sc: number): Hit => {
      const st = c.state?.();
      const combo = comboFor(c.id);
      return {
        icon: c.icon ?? 'settings',
        label: t(c.label),
        sub: t(c.group),
        score: sc,
        run: c.run,
        cmd: c.id,
        kbd: combo ? displayCombo(combo) : undefined,
        state: c.choice ? (st ? 'current' : undefined) : st === undefined ? undefined : st ? 'on' : 'off'
      };
    };
    if (!qq) {
      // nothing typed: the commands used last, then (in command mode) all of them
      const used = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c).slice(0, cmdMode ? 12 : 5);
      used.forEach((c, i) => out.push({ ...cmdHit(c, 100 - i), head: i === 0 ? t('Recently used') : undefined }));
      if (cmdMode) {
        // grouped: the open stage's commands first, settings last
        const order = [ui.stage === 'write' ? 'Write' : ui.stage === 'outline' ? 'Outline' : '', 'Go to', 'Create', 'General', 'Project', 'Write', 'Outline', 'Tools', 'Settings'];
        const rank = (c: Command) => {
          const i = order.indexOf(c.group);
          return i < 0 ? order.length - 1.5 : i;
        };
        const rest = [...byId.values()].filter((c) => !used.includes(c)).sort((a, b) => rank(a) - rank(b));
        rest.forEach((c, i) => out.push({ ...cmdHit(c, 50 - i / 1000), head: i === 0 ? t('All commands') : undefined }));
        return out;
      }
    } else {
      for (const c of byId.values()) {
        const sc = score(`${t(c.label)} ${c.label} ${t(c.group)} ${c.keywords ?? ''}`, qq);
        if (!sc) continue;
        const inLabel = score(t(c.label), qq) || score(c.label, qq);
        const r = recent.indexOf(c.id);
        // actions before settings; the commands of the open stage first
        const here = c.group === 'Write' ? ui.stage === 'write' : c.group === 'Outline' ? ui.stage === 'outline' : false;
        out.push(cmdHit(c, sc + (inLabel ? 1 : 0) + (r >= 0 ? 1 - r / 12 : 0) + (here ? 0.5 : 0) - (c.group === 'Settings' ? 0.6 : 0) - 0.5));
      }
      if (cmdMode) return out.sort((a, b) => b.score - a.score).slice(0, 80);
    }
    if (ui.projectId) {
      // places in the written text (phrase match)
      if (qq.length >= TEXT_MIN) {
        let n = 0;
        for (const f of flatten(ui.projectId)) {
          if (n >= TEXT_MAX) break;
          const text = draftText(f.h.draft).replace(/\s*\n\s*/g, ' ');
          const low = text.toLowerCase();
          for (let i = low.indexOf(qq), nth = 0; i >= 0 && nth < 3 && n < TEXT_MAX; i = low.indexOf(qq, i + qq.length), nth++, n++) {
            const a = Math.max(0, i - 40);
            const snippet = (a ? '…' : '') + text.slice(a, i + qq.length + 50).trim() + (i + qq.length + 50 < text.length ? '…' : '');
            const at = nth;
            out.push({
              icon: 'edit',
              label: snippet,
              sub: `${t('Text')} · ${f.num} ${f.h.title || t('Untitled')}`,
              score: 2.5,
              run: () => {
                ui.stage = 'write';
                ui.writeJump = { headingId: f.h.id, text: q.trim(), nth: at };
              }
            });
          }
        }
      }
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
    ui.paletteQuery = '';
    if (h.cmd) markUsed(h.cmd);
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
      {#if cmdMode}<span class="mode">{t('Commands')}</span>{/if}
      <input
        bind:this={input}
        bind:value={q}
        oninput={() => (hi = 0)}
        onkeydown={key}
        placeholder={t('Search headings, quotes, sources – or type > for commands…')}
        aria-label={t('Search and commands')}
        role="combobox"
        aria-expanded="true"
        aria-controls="pal-list"
        aria-activedescendant={hits.length ? 'pal-' + hi : undefined}
      />
      <span class="kbd">Esc</span>
    </div>
    <div class="res scroll" id="pal-list" role="listbox" aria-label={t('Results')}>
      {#each hits as h, i (i)}
        {#if h.head}<div class="head tiny muted" role="presentation">{h.head}</div>{/if}
        <button class="hit" class:on={i === hi} id={'pal-' + i} role="option" aria-selected={i === hi} tabindex="-1" onpointerenter={() => (hi = i)} onclick={() => go(h)} bind:this={rows[i]}>
          <Icon name={h.icon} size={15} />
          <span class="grow ellipsis">{h.label}{#if h.sub}<span class="muted small sub">— {h.sub}</span>{/if}</span>
          {#if h.state === 'current'}<span class="st cur"><Icon name="check" size={13} /></span>
          {:else if h.state}<span class="st" class:onst={h.state === 'on'}>{t(h.state)}</span>{/if}
          {#if h.kbd}<span class="kbd">{h.kbd}</span>{/if}
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
  .sub {
    margin-left: 0.4em;
  }
  .head {
    padding: 8px 10px 2px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .mode {
    font-size: 0.78rem;
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--accent-soft);
    color: var(--accent-text);
    white-space: nowrap;
  }
  .st {
    font-size: 0.75rem;
    padding: 1px 7px;
    border-radius: 99px;
    border: 1px solid var(--border);
    color: var(--muted);
    white-space: nowrap;
  }
  .st.onst {
    color: var(--accent-text);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .st.cur {
    border: 0;
    color: var(--accent-text);
    display: inline-flex;
  }
  .hit .kbd {
    flex: none;
  }
</style>
