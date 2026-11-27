// Every action of the app as a command for the palette (Ctrl+K, or Ctrl+Shift+P for commands
// only). Parts of the app add their commands while they are on screen (Write adds its own);
// settings are commands too ("Quotation marks: ‹…›", "Spell check" on/off).
import { settings } from './settings.svelte';
import { ui } from './ui.svelte';
import { t } from './i18n';
import { db } from './db.svelte';
import { STYLES } from './cite';
import { addHeading } from './ops';

export interface Command {
  /** unique; for an action with a keyboard shortcut, the shortcut's id (shows its keys) */
  id: string;
  /** English UI string (translated when shown) */
  label: string;
  /** English UI string: "Write", "Settings", "Go to"… */
  group: string;
  icon?: string;
  /** more words to find it by (any language) */
  keywords?: string;
  /** on/off for a switch, true for the current choice of a setting */
  state?: () => boolean | undefined;
  /** shown only when true */
  when?: () => boolean;
  /** one of several values of a setting (state = it is the current one) */
  choice?: boolean;
  run: () => unknown;
}

const providers = new Map<string, () => Command[]>();

/** Add commands while a part of the app is on screen; returns the function that removes them. */
export function provideCommands(owner: string, fn: () => Command[]) {
  providers.set(owner, fn);
  return () => {
    if (providers.get(owner) === fn) providers.delete(owner);
  };
}

/** All commands that apply now; a later provider replaces a command with the same id. */
export function allCommands(): Command[] {
  const byId = new Map<string, Command>();
  for (const fn of [() => builtin(), ...providers.values()]) for (const c of fn()) byId.set(c.id, c);
  return [...byId.values()].filter((c) => !c.when || c.when());
}

