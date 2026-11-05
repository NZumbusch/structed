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
  autoSync: boolean;
  zoteroUserId: string;
  zoteroApiKey: string;
  zoteroGroups: string; // comma-separated group ids, optional
  citationStyle: string;
  citationLocale: string;
  panelGroupBy: GroupBy;
  panelWidth: number;
  panelOpen: boolean;
  showAllProjectsInPanel: boolean;
  snapshotOnBigChange: boolean;
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
  autoSync: true,
  zoteroUserId: '',
  zoteroApiKey: '',
  zoteroGroups: '',
  citationStyle: 'apa',
  citationLocale: 'en-US',
  panelGroupBy: 'source',
  panelWidth: 360,
  panelOpen: true,
  showAllProjectsInPanel: true,
  snapshotOnBigChange: true
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

const media = matchMedia('(prefers-color-scheme: dark)');
let systemDark = $state(media.matches);
media.addEventListener('change', (e) => (systemDark = e.matches));

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
      root.style.setProperty('--fs', settings.fontSize + 'px');
      root.lang = settings.language;
      const meta = document.querySelector('meta[name="theme-color"]');
      meta?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#1f2430');
    });
  });
}
