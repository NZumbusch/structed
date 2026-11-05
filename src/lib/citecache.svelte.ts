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
  return `${a.sourceId}|${s?.updatedAt}|${page}|${style}|${locale}`;
}

/** Formatted in-text citation, e.g. "(Dürr, 1971, S. 796)". Reactive: re-renders when ready. */
export function citeText(a: Artifact, opts: { style?: string; locale?: string; page?: string | null } = {}): string {
  const style = opts.style ?? settings.citationStyle;
  const locale = opts.locale ?? settings.citationLocale;
  const page = opts.page ?? a.page ?? '';
  if (!db.get('sources', a.sourceId)) return '';
  const k = key(a, style, locale, page);
  const hit = cache.get(k);
  if (hit !== undefined) return hit;
  if (!pending.has(k)) {
    pending.add(k);
    citeArtifact({ ...a, page }, { style, locale })
      .then((v) => cache.set(k, v || fallback(a, page)))
      .catch(() => cache.set(k, fallback(a, page)))
      .finally(() => pending.delete(k));
  }
  return fallback(a, page);
}

const fallback = (a: Artifact, page: string) => `(${shortCite({ ...a, page })})`;

/** Await the formatted citation (for exports). */
export async function citeTextAsync(a: Artifact, opts: { style?: string; locale?: string; page?: string | null } = {}) {
  const page = opts.page ?? a.page ?? '';
  if (!db.get('sources', a.sourceId)) return '';
  return (await citeArtifact({ ...a, page }, { style: opts.style ?? settings.citationStyle, locale: opts.locale ?? settings.citationLocale }).catch(() => '')) || fallback(a, page);
}

export const MARKS: Record<string, [string, string]> = { de: ['„', '“'], en: ['“', '”'], ch: ['«', '»'], none: ['', ''] };
export const marks = () => MARKS[settings.quoteMarks] ?? MARKS.de;
export const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
export const wordsOf = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
