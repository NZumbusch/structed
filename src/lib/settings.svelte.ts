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
  citationStyle: string;
  citationLocale: string;
  panelGroupBy: GroupBy;
  panelScope: 'project' | 'library';
  panelUsage: 'unused' | 'all' | 'used';
  panelWidth: number;
  panelOpen: boolean;
  showAllProjectsInPanel: boolean;
  snapshotOnBigChange: boolean;
  shortcuts: Record<string, string | null>;
  // editor & Word export
  quoteItalic: boolean;
  quoteMarks: 'de' | 'en' | 'ch' | 'none';
  insertMode: 'inline' | 'editable' | 'block' | 'footnote' | 'cite';
  autoBlockWords: number; // inline quotes with at least this many words become block quotes (0 = off)
  editorSpellcheck: boolean;
  editorLang: string;
  editorWidth: 'narrow' | 'normal' | 'wide';
  exportTemplate: 'seminararbeit' | 'plain';
  exportZotero: boolean;
  exportCover: boolean;
  exportToc: boolean;
  exportBibliography: boolean;
  exportBibTitle: string;
  coverDefaults: Record<string, string>;
  tourDone: boolean;
}

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
  citationStyle: 'apa',
  citationLocale: 'en-US',
  panelGroupBy: 'source',
  panelScope: 'project',
  panelUsage: 'all',
  panelWidth: 360,
  panelOpen: true,
  showAllProjectsInPanel: true,
  snapshotOnBigChange: true,
  shortcuts: {},
  quoteItalic: true,
  quoteMarks: 'de',
  insertMode: 'inline',
  autoBlockWords: 40,
  editorSpellcheck: true,
  editorLang: 'de',
  editorWidth: 'normal',
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
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = $state(load());

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
