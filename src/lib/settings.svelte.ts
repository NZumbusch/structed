export type Theme = 'system' | 'light' | 'dark' | 'sepia';
export type GroupBy = 'source' | 'author' | 'tag' | 'kind' | 'publication' | 'year' | 'none';

export interface Settings {
  theme: Theme;
  contrast: 'normal' | 'high';
  fontSize: number; // px base
  editorFont: 'sans' | 'serif' | 'mono';
  accent: string;
  language: 'en' | 'de';
  reduceMotion: boolean;
  lineWidth: 'narrow' | 'normal' | 'wide';
  googleClientId: string;
  authWorkerUrl: string;
  autoRenew: boolean;
  autoSync: boolean;
  zoteroUserId: string;
  zoteroApiKey: string;
  zoteroGroups: string; // comma-separated group ids, optional
  zoteroAutoSync: boolean; // keep the sources in sync with Zotero automatically
  zoteroSyncLibrary: string; // "users/123" | "groups/456"
  zoteroSyncCollections: string[]; // collection keys; empty = the whole library
  /** @deprecated single collection of earlier versions, moved into zoteroSyncCollections */
  zoteroSyncCollection?: string;
  zoteroSyncTags: boolean; // also take over Zotero tags
  zoteroSyncVersions: Record<string, number>; // last library version seen, per scope
  citationStyle: string;
  citationLocale: string;
  panelGroupBy: GroupBy;
  panelScope: 'project' | 'library';
  panelUsage: 'unused' | 'all' | 'used';
  panelWidth: number;
  panelOpen: boolean; // (before panels were remembered per stage)
  /** library panel open per stage; unset = open, except in Write where it starts closed */
  panelOpenIn: Record<string, boolean>;
  /** the library panel in Write; off = quotes come in through the quote search (button, shortcut, @) */
  writePanel: boolean;
  outlineVisits: number; // the shortcut hints under the outline show for the first few visits
  /** the quote picker (insert a citation): remembered filters and order */
  picker: PickerPrefs;
  /** quotes inserted lately, newest first (for "recently used") */
  recentQuotes: string[];
  showAllProjectsInPanel: boolean;
  snapshotOnBigChange: boolean;
  shortcuts: Record<string, string | null>;
  // editor & Word export
  quoteItalic: boolean;
  quoteMarks: 'de' | 'en' | 'ch' | 'none';
  insertMode: 'inline' | 'editable' | 'block' | 'footnote' | 'cite';
  autoBlockWords: number; // inline quotes with at least this many words become block quotes (0 = off)
  editorSpellcheck: boolean;
  editorAutoDash: boolean; // " - " becomes " – " while typing
  editorLang: string;
  /** @deprecated merged into lineWidth (one width for every view) */
  editorWidth?: 'narrow' | 'normal' | 'wide';
  // Write stage: notes (gist) under the headings, and focus mode
  writeNotes: boolean;
  focusNotes: boolean; // show the notes in focus mode
  focusQuotes: boolean; // show the library panel (quotes) in focus mode
  focusDim: boolean; // dim everything but the current paragraph
  focusTypewriter: boolean; // keep the line being written in the middle of the screen
  focusGoal: number; // words to write per session (0 = no goal)
  focusSprint: number; // minutes of a writing sprint
  exportTemplate: 'seminararbeit' | 'plain';
  exportZotero: boolean;
  exportCover: boolean;
  exportToc: boolean;
  exportBibliography: boolean;
  exportBibTitle: string;
  coverDefaults: Record<string, string>;
  tourDone: boolean;
}

export interface PickerPrefs {
  scope: 'section' | 'project' | 'library';
  kinds: ('quote' | 'paraphrase' | 'note')[];
  sourceId: string; // '' = all sources
  tag: string; // '' = all tags
  used: 'all' | 'unused' | 'used'; // already cited in this project's text?
  group: 'none' | 'source' | 'author' | 'tag' | 'kind' | 'year';
  sort: 'source' | 'author' | 'year' | 'added' | 'recent';
}
export const PICKER_DEFAULTS: PickerPrefs = { scope: 'project', kinds: ['quote', 'paraphrase'], sourceId: '', tag: '', used: 'all', group: 'none', sort: 'source' };

