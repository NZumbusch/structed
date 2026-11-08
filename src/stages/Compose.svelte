<script lang="ts">
  import { keepScroll } from '../lib/keepScroll';
  // "Schreiben": the final text, one editor per heading of the outline.
  import type { Editor } from '@tiptap/core';
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import Menu from '../components/Menu.svelte';
  import SectionEditor from '../components/SectionEditor.svelte';
  import FootnoteDialog from '../components/FootnoteDialog.svelte';
  import QuotePicker from '../components/QuotePicker.svelte';
  import CiteSuggest from '../components/CiteSuggest.svelte';
  import FindBar from '../components/FindBar.svelte';
  import { SharedHistory } from '../lib/sharedHistory';
  import { findIn } from '../lib/typing';
  import { wholeText } from '../lib/footnote';
  import { pickCrossRef } from '../lib/xref.svelte';
  import { copyText } from '../lib/clipboard';
  import Modal from '../components/Modal.svelte';
  import { ui } from '../lib/ui.svelte';
  import { settings } from '../lib/settings.svelte';
  import { t } from '../lib/i18n';
  import { flatten, wordCount } from '../lib/ops';
  import { charCount, draftText, insertArtifact as insertArtifactInto, makeEditable, selectedQuotePos, selectionText } from '../lib/editor.svelte';
  import { editorState, type InsertMode } from '../lib/editorState.svelte';
  import { matches, hint } from '../lib/shortcuts';
  import { renderMd } from '../lib/markdown';
  import type { Project } from '../lib/types';

  let { project }: { project: Project } = $props();
  const flat = $derived(flatten(project.id));
  const editors = new Map<string, Editor>();
  let tick = $state(0); // re-render toolbar state on selection changes

  const total = $derived(flat.reduce((n, f) => n + wordCount(draftText(f.h.draft)), 0));
  const chars = $derived(settings.wordCountUnit === 'chars' ? flat.reduce((n, f) => n + charCount(draftText(f.h.draft)), 0) : 0);
  /** the text selected in the active section, for "12 of 3,400 words" */
  const selected = $derived.by(() => {
    void tick;
    const e = activeEditor();
    return e && e.isFocused ? selectionText(e) : '';
  });
  const counter = $derived.by(() => {
    const byChars = settings.wordCountUnit === 'chars';
    const all = byChars ? chars : total;
    const unit = byChars ? t('characters') : t('words');
    if (!selected) return `${all.toLocaleString()} ${unit}`;
    const part = byChars ? charCount(selected) : wordCount(selected);
    return t('{part} of {all} {unit}', { part: part.toLocaleString(), all: all.toLocaleString(), unit });
  });
  function toggleUnit() {
    settings.wordCountUnit = settings.wordCountUnit === 'chars' ? 'words' : 'chars';
  }

  // ---- find & replace ----
  let finding = $state(false);
  let findReplace = $state(false);
  let findInitial = $state('');
  let findBar = $state<{ focus: () => void } | null>(null);
  function openFind(withReplace: boolean) {
    const e = activeEditor();
    const sel = e ? selectionText(e) : '';
    if (withReplace) findReplace = true;
    if (finding) {
      findBar?.focus();
      return;
    }
    findInitial = sel && !sel.includes('\n') && sel.length <= 80 ? sel : '';
    finding = true;
  }
  const orderedEditors = () => flat.map((f) => editors.get(f.h.id)).filter((e): e is Editor => !!e);
  const activeEditor = () => (editorState.active ? editors.get(editorState.active.headingId) : undefined);

  // one undo history for all sections (Ctrl+Z jumps to the section that changed last)
  const history = new SharedHistory(
    (id) => editors.get(id),
    (_id, e) => {
      if (!e.isFocused) e.commands.focus();
      e.commands.scrollIntoView();
    }
  );
  const undo = () => history.undo() || (cmd((e) => e.chain().focus().undo().run()), false);
  const redo = () => history.redo() || (cmd((e) => e.chain().focus().redo().run()), false);
  $effect(() => {
    editorState.history = history;
    return () => {
      if (editorState.history === history) editorState.history = null;
    };
  });

  async function copyAll() {
    const { html, text } = wholeText(project.id);
    const ok = await copyText(text, html);
    ui.toast(ok ? t('Whole text copied with citations and footnotes') : t('Could not copy'), { kind: ok ? 'ok' : 'error' }, 3000);
  }

  // a place in the text chosen in the search palette: select it there
  $effect(() => {
    const j = ui.writeJump;
    if (!j) return;
    let tries = 0;
    const go = () => {
      const e = editors.get(j.headingId);
      if (!e) return void (tries++ < 30 && setTimeout(go, 50));
      ui.writeJump = null;
      const ms = findIn(e.state.doc, j.text);
      const m = ms[Math.min(j.nth, ms.length - 1)];
      if (m) e.chain().focus().setTextSelection(m).scrollIntoView().run();
      else e.commands.focus('start');
      const sec = scroller?.querySelector<HTMLElement>(`[data-sec="${j.headingId}"]`);
      if (!m) sec?.scrollIntoView({ block: 'start' });
    };
    go();
  });

  // ---- the cursor stays where you stopped writing (per project and device) ----
  const caretKey = () => 'structed:caret:' + project.id;
  let caretTimer: ReturnType<typeof setTimeout> | null = null;
  function saveCaret(id: string, e: Editor) {
    if (caretTimer) clearTimeout(caretTimer);
    caretTimer = setTimeout(() => {
      try {
        localStorage.setItem(caretKey(), JSON.stringify({ id, pos: e.state.selection.head }));
      } catch {
        /* storage blocked */
      }
    }, 400);
  }
  let caretRestored = false;
  function restoreCaret(id: string, e: Editor) {
    if (caretRestored || ui.writeJump || matchMedia('(pointer: coarse)').matches) return; // phones: no keyboard popping up
    let saved: { id: string; pos: number } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(caretKey()) ?? 'null');
    } catch {
      /* ignore */
    }
    if (!saved || saved.id !== id) return;
    caretRestored = true;
    const pos = Math.min(saved.pos, e.state.doc.content.size);
    setTimeout(() => {
      if (!editorState.active && !document.activeElement?.closest('input, textarea, [contenteditable="true"]')) e.commands.focus(pos, { scrollIntoView: false });
    }, 0);
  }

  function reg(id: string, e: Editor) {
    editors.set(id, e);
    restoreCaret(id, e);
    e.on('selectionUpdate', () => {
      tick++;
      if (e.isFocused) saveCaret(id, e);
      typewriter(e);
    });
    e.on('transaction', ({ transaction }) => {
      history.track(id, e, transaction);
      tick++;
    });
    e.on('update', () => typewriter(e));
    e.on('focus', () => {
      if (navTarget === id) navTarget = null;
      history.entered(e);
    });
  }

  // ---- focus mode ----
  let scroller: HTMLDivElement;
  const focus = $derived(ui.focus);
  const showNotes = $derived(focus ? settings.focusNotes : settings.writeNotes);
  const quotesOpen = $derived(ui.narrow ? ui.panelMobileOpen : settings.focusQuotes);
  /** words when focus mode was entered: the session count starts there */
  let startWords = $state<number | null>(null);
  $effect(() => {
    if (focus && startWords == null) startWords = untrack(() => total);
    else if (!focus) startWords = null;
  });
  const sessionWords = $derived(startWords == null ? 0 : Math.max(0, total - startWords));
  /** hide the controls while typing, show them again on mouse movement */
  let typing = $state(false);
  let pointerDown = false;

  /** Typewriter scrolling: keep the line being written at the same height. */
  function typewriter(e: Editor) {
    if (!ui.focus || !settings.focusTypewriter || pointerDown || !e.isFocused || !scroller) return;
    requestAnimationFrame(() => {
      try {
        const c = e.view.coordsAtPos(e.state.selection.head);
        const r = scroller.getBoundingClientRect();
        const d = c.top - (r.top + r.height * 0.42);
        if (Math.abs(d) > 2) scroller.scrollTop += d;
      } catch {
        /* position not rendered */
      }
    });
  }
  $effect(() => {
    // re-center when typewriter mode is switched on
    if (focus && settings.focusTypewriter) untrack(() => { const e = activeEditor(); if (e) typewriter(e); });
  });

  let fullscreen = $state(!!document.fullscreenElement);
  const canFullscreen = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function toggleQuotes() {
    if (ui.narrow) ui.panelMobileOpen = !ui.panelMobileOpen;
    else settings.focusQuotes = !settings.focusQuotes;
  }
  function enterFocus() {
    ui.focus = true;
    // keep writing where the caret was
    setTimeout(() => activeEditor()?.commands.focus(), 0);
  }

  // writing sprint
  let now = $state(Date.now());
  $effect(() => {
    if (!ui.sprint) return;
    const iv = setInterval(() => {
      now = Date.now();
      if (ui.sprint && now >= ui.sprint.end) {
        const n = Math.max(0, untrack(() => total) - ui.sprint.words);
        ui.toast(t('Sprint finished: {n} words in {m} minutes', { n, m: ui.sprint.minutes }), { kind: 'ok' }, 8000);
        ui.sprint = null;
      }
    }, 1000);
    return () => clearInterval(iv);
  });
  function startSprint(minutes: number) {
    settings.focusSprint = minutes;
    now = Date.now();
    ui.sprint = { end: now + minutes * 60_000, words: total, minutes };
  }
  const left = $derived(ui.sprint ? Math.max(0, Math.ceil((ui.sprint.end - now) / 1000)) : 0);
  const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const sprintMenu = $derived([
    ...(ui.sprint
      ? [{ label: t('Stop sprint'), icon: 'x', run: () => (ui.sprint = null) }, null]
      : []),
    ...[10, 15, 25, 45, 60].map((m) => ({ label: t('{m} minute sprint', { m }), icon: m === settings.focusSprint ? 'check' : 'timer', run: () => startSprint(m) }))
  ]);
  const GOALS = [0, 250, 500, 750, 1000, 1500, 2000];
  const goalMenu = $derived(
    GOALS.map((g) => ({
      label: g ? t('{n} words this session', { n: g.toLocaleString() }) : t('No goal'),
      icon: g === settings.focusGoal ? 'check' : 'target',
      run: () => (settings.focusGoal = g)
    }))
  );
  const quoteSelected = () => {
    void tick;
    const e = activeEditor();
    return !!e && selectedQuotePos(e) != null;
  };
  const is = (name: string) => {
    void tick; // re-evaluate when the selection changes
    return activeEditor()?.isActive(name) ?? false;
  };
  const cmd = (fn: (e: Editor) => void) => {
    const e = activeEditor();
    if (e) fn(e);
  };

  function footnote() {
    cmd((e) => {
      e.chain().focus().insertContent({ type: 'footnote', attrs: { content: [] } }).run();
      // open the dialog for the new footnote
      setTimeout(() => {
        const marks = e.view.dom.querySelectorAll<HTMLElement>('sup.fn');
        const sel = e.state.selection.from;
        let best: HTMLElement | null = null;
        let dist = Infinity;
        marks.forEach((m) => {
          const pos = e.view.posAtDOM(m, 0);
          if (Math.abs(pos - sel) < dist) {
            dist = Math.abs(pos - sel);
            best = m;
          }
        });
        (best as HTMLElement | null)?.click();
      }, 30);
    });
  }

  let goalOpen = $state(false);
  let sprintOpen = $state(false);
  /** open a toolbar menu from the keyboard and focus its first item */
  function openMenu(set: (v: boolean) => void) {
    typing = false;
    set(true);
    setTimeout(() => document.querySelector<HTMLElement>('.menu [role="menuitem"]')?.focus(), 30);
  }
  const onOff = (label: string, on: boolean) => ui.toast(`${t(label)}: ${on ? t('on') : t('off')}`, {}, 1500);

  /** Jump to the start of the next / previous section (like moving between cells). */
  /** section we are jumping to; the editor gets focus only on the next frame */
  let navTarget: string | null = null;
  function gotoSection(dir: 1 | -1) {
    const ids = flat.map((f) => f.h.id);
    if (!ids.length) return;
    const from = navTarget ?? editorState.active?.headingId;
    const cur = from ? ids.indexOf(from) : -1;
    const i = cur < 0 ? (dir > 0 ? 0 : ids.length - 1) : cur + dir;
    if (i < 0 || i >= ids.length) return;
    const e = editors.get(ids[i]);
    if (!e) return;
    navTarget = ids[i];
    e.chain().focus('start').run();
    if (!(focus && settings.focusTypewriter)) {
      const sec = scroller?.querySelector<HTMLElement>(`[data-sec="${ids[i]}"]`);
      sec?.scrollIntoView({ block: focus ? 'center' : 'start', behavior: settings.reduceMotion ? 'auto' : 'smooth' });
    }
  }

  const KEYS: Record<string, () => void> = {
    'write.nextSection': () => gotoSection(1),
    'write.prevSection': () => gotoSection(-1),
    'write.notes': () => (focus ? (settings.focusNotes = !settings.focusNotes) : (settings.writeNotes = !settings.writeNotes)),
    'write.dim': () => onOff('Highlight current paragraph', (settings.focusDim = !settings.focusDim)),
    'write.typewriter': () => onOff('Typewriter scrolling', (settings.focusTypewriter = !settings.focusTypewriter)),
    'write.fullscreen': () => canFullscreen && toggleFullscreen(),
    'write.goal': () => (focus ? openMenu((v) => (goalOpen = v)) : ui.toast(t('Session goals are part of focus mode'), {}, 2500)),
    'write.sprint': () => {
      if (ui.sprint) {
        ui.sprint = null;
        ui.toast(t('Sprint stopped'), {}, 1500);
      } else {
        startSprint(settings.focusSprint);
        ui.toast(t('{m} minute sprint', { m: settings.focusSprint }), {}, 1500);
      }
    },
    'write.footnote': () => footnote(),
    'write.insertQuote': () => (picking = true),
    'write.insertMode': () => {
      const i = MODES.findIndex((m) => m.id === settings.insertMode);
      const m = MODES[(i + 1) % MODES.length];
      settings.insertMode = m.id;
      ui.toast(`${t('Insert quotes as')}: ${t(m.label)}`, {}, 1800);
    },
    'write.editQuote': () => cmd((e) => { const p = selectedQuotePos(e); if (p != null) makeEditable(e, p); }),
    'write.bulletList': () => cmd((e) => e.chain().focus().toggleBulletList().run()),
    'write.orderedList': () => cmd((e) => e.chain().focus().toggleOrderedList().run()),
    'write.find': () => openFind(false),
    'write.replace': () => openFind(true),
    'write.countUnit': () => toggleUnit(),
    'write.copyAll': () => copyAll(),
    'write.blockquote': () => cmd((e) => e.chain().focus().toggleBlockquote().run()),
    'write.export': () => (ui.wordExport = true)
  };

  function keys(e: KeyboardEvent) {
    if (focus && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace')) typing = true;
    // the editor already handled it, or a dialog is open
    if (e.defaultPrevented || ui.recordingShortcut || ui.dialog || ui.editArtifact || ui.editSource || ui.placeTarget || editorState.footnote || ui.wordExport) return;
    for (const id in KEYS) {
      if (!matches(e, id)) continue;
      e.preventDefault();
      KEYS[id]();
      return;
    }
  }

  const MODES: { id: InsertMode; label: string; icon: string }[] = [
    { id: 'inline', label: 'In the sentence', icon: 'quote' },
    { id: 'editable', label: 'As editable text', icon: 'edit' },
    { id: 'block', label: 'Block quote', icon: 'paraphrase' },
    { id: 'footnote', label: 'In a footnote', icon: 'note' },
    { id: 'cite', label: 'Citation only', icon: 'book' }
  ];

  const moreMenu = $derived([
    ...MODES.map((m) => ({ label: `${t('Insert quotes as')}: ${t(m.label)}`, icon: settings.insertMode === m.id ? 'check' : m.icon, run: () => (settings.insertMode = m.id) })),
    null,
    { label: t('Undo'), icon: 'undo', run: undo },
    { label: t('Redo'), icon: 'redo', run: redo }
  ]);

  // insert a quote: search, filter and sort among all quotes (remembered between uses)
  let picking = $state(false);
  function pickQuote(id: string, keep = false) {
    picking = keep;
    // the section that had the cursor; if none yet, the first section
    const target = editorState.active ?? null;
    if (target) target.insertArtifact(id, settings.insertMode);
    else {
      const first = flat[0] && editors.get(flat[0].h.id);
      if (first) insertArtifactInto(first, id, settings.insertMode);
    }
  }
</script>

<svelte:window
  onkeydown={keys}
  onpointermove={(e) => e.pointerType === 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) && (typing = false)}
  onpointerdown={() => ((pointerDown = true), (typing = false))}
  onpointerup={() => (pointerDown = false)}
