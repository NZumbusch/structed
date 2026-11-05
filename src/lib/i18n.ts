import { settings } from './settings.svelte';
import { de } from './i18n-de';

/**
 * Translate. Keys are the English UI strings; German lives in i18n-de.ts.
 * `{name}` placeholders are replaced from `vars`.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = settings.language === 'de' ? (de[key] ?? key) : key;
  if (vars) for (const k in vars) s = s.replaceAll(`{${k}}`, String(vars[k]));
  return s;
}