export const ACCENTS = ['#3b6fd8', '#2f9e75', '#c0582f', '#8a55c9', '#c94a73', '#b08a1e', '#56606f'];

const defaults: Settings = {
  theme: 'system',
  contrast: 'normal',
  fontSize: 16,
  editorFont: 'sans',
  accent: ACCENTS[0],
  language: (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en',
  reduceMotion: false,
  lineWidth: 'normal',
  googleClientId: '',
  authWorkerUrl: '',
  autoRenew: true,
  autoSync: true,
  zoteroUserId: '',
  zoteroApiKey: '',
  zoteroGroups: '',
  zoteroAutoSync: false,
  zoteroSyncLibrary: '',
  zoteroSyncCollections: [],
  zoteroSyncTags: false,
  zoteroSyncVersions: {},
  citationStyle: 'apa',
  citationLocale: 'en-US',
  panelGroupBy: 'source',
  panelScope: 'project',
  panelUsage: 'all',
  panelWidth: 360,
  panelOpen: true,
  panelOpenIn: {},
  writePanel: false,
  outlineVisits: 0,
  picker: { ...PICKER_DEFAULTS },
  recentQuotes: [],
  showAllProjectsInPanel: true,
  snapshotOnBigChange: true,
  shortcuts: {},
  quoteItalic: true,
  quoteMarks: 'de',
  insertMode: 'inline',
  autoBlockWords: 40,
  editorSpellcheck: true,
  editorAutoDash: true,
  editorLang: 'de',
  writeNotes: true,
  focusNotes: false,
  focusQuotes: false,
  focusDim: true,
  focusTypewriter: false,
  focusGoal: 0,
  focusSprint: 25,
  exportTemplate: 'seminararbeit',
  exportZotero: true,
  exportCover: true,
  exportToc: true,
  exportBibliography: true,
  exportBibTitle: 'Quellenverzeichnis',
  coverDefaults: {},
  tourDone: false
};

const KEY = 'structed.settings';

function load(): Settings {
  try {
    const s: Settings = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    // one collection → several
    if (s.zoteroSyncCollection) s.zoteroSyncCollections = [...new Set([...(s.zoteroSyncCollections ?? []), s.zoteroSyncCollection])];
    delete s.zoteroSyncCollection;
    // the editor's own page width became the one line width
    if (s.editorWidth && s.editorWidth !== 'normal' && s.lineWidth === 'normal') s.lineWidth = s.editorWidth;
    delete s.editorWidth;
    return s;
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = $state(load());

/** Is the library panel open in this stage? (each stage remembers its own choice) */
export const panelOpenIn = (stage: string) => settings.panelOpenIn?.[stage] ?? (stage === 'write' ? false : settings.panelOpen);
export function setPanelOpen(stage: string, open: boolean) {
  settings.panelOpenIn = { ...settings.panelOpenIn, [stage]: open };
}

export const BUILD_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const clientId = () => settings.googleClientId.trim() || BUILD_CLIENT_ID;
export const BUILD_AUTH_URL: string = import.meta.env.VITE_AUTH_WORKER_URL ?? '';
export const workerUrl = () => settings.authWorkerUrl.trim() || BUILD_AUTH_URL;

const media = matchMedia('(prefers-color-scheme: dark)');
let systemDark = $state(media.matches);
media.addEventListener('change', (e) => (systemDark = e.matches));

/** Black or white, whichever has more contrast on the given color. */
export function onColor(hex: string): string {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#111111';
}

export function applySettings() {
  $effect.root(() => {
    $effect(() => {
      localStorage.setItem(KEY, JSON.stringify(settings));
    });
    $effect(() => {
      const root = document.documentElement;
      const theme = settings.theme === 'system' ? (systemDark ? 'dark' : 'light') : settings.theme;
      root.dataset.theme = theme;
      root.dataset.contrast = settings.contrast;
      root.dataset.font = settings.editorFont;
      root.dataset.width = settings.lineWidth;
      root.dataset.motion = settings.reduceMotion ? 'reduce' : 'normal';
      root.style.setProperty('--accent', settings.accent);
      root.style.setProperty('--on-accent', onColor(settings.accent));
      root.style.setProperty('--fs', settings.fontSize + 'px');
      root.lang = settings.language;
      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#1f2430');
    });
  });
}
