// Citation formatting + bibliography parsing via citation-js (lazy-loaded).
import type { Artifact, CSLItem, Source } from './types';
import { db } from './db.svelte';
import { settings } from './settings.svelte';

export const STYLES: { id: string; label: string; builtin?: boolean }[] = [
  { id: 'apa', label: 'APA 7' },
  { id: 'chicago-author-date', label: 'Chicago (author-date)' },
  { id: 'chicago-notes-bibliography', label: 'Chicago (notes)' },
  { id: 'harvard-cite-them-right', label: 'Harvard (Cite Them Right)' },
  { id: 'modern-language-association', label: 'MLA' },
  { id: 'din-1505-2', label: 'DIN 1505-2 (Deutsch)' },
  { id: 'vancouver', label: 'Vancouver', builtin: true }
];
export const LOCALES = ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'es-ES', 'nl-NL'];

type CiteMod = typeof import('@citation-js/core');
let mod: Promise<CiteMod> | null = null;
const loadedStyles = new Set<string>(['apa', 'vancouver', 'harvard1']);
const loadedLocales = new Set<string>(['en-US', 'de-DE', 'fr-FR', 'es-ES', 'nl-NL']);

function load(): Promise<CiteMod> {
  mod ??= (async () => {
    const core = await import('@citation-js/core');
    await Promise.all([
      import('@citation-js/plugin-csl'),
      import('@citation-js/plugin-bibtex'),
      import('@citation-js/plugin-ris')
    ]);
    return core;
  })();
  return mod;
}

async function ensureStyle(core: CiteMod, id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = core.plugins.config.get('@csl') as any;
  if (!loadedStyles.has(id)) {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}csl/${id}.csl`);
      if (r.ok) {
        cfg.templates.add(id, await r.text());
        loadedStyles.add(id);
      }
    } catch {
      /* use builtin */
    }
  }
  return loadedStyles.has(id) ? id : 'apa';
}

async function ensureLocale(core: CiteMod, lang: string) {
  if (loadedLocales.has(lang)) return lang;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${lang}.xml`);
    if (r.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (core.plugins.config.get('@csl') as any).locales.add(lang, await r.text());
      loadedLocales.add(lang);
      return lang;
    }
  } catch {
    /* offline */
  }
  return lang.startsWith('de') ? 'de-DE' : 'en-US';
}

function cslFor(s: Source): CSLItem {
  const c = JSON.parse(JSON.stringify(s.csl)) as CSLItem;
  return { ...c, id: s.id };
}

function pageLabel(p: string) {
  return { locator: p, label: 'page' as const };
}

export interface CiteOpts {
  style?: string;
  locale?: string;
}

async function prep(o: CiteOpts) {
  const core = await load();
  const style = await ensureStyle(core, o.style ?? settings.citationStyle);
  const lang = await ensureLocale(core, o.locale ?? settings.citationLocale);
  return { core, style, lang };
}

/** In-text citation (or note text for note styles) for an artifact incl. page. */
export async function citeArtifact(a: Artifact, o: CiteOpts = {}): Promise<string> {
  const s = db.get('sources', a.sourceId);
  if (!s) return '';
  const { core, style, lang } = await prep(o);
  const cite = new core.Cite([cslFor(s)]);
  const entry = [{ id: s.id, ...(a.page ? pageLabel(a.page) : {}) }];
  try {
    return String(cite.format('citation', { format: 'text', template: style, lang, entry } as never)).trim();
  } catch (e) {
    console.warn(e);
    return '';
  }
}

export async function bibliography(sources: Source[], o: CiteOpts & { format?: 'text' | 'html' } = {}): Promise<string> {
  if (!sources.length) return '';
  const { core, style, lang } = await prep(o);
  const cite = new core.Cite(sources.map(cslFor));
  return String(cite.format('bibliography', { format: o.format ?? 'text', template: style, lang }));
}

export async function referenceOf(s: Source, o: CiteOpts = {}): Promise<string> {
  return (await bibliography([s], o)).trim();
}

export async function toBibtex(sources: Source[]): Promise<string> {
  const core = await load();
  return String(new core.Cite(sources.map(cslFor)).format('biblatex', { format: 'text' }));
}

export function toCslJson(sources: Source[]): string {
  return JSON.stringify(sources.map(cslFor), null, 2);
}

/** Parse BibTeX/BibLaTeX, RIS, CSL-JSON, DOI lists… into CSL items. */
export async function parseBibliography(text: string): Promise<CSLItem[]> {
  const core = await load();
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : (j.items ?? [j]);
      if (arr.length && arr[0].type) return arr as CSLItem[];
    } catch {
      /* not JSON */
    }
  }
  const data = await core.Cite.async(trimmed);
  return (data as unknown as { data: CSLItem[] }).data;
}