/>
<svelte:document onfullscreenchange={() => (fullscreen = !!document.fullscreenElement)} />

<div
  class="compose scroll"
  class:focus
  class:dim={focus && settings.focusDim}
  class:tw={focus && settings.focusTypewriter}
  data-tour="compose"
  bind:this={scroller}
  use:keepScroll={'write:' + project.id}
>
  {#if focus}
    <div class="fbar" class:idle={typing} role="toolbar" aria-label={t('Focus mode')}>
      <button class="icon-btn" title="{t('Exit focus mode')} (Esc)" aria-label={t('Exit focus mode')} onclick={() => (ui.focus = false)}><Icon name="x" size={16} /></button>
      <span class="sep"></span>
      <button class="icon-btn" class:active={settings.focusNotes} aria-pressed={settings.focusNotes} title="{settings.focusNotes ? t('Hide notes') : t('Show notes')}{hint('write.notes')}" aria-label={t('Notes')} onclick={() => (settings.focusNotes = !settings.focusNotes)}><Icon name="note" size={16} /></button>
      {#if settings.writePanel}<button class="icon-btn" class:active={quotesOpen} aria-pressed={quotesOpen} title="{quotesOpen ? t('Hide quotes') : t('Show quotes')}{hint('togglePanel')}" aria-label={t('Quotes')} onclick={toggleQuotes}><Icon name="quote" size={16} /></button>{/if}
      <span class="sep"></span>
      <button class="icon-btn" class:active={settings.focusDim} aria-pressed={settings.focusDim} title="{t('Dim all but the current paragraph')}{hint('write.dim')}" aria-label={t('Highlight current paragraph')} onclick={() => (settings.focusDim = !settings.focusDim)}><Icon name="eye" size={16} /></button>
      <button class="icon-btn" class:active={settings.focusTypewriter} aria-pressed={settings.focusTypewriter} title="{t('Typewriter scrolling: the current line stays in the middle')}{hint('write.typewriter')}" aria-label={t('Typewriter scrolling')} onclick={() => (settings.focusTypewriter = !settings.focusTypewriter)}><Icon name="typewriter" size={16} /></button>
      {#if canFullscreen}
        <button class="icon-btn" class:active={fullscreen} aria-pressed={fullscreen} title="{t('Full screen')}{hint('write.fullscreen')}" aria-label={t('Full screen')} onclick={toggleFullscreen}><Icon name="expand" size={16} /></button>
      {/if}
      <span class="sep"></span>
      <Menu items={goalMenu} label="{t('Session goal')}{hint('write.goal')}" bind:open={goalOpen}>
        {#snippet trigger()}<Icon name="target" size={14} /><span class="hide-xs">{settings.focusGoal ? settings.focusGoal.toLocaleString() : t('Goal')}</span>{/snippet}
      </Menu>
      <Menu items={sprintMenu} label="{t('Writing sprint')}{hint('write.sprint')}" bind:open={sprintOpen}>
        {#snippet trigger()}<Icon name="timer" size={14} /><span class:run={ui.sprint}>{ui.sprint ? clock(left) : t('Sprint')}</span>{/snippet}
      </Menu>
    </div>
  {:else}
  <div class="bar" role="toolbar" aria-label={t('Formatting')}>
    <button class="icon-btn fmt" class:active={is('bold')} title="{t('Bold')} (Ctrl+B)" aria-label={t('Bold')} onclick={() => cmd((e) => e.chain().focus().toggleBold().run())}><b>B</b></button>
    <button class="icon-btn fmt" class:active={is('italic')} title="{t('Italic')} (Ctrl+I)" aria-label={t('Italic')} onclick={() => cmd((e) => e.chain().focus().toggleItalic().run())}><i>I</i></button>
    <button class="icon-btn fmt" class:active={is('underline')} title="{t('Underline')} (Ctrl+U)" aria-label={t('Underline')} onclick={() => cmd((e) => e.chain().focus().toggleUnderline().run())}><u>U</u></button>
    <span class="sep"></span>
    <button class="icon-btn" class:active={is('bulletList')} title="{t('Bullet list')}{hint('write.bulletList')}" aria-label={t('Bullet list')} onclick={() => cmd((e) => e.chain().focus().toggleBulletList().run())}><Icon name="menu" size={16} /></button>
    <button class="icon-btn" class:active={is('orderedList')} title="{t('Numbered list')}{hint('write.orderedList')}" aria-label={t('Numbered list')} onclick={() => cmd((e) => e.chain().focus().toggleOrderedList().run())}><Icon name="list-ordered" size={16} /></button>
    <button class="icon-btn" class:active={is('blockquote')} title="{t('Block quote (own text)')}{hint('write.blockquote')}" aria-label={t('Block quote (own text)')} onclick={() => cmd((e) => e.chain().focus().toggleBlockquote().run())}><Icon name="quote" size={16} /></button>
    <button class="btn sm" title="{t('Footnote')}{hint('write.footnote')}" onclick={footnote}><sup>1</sup><span class="wide-only"> {t('Footnote')}</span></button>
    <button class="icon-btn fmt" title="{t('Cross-reference to a section')}{hint('write.crossRef')}" aria-label={t('Cross-reference to a section')} onclick={() => cmd((e) => pickCrossRef(e))}>§</button>
    {#if quoteSelected()}
      <!-- icon only: appearing must not make the toolbar longer than its row -->
      <button class="icon-btn" title="{t('Edit quote text')}: {t('Turn the selected quote into editable text to shorten or adapt it; the citation stays linked')}{hint('write.editQuote')}" aria-label={t('Edit quote text')} onclick={() => cmd((e) => { const p = selectedQuotePos(e); if (p != null) makeEditable(e, p); })}>
        <Icon name="edit" size={16} />
      </button>
    {/if}
    <span class="sep"></span>
    <button class="btn ghost sm" title="{t('Insert a quote')}{hint('write.insertQuote')}" onclick={() => (picking = true)}><Icon name="plus" size={14} />{t('Insert quote')}</button>
    {#if !ui.narrow}
      <select class="select mode" bind:value={settings.insertMode} aria-label={t('Insert quotes as')} title="{t('Insert quotes as')}{hint('write.insertMode')}">
        {#each MODES as m (m.id)}<option value={m.id}>{t(m.label)}</option>{/each}
      </select>
    {/if}
    <span class="grow"></span>
    <button class="tiny muted wc" title="{t('Count words or characters (with spaces)')}{hint('write.countUnit')}" onclick={toggleUnit}>{counter}</button>
    <button class="icon-btn" class:active={settings.writeNotes} aria-pressed={settings.writeNotes} title="{settings.writeNotes ? t('Hide notes') : t('Show notes')}{hint('write.notes')}" aria-label={t('Notes')} onclick={() => (settings.writeNotes = !settings.writeNotes)}><Icon name="note" size={16} /></button>
    {#if !ui.narrow}
      <button class="icon-btn" title="{t('Undo')} (Ctrl+Z)" aria-label={t('Undo')} onclick={undo}><Icon name="undo" size={16} /></button>
      <button class="icon-btn" title="{t('Redo')} (Ctrl+Shift+Z)" aria-label={t('Redo')} onclick={redo}><Icon name="redo" size={16} /></button>
    {/if}
    <button class="icon-btn" title="{t('Focus mode')}{hint('write.focus')}" aria-label={t('Focus mode')} onclick={enterFocus}><Icon name="focus" size={16} /></button>
    <button class="btn sm primary" title="{t('Word export')}{hint('write.export')}" onclick={() => (ui.wordExport = true)}><Icon name="file" size={14} /><span class="wide-only">{t('Word export')}</span></button>
    {#if ui.narrow}
      <!-- phones: the rarely used controls live in one menu, so the toolbar stays one row -->
      <Menu items={moreMenu} label={t('More')} />
    {/if}
  </div>
  {/if}

  {#if finding}
    <FindBar bind:this={findBar} editors={orderedEditors} {tick} bind:replace={findReplace} initial={findInitial} onclose={() => ((finding = false), (findReplace = false))} />
  {/if}

  <article class="paper">
    <h1 class="dtitle">{project.title || t('Untitled project')}</h1>
    {#if project.subtitle}<p class="dsub">{project.subtitle}</p>{/if}
    {#each flat as f (f.h.id)}
      <section class="sec d{Math.min(f.depth, 2)}" data-sec={f.h.id}>
        <svelte:element this={`h${Math.min(f.depth + 2, 4)}`} class="ht">
          <span class="hn">{f.num}</span>{f.h.title || t('Untitled')}
        </svelte:element>
        {#if showNotes && f.h.body.trim()}
          <!-- the gist from the outline, as a reminder of what this section should say -->
          <div class="gist md small muted">{@html renderMd(f.h.body)}</div>
        {/if}
        <SectionEditor h={f.h} onEditor={reg} />
      </section>
    {:else}
      <div class="empty">{t('Add headings in the Outline first – each heading becomes a section here.')}</div>
    {/each}
  </article>
</div>

{#if focus}
  <div class="fstat tiny" class:idle={typing} aria-live="off">
    {#if settings.focusGoal}
      <span class="goal" title={t('Session goal')}><span style="width:{Math.min(100, (sessionWords / settings.focusGoal) * 100)}%"></span></span>
      <span class:done={sessionWords >= settings.focusGoal}>{sessionWords.toLocaleString()} / {settings.focusGoal.toLocaleString()}</span>
    {:else}
      <span>+{sessionWords.toLocaleString()}</span>
    {/if}
    <span class="muted">· {counter}</span>
  </div>
{/if}

{#if editorState.footnote}<FootnoteDialog />{/if}
<CiteSuggest />
{#if picking}
  <Modal title={t('Insert quote')} onclose={() => (picking = false)} width="980px">

    <QuotePicker headingId={editorState.active?.headingId ?? null} onpick={pickQuote} showMode />
  </Modal>
{/if}

<style>
  .compose {
    height: 100%;
    counter-reset: fn;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 3;
    display: flex;
    /* one row: a button that appears (selected quote, selection count) never pushes the text down */
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    align-items: center;
    gap: 4px;
    padding: 6px 16px;
    background: color-mix(in srgb, var(--bg) 94%, transparent);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--border);
  }
  .bar > :global(*:not(.mode, .grow)) {
    flex: none;
  }
  .fmt {
    font-family: var(--font-serif);
    font-size: 1rem;
  }
  .sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--border);
  }
  .mode {
    width: auto;
    min-width: 0;
    flex: 0 1 auto;
    min-height: 28px;
    height: 28px;
    padding: 0 6px;
    font-size: 0.8rem;
  }
  .wc {
    margin-right: 6px;
    padding: 2px 4px;
    border: 0;
    border-radius: 6px;
    background: none;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
  }
  .wc:hover {
    color: var(--text);
  }
  .compose :global(.find-hit) {
    border-radius: 2px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .compose :global(.find-cur) {
    background: color-mix(in srgb, var(--accent) 55%, transparent);
    outline: 1px solid var(--accent);
  }
  /* non-breaking space: a faint dot underneath, so it can be told from a normal space */
  .compose :global(.nbsp) {
    background: radial-gradient(circle at 50% 85%, var(--faint) 0 1px, transparent 1.5px);
  }
  .paper {
    max-width: var(--measure);
    margin: 0 auto;
    padding: 28px 24px 200px;
  }
  .dtitle {
    font-size: 1.9em;
    letter-spacing: -0.02em;
  }
  .dsub {
    margin: 4px 0 0;
    color: var(--muted);
  }
  .sec {
    margin-top: 26px;
    scroll-margin-top: 56px; /* below the sticky toolbar */
  }
  .ht {
    margin: 0 0 6px;
  }
  :global(.compose h2.ht) {
    font-size: 1.35em;
  }
  :global(.compose h3.ht) {
    font-size: 1.12em;
  }
  :global(.compose h4.ht) {
    font-size: 1em;
  }
  .hn {
    margin-right: 10px;
    color: var(--faint);
    font-weight: 500;
  }
  .gist {
    margin: 0 0 8px;
    padding: 2px 0 2px 10px;
    border-left: 2px solid var(--deco);
    font-style: italic;
  }
  .gist :global(p) {
    margin: 0 0 0.3em;
  }
  .gist :global(:last-child) {
    margin-bottom: 0;
  }

  /* ---- focus mode ---- */
  .compose.focus .paper {
    padding-top: 64px;
  }
  .compose.tw .paper {
    padding-top: 40vh;
    padding-bottom: 60vh;
  }
  .fbar {
    position: sticky;
    top: 10px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 2px;
    width: max-content;
    max-width: calc(100% - 20px);
    margin: 10px auto -46px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow);
    transition: opacity 0.4s var(--ease);
  }
  .fbar.idle,
  .fstat.idle {
    opacity: 0;
    pointer-events: none;
  }
  .fbar:focus-within {
    opacity: 1;
    pointer-events: auto;
  }
  .run {
    font-variant-numeric: tabular-nums;
    color: var(--accent-text);
    font-weight: 600;
  }
  .fstat {
    position: fixed;
    right: 16px;
    bottom: calc(12px + env(safe-area-inset-bottom));
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    transition: opacity 0.4s var(--ease);
  }
  .fstat .done {
    color: var(--ok);
    font-weight: 600;
  }
  .goal {
    width: 60px;
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .goal span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  /* dim everything but the paragraph being written */
  .compose.dim:has(:global(.ProseMirror-focused)) :is(.dtitle, .dsub, .ht, .gist, .empty),
  .compose.dim:has(:global(.ProseMirror-focused)) :global(.prose > *) {
    opacity: 0.3;
    transition: opacity 0.25s var(--ease);
  }
  .compose.dim :global(.prose.ProseMirror-focused > .focus-cur) {
    opacity: 1;
  }
  .empty {
    padding: 40px 0;
    color: var(--muted);
  }
  /* editor typography */
  .compose :global(.prose) {
    outline: none;
    font-family: var(--font-text);
    line-height: 1.7;
    text-align: justify;
    /* no automatic hyphenation: together with the editor's pre-wrap white space,
       Chrome then wraps the space between two words to the start of the next line.
       Soft hyphens (Ctrl+-) still work; Word hyphenates the exported text itself. */
    hyphens: manual;
    overflow-wrap: break-word;
    min-height: 2em;
  }
  .compose :global(.prose p) {
    margin: 0 0 0.7em;
  }
  .compose :global(.prose p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--faint);
    pointer-events: none;
    font-style: italic;
  }
  .compose :global(.prose blockquote),
  .compose :global(.qblock) {
    margin: 0.8em 2.2em;
    font-style: italic;
    text-align: left;
  }
  .compose :global(.qblock) {
    padding: 2px 4px;
    border-radius: 6px;
    cursor: grab;
  }
  .compose :global(.qb-text) {
    margin: 0;
  }
  .compose :global(.qb-cite) {
    margin: 2px 0 0;
    text-align: center;
    font-style: normal;
    color: var(--muted);
  }
  .compose :global(.qref) {
    border-radius: 4px;
    background: color-mix(in srgb, var(--k-quote) 10%, transparent);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    cursor: pointer;
  }
  .compose :global(.qref.cite-only) {
    background: color-mix(in srgb, var(--k-paraphrase) 12%, transparent);
  }
  .compose :global(.qref[data-kind='missing']) {
    background: color-mix(in srgb, var(--danger) 15%, transparent);
  }
  .compose :global(.ProseMirror-selectednode) {
    outline: 2px solid var(--accent);
  }
  .compose :global(sup.fn) {
    cursor: pointer;
    color: var(--accent-text);
    font-weight: 600;
    padding: 0 1px;
  }
  .compose :global(sup.fn::after) {
    counter-increment: fn;
    content: counter(fn);
  }
  .compose :global(.prose ul),
  .compose :global(.prose ol) {
    padding-left: 1.4em;
  }
  @media (max-width: 700px) {
    .paper {
      padding: 16px 14px 160px;
    }
    .compose :global(.prose) {
      text-align: left;
    }
    /* one row that scrolls sideways instead of three wrapped rows */
    .bar {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      padding: 6px 8px;
    }
    .wc,
    .hide-xs {
      display: none;
    }
    /* button text stays for screen readers, the icon alone is shown */
    .wide-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .fstat {
      right: 8px;
    }
  }
</style>
