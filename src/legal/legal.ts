// Language toggle + theme for the static pages (shares the app's saved settings).
const root = document.documentElement;
let saved: { language?: string; theme?: string } = {};
try {
  saved = JSON.parse(localStorage.getItem('structed.settings') || '{}');
} catch {
  /* ignore */
}
const q = new URLSearchParams(location.search).get('lang');
const lang = q === 'de' || q === 'en' ? q : saved.language ?? (navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en');
if (saved.theme === 'dark' || saved.theme === 'light') root.dataset.theme = saved.theme;

function setLang(l: string) {
  root.dataset.lang = l;
  root.lang = l;
  document.querySelectorAll<HTMLButtonElement>('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.l === l)));
  const t = document.querySelector<HTMLElement>(`[data-title-${l}]`);
  if (t) document.title = t.getAttribute(`data-title-${l}`)!;
}
document.querySelectorAll<HTMLButtonElement>('.lang button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.l!)));
setLang(lang);
