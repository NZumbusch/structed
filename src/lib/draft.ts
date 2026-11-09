// Plain text of a section's draft, without loading the editor (search, counts).
import { db } from './db.svelte';
import { marks, oneLine } from './citecache.svelte';
import { sectionNumber } from './ops';

/** Plain text of a draft (for word and character counts): linked quotes count with their text, footnotes do not. */
export function draftText(json: string | undefined): string {
  if (!json) return '';
  try {
    let out = '';
    const walk = (n: { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (n.text) out += n.text;
      else if (n.type === 'quoteRef' || n.type === 'quoteBlock') {
        const a = db.get('artifacts', String(n.attrs?.id));
        if (typeof n.attrs?.prefix === 'string' && n.attrs.prefix) out += n.attrs.prefix + ' '; // "Vgl." counts as a word
        if (a && n.attrs?.mode !== 'cite') {
          const [l, r] = marks();
          const q = l + oneLine(a.text) + r;
          out += n.type === 'quoteBlock' ? `\n${q}\n` : q;
        }
      } else if (n.type === 'sectionRef') out += sectionNumber(String(n.attrs?.id)) ?? '?';
      else if (n.type === 'hardBreak') out += '\n';
      (n.content as (typeof n)[] | undefined)?.forEach(walk);
      if (n.type === 'paragraph') out += '\n';
    };
    walk(JSON.parse(json));
    return out;
  } catch {
    return '';
  }
}

/** Characters with spaces, as Word counts them: line breaks between paragraphs do not count. */
export const charCount = (text: string) => text.replace(/\s*\n\s*/g, '\n').trim().replace(/\n/g, '').length;

