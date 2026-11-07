import { db } from './db.svelte';
import { flatten, placementsOf, shortCite, sourcesOf } from './ops';
import { bibliography, citeArtifact, toBibtex, toCslJson } from './cite';
import { settings } from './settings.svelte';
import type { Artifact, Project, Source } from './types';

export interface MdOptions {
  numbering: boolean;
  bodies: boolean;
  items: 'none' | 'quotes' | 'all';
  itemStyle: 'callout' | 'blockquote';
  citations: 'inline' | 'footnotes' | 'short';
  comments: boolean;
  frontmatter: boolean;
  bibliography: boolean;
  itemComments: boolean;
}

export const defaultMd: MdOptions = {
  numbering: true,
  bodies: true,
  items: 'all',
  itemStyle: 'callout',
  citations: 'inline',
  comments: true,
  frontmatter: true,
  bibliography: true,
  itemComments: true
};

function usedSources(projectId: string): Source[] {
  const ids = new Set<string>();
  for (const p of db.all('placements')) {
    if (p.projectId !== projectId || !db.get('headings', p.headingId)) continue;
    const a = db.get('artifacts', p.artifactId);
    if (a) for (const x of sourcesOf(a)) ids.add(x.id);
  }
  return [...ids].map((id) => db.get('sources', id)).filter((s): s is Source => !!s);
}

async function cite(a: Artifact, mode: MdOptions['citations']): Promise<string> {
  if (!a.sourceId) return '';
  if (mode === 'short') return shortCite(a);
  return (await citeArtifact(a).catch(() => '')) || shortCite(a);
}

const KIND_CALLOUT: Record<string, string> = { quote: 'quote', paraphrase: 'abstract', note: 'note', image: 'example' };

export async function toMarkdown(project: Project, o: MdOptions = defaultMd): Promise<string> {
  const out: string[] = [];
  const notes: string[] = [];
  if (o.frontmatter) {
    out.push('---', `title: "${project.title.replace(/"/g, '\\"')}"`);
    if (project.subtitle) out.push(`subtitle: "${project.subtitle.replace(/"/g, '\\"')}"`);
    out.push(`date: ${new Date().toISOString().slice(0, 10)}`, 'tags: [structed]', '---', '');
  }
  out.push(`# ${project.title}`, '');
  if (project.subtitle) out.push(`*${project.subtitle}*`, '');

  for (const f of flatten(project.id)) {
    const h = f.h;
    const level = Math.min(f.depth + 2, 6);
    out.push(`${'#'.repeat(level)} ${o.numbering ? f.num + ' ' : ''}${h.title || 'Untitled'}`, '');
    if (o.bodies && h.body.trim()) out.push(h.body.trim(), '');
    if (o.comments)
      for (const c of db.all('comments').filter((c) => c.targetId === h.id && !c.resolved))
        out.push(o.itemStyle === 'callout' ? `> [!todo] Comment\n> ${c.text.replace(/\n/g, '\n> ')}` : `<!-- Comment: ${c.text} -->`, '');
    if (o.items !== 'none') {
      for (const p of placementsOf(h.id)) {
        const a = db.get('artifacts', p.artifactId);
        if (!a || (o.items === 'quotes' && a.kind !== 'quote' && a.kind !== 'paraphrase')) continue;
        const c = await cite(a, o.citations);
        let ref = '';
        if (c) {
          if (o.citations === 'footnotes') {
            notes.push(c);
            ref = `[^${notes.length}]`;
          } else ref = c;
        }
        const body = (a.kind === 'image' ? `*[Image] ${a.text}*` : a.text).trim();
        const lines: string[] = [];
        if (o.itemStyle === 'callout') {
          const title = a.kind === 'note' ? a.title || 'Note' : o.citations === 'footnotes' ? a.title || '' : ref || a.title || '';
          lines.push(`> [!${KIND_CALLOUT[a.kind]}]${a.kind === 'note' ? '' : '-'} ${title}`.trimEnd());
          lines.push(...body.split('\n').map((l) => `> ${l}`));
          if (o.citations === 'footnotes' && ref) lines[lines.length - 1] += ref;
        } else {
          lines.push(...body.split('\n').map((l) => `> ${l}`));
          if (ref) lines.push(`> — ${ref}`);
        }
        if (o.itemComments && (a.comment || p.note)) lines.push('>', `> *${[p.note, a.comment].filter(Boolean).join(' — ')}*`);
        out.push(lines.join('\n'), '');
      }
    }
  }
  if (notes.length) out.push(...notes.map((n, i) => `[^${i + 1}]: ${n}`), '');
  if (o.bibliography) {
    const srcs = usedSources(project.id);
    if (srcs.length) {
      const bib = await bibliography(srcs).catch(() => '');
      out.push(settings.language === 'de' ? '## Literaturverzeichnis' : '## References', '', ...bib.split('\n').filter(Boolean).map((l) => l.trim()).flatMap((l) => [l, '']));
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export async function exportBib(projectId: string | null, format: 'bibtex' | 'csljson'): Promise<string> {
  const srcs = projectId ? usedSources(projectId) : db.all('sources');
  return format === 'bibtex' ? toBibtex(srcs) : toCslJson(srcs);
}
export { usedSources };
