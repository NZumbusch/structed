// Live, cached citation strings for the editor (citation-js is async).
import { SvelteMap } from 'svelte/reactivity';
import { db } from './db.svelte';
import { settings } from './settings.svelte';
import { citeArtifact } from './cite';
import { shortCite } from './ops';
import type { Artifact } from './types';

const cache = new SvelteMap<string, string>();
const pending = new Set<string>();

function key(a: Artifact, style: string, locale: string, page: string) {
  const s = db.get('sources', a.sourceId);
  const o = a.original ? db.get('sources', a.original.sourceId) : undefined;
  const orig = o ? `${o.id}|${o.updatedAt}|${a.original!.page ?? ''}|${a.original!.pageLabel ?? ''}` : '';
  return `${a.sourceId}|${s?.updatedAt}|${page}|${a.pageLabel ?? ''}|${orig}|${style}|${locale}|${settings.secondaryText}`;
}

/** Formatted in-text citation, e.g. "(Dürr, 1971, S. 796)". Reactive: re-renders when ready. */
export function citeText(a: Artifact, opts: { style?: string; locale?: string; page?: string | null } = {}): string {
  const style = opts.style ?? settings.citationStyle;
  const locale = opts.locale ?? settings.citationLocale;
  const page = opts.page ?? a.page ?? '';
  if (!db.get('sources', a.sourceId)) return '';
  const k = key(a, style, locale, page);
  const hit = cache.get(k);
  if (hit !== undefined) return keepTogether(hit);
  if (!pending.has(k)) {
    pending.add(k);
    citeArtifact({ ...a, page }, { style, locale })
      .then((v) => cache.set(k, v || fallback(a, page)))
      .catch(() => cache.set(k, fallback(a, page)))
      .finally(() => pending.delete(k));
  }
  return keepTogether(fallback(a, page));
}

/** "S. 12", "Sp. 1121", "p. 3" never break across lines (non-breaking space, unless switched off). */
export function keepTogether(cite: string): string {
  if (!settings.editorNbsp) return cite;
  return cite.replace(/(^|[\s(,;\[])(S|Sp|Abs|Nr|Bd|Kap|Anm|Bl|Jg|Vol|No|p|pp|col|para|ch|Seite|Seiten|Spalte|Spalten|page|pages|column|§§?)\.? (?=[\dIVXLivxl])/g, (m, pre, ab) => `${pre}${ab}${m.endsWith('. ') ? '.' : ''}\u00a0`);
}

const fallback = (a: Artifact, page: string) => `(${shortCite({ ...a, page })})`;

/** Await the formatted citation (for exports). */
export async function citeTextAsync(a: Artifact, opts: { style?: string; locale?: string; page?: string | null } = {}) {
  const page = opts.page ?? a.page ?? '';
  if (!db.get('sources', a.sourceId)) return '';
  return keepTogether((await citeArtifact({ ...a, page }, { style: opts.style ?? settings.citationStyle, locale: opts.locale ?? settings.citationLocale }).catch(() => '')) || fallback(a, page));
}

export const MARKS: Record<string, [string, string]> = { de: ['„', '“'], en: ['“', '”'], ch: ['«', '»'], none: ['', ''] };
export const marks = () => MARKS[settings.quoteMarks] ?? MARKS.de;
export const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
export const wordsOf = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

/** "(Assmann, 2011, S. 18)" → "Assmann, 2011, S. 18" – only when the brackets enclose the whole citation. */
export function stripParens(cite: string): string {
  const s = cite.trim();
  if (!s.startsWith('(') || !s.endsWith(')')) return cite;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0 && i < s.length - 1) return cite; // "(A) and (B)"
  }
  return s.slice(1, -1);
}

/**
 * A citation as it appears in a footnote (Settings → Citations → Citations in footnotes).
 * "cite" (default): without brackets when it stands alone ("Vgl. Assmann 2011, S. 18"), but
 * kept right after a quote in quotation marks ("„…“ (Assmann 2011, S. 18)"). `before` is the
 * text just before the citation.
 */
export function noteCite(cite: string, mode: unknown, before = ''): string {
  const how = settings.noteParens ?? 'cite';
  if (how === 'all') return stripParens(cite);
  if (how === 'cite' && mode === 'cite' && !/[“”„"»«‘’‚'›‹]\s*$/.test(before)) return stripParens(cite);
  return cite;
}