// ---------------- recently used ----------------
const RECENT_KEY = 'structed.recentCommands';
export function recentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function markUsed(id: string) {
  const next = [id, ...recentCommands().filter((x) => x !== id)].slice(0, 12);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

// ---------------- settings as commands ----------------
const hasProject = () => !!ui.projectId;
const say = (label: string, on: boolean) => ui.toast(`${t(label)}: ${on ? t('on') : t('off')}`, {}, 1600);

/** An on/off setting. */
function toggle(key: keyof typeof settings, label: string, keywords = ''): Command {
  return {
    id: 'set.' + String(key),
    label,
    group: 'Settings',
    icon: 'settings',
    keywords: 'setting einstellung on off an aus ' + keywords,
    state: () => !!settings[key],
    run: () => {
      const v = !settings[key];
      (settings as unknown as Record<string, unknown>)[key] = v;
      say(label, v);
    }
  };
}

/** One choice of a setting with several values ("Quotation marks: „…“"). */
function choice<K extends keyof typeof settings>(key: K, label: string, options: [(typeof settings)[K], string][], keywords = ''): Command[] {
  return options.map(([v, name]) => ({
    id: `set.${String(key)}.${String(v)}`,
    label: `${t(label)}: ${t(name)}`,
    group: 'Settings',
    icon: 'settings',
    keywords: 'setting einstellung ' + label + ' ' + keywords,
    choice: true,
    state: () => settings[key] === v,
    run: () => {
      settings[key] = v;
      ui.toast(`${t(label)}: ${t(name)}`, {}, 1600);
    }
  }));
}

const TABS: [string, string][] = [
  ['appearance', 'Appearance'],
  ['writing', 'Citations'],
  ['editor', 'Editor & export'],
  ['shortcuts', 'Keyboard shortcuts'],
  ['zotero', 'Zotero'],
  ['sync', 'Sync'],
  ['data', 'Backup & data'],
  ['about', 'About & help']
];

function builtin(): Command[] {
  return [
    // settings sections
    ...TABS.map(([id, name]) => ({
      id: 'settingsTab.' + id,
      label: `${t('Settings')}: ${t(name)}`,
      group: 'Settings',
      icon: 'settings',
      keywords: 'open öffnen',
      run: () => {
        ui.settingsTab = id;
        ui.dialog = 'settings';
      }
    })),
    // tools
    { id: 'fixTypography', label: 'Fix typography in existing text…', group: 'Tools', icon: 'sparkle', keywords: 'quotes anführungszeichen gedankenstrich dash consistent einheitlich', run: () => (ui.fixTypography = true) },
    { id: 'repairText', label: 'Repair text from PDFs (all quotes)…', group: 'Tools', icon: 'sparkle', keywords: 'ocr umlaut', run: () => (ui.repairItems = db.all('artifacts').map((a) => a.id)) },
    { id: 'write.export', label: 'Word export', group: 'Project', icon: 'upload', keywords: 'docx word', when: hasProject, run: () => (ui.wordExport = true) },
    { id: 'newHeading', label: 'New heading at the end of the outline', group: 'Outline', icon: 'plus', keywords: 'kapitel chapter section', when: hasProject, run: () => {
      const h = addHeading(ui.projectId!, null);
      if (ui.stage !== 'outline' && ui.stage !== 'arrange') ui.stage = 'outline';
      ui.focusHeading = h.id;
    } },
    // appearance
    ...choice('theme', 'Theme', [['system', 'system'], ['light', 'light'], ['dark', 'dark'], ['sepia', 'sepia']], 'dark mode hell dunkel'),
    ...choice('contrast', 'Contrast', [['normal', 'Normal'], ['high', 'High']]),
    ...choice('language', 'Language', [['en', 'English'], ['de', 'Deutsch']], 'sprache language english deutsch'),
    ...choice('editorFont', 'Writing font', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']], 'schrift font'),
    ...choice('lineWidth', 'Line width', [['narrow', 'narrow'], ['normal', 'normal'], ['wide', 'wide']]),
    { id: 'set.fontSize.up', label: 'Larger text', group: 'Settings', icon: 'settings', keywords: 'font size zoom größer schrift', run: () => (settings.fontSize = Math.min(22, settings.fontSize + 1)) },
    { id: 'set.fontSize.down', label: 'Smaller text', group: 'Settings', icon: 'settings', keywords: 'font size zoom kleiner schrift', run: () => (settings.fontSize = Math.max(13, settings.fontSize - 1)) },
    toggle('reduceMotion', 'Reduce motion', 'animation'),
    // citations
    ...choice('citationStyle', 'Citation style', STYLES.map((s) => [s.id, s.label] as [string, string]), 'zitierstil'),
    ...choice('noteParens', 'Citations in footnotes', [['cite', 'Without brackets when the citation stands alone (Vgl. Assmann 2011, S. 18.)'], ['all', 'Always without brackets'], ['keep', 'With brackets, as in the text']], 'klammern'),
    ...choice('ibidScope', 'Short form “ebd.” for the same source', [['paragraph', 'Only within a paragraph (written out at the first citation of each paragraph)'], ['section', 'Throughout a section']], 'ibid ebenda'),
    toggle('secondaryInBib', 'List the original work in the bibliography too', 'sekundärzitat secondary'),
    // quotes and typing
    ...choice('insertMode', 'Insert quotes by default', [['inline', 'In the sentence'], ['editable', 'As editable text'], ['block', 'Block quote'], ['footnote', 'In a footnote'], ['cite', 'Citation only']]),
    toggle('quoteItalic', 'Quotes in italics', 'kursiv'),
    ...choice('quoteMarks', 'Quotation marks', [['de', '„…“'], ['en', '“…”'], ['ch', '«…»'], ['none', 'none']], 'anführungszeichen'),
    ...choice('nestedQuoteMarks', 'Quotation marks inside a quote', [['auto', 'matching'], ['de', '‚…‘'], ['en', '‘…’'], ['ch', '‹…›'], ['keep', 'as in the source']], 'nested innere anführungszeichen'),
    toggle('editorSpellcheck', 'Spell check', 'rechtschreibung'),
    toggle('writePanel', 'Library panel next to the text in Write (otherwise: “Insert quote”, its shortcut or @)', 'bibliothek'),
    toggle('editorAutoDash', 'Turn “ - ” into a dash “ – ” while typing', 'gedankenstrich'),
    toggle('editorSmartQuotes', 'Typographic quotes while typing (" becomes „ “ as set under quotation marks, ... becomes …)', 'anführungszeichen'),
    toggle('editorNbsp', 'Keep “S. 12”, “z. B.” and “§ 5” together at line ends (non-breaking space; Ctrl+Shift+Space inserts one)', 'geschütztes leerzeichen nbsp'),
    toggle('editorFixPaste', 'The same for pasted and imported text (Zotero highlights, PDF text)', 'einfügen paste'),
    toggle('writeFootnotesBelow', 'Show the footnotes in Write below each section, in order', 'fußnoten'),
    // export, Zotero, sync
    toggle('exportCover', 'Title page', 'word export deckblatt'),
    toggle('exportToc', 'Table of contents', 'word export inhaltsverzeichnis'),
    toggle('exportBibliography', 'Bibliography', 'word export literaturverzeichnis'),
    toggle('exportZotero', 'Live Zotero citations (refresh in Word)', 'word export'),
    toggle('repairAuto', 'Apply sure repairs right away (umlauts read as “?”, broken words); they stay marked in green', 'pdf'),
    toggle('zoteroHighlightCounts', 'Show how many highlights of a source are new (not gone through yet)', 'zotero'),
    toggle('readingStatus', 'Reading status per source (to read, reading, read)', 'lesestatus'),
    toggle('autoSync', 'Sync automatically after changes', 'synchronisation drive')
  ];
}

const GROUP_OF: Record<string, string> = { General: 'General', Stages: 'Go to', Create: 'Create', Writing: 'Write', 'Outline editing': 'Outline' };
const ICON_OF: Record<string, string> = { General: 'settings', Stages: 'layers', Create: 'plus', Writing: 'edit', 'Outline editing': 'menu' };

/**
 * Commands for actions that have an entry in the keyboard shortcuts (label, group and keys
 * come from there). `extra` adds icon, state or keywords per id.
 */
export function shortcutCommands(
  defs: readonly { id: string; label: string; group: string }[],
  actions: Record<string, { run: () => unknown; when?: () => boolean }>,
  extra: Record<string, Partial<Command>> = {}
): Command[] {
  return defs
    .filter((d) => actions[d.id])
    .map((d) => ({
      id: d.id,
      label: d.label,
      group: GROUP_OF[d.group] ?? d.group,
      icon: ICON_OF[d.group],
      when: actions[d.id].when,
      run: actions[d.id].run,
      ...extra[d.id]
    }));
}
