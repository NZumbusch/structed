import { db } from './db.svelte';
import { flatten, placementsOf, shortCite } from './ops';
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
    if (a?.sourceId) ids.add(a.sourceId);
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

// ---------- DOCX ----------
export async function toDocx(project: Project, o: MdOptions = defaultMd): Promise<Blob> {
  const d = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = d;
  const H = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

  const inline = (s: string, base: { italics?: boolean; color?: string } = {}) => {
    const runs: InstanceType<typeof TextRun>[] = [];
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
    let last = 0;
    for (const m of s.matchAll(re)) {
      if (m.index! > last) runs.push(new TextRun({ text: s.slice(last, m.index), ...base }));
      const tok = m[0];
      if (tok.startsWith('**')) runs.push(new TextRun({ text: tok.slice(2, -2), bold: true, ...base }));
      else if (tok.startsWith('`')) runs.push(new TextRun({ text: tok.slice(1, -1), font: 'Consolas', ...base }));
      else runs.push(new TextRun({ text: tok.slice(1, -1), italics: true, ...base }));
      last = m.index! + tok.length;
    }
    if (last < s.length) runs.push(new TextRun({ text: s.slice(last), ...base }));
    return runs;
  };

  const mdBlocks = (md: string) => {
    const ps: InstanceType<typeof Paragraph>[] = [];
    for (const block of md.split(/\n{2,}/)) {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*[-*+] /.test(l))) {
        for (const l of lines) ps.push(new Paragraph({ children: inline(l.replace(/^\s*[-*+] /, '')), bullet: { level: 0 } }));
      } else if (/^#{1,6} /.test(block)) {
        ps.push(new Paragraph({ children: inline(block.replace(/^#+ /, '')), heading: HeadingLevel.HEADING_6 }));
      } else if (lines.every((l) => l.startsWith('>'))) {
        ps.push(new Paragraph({ children: inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), { italics: true }), indent: { left: 720 } }));
      } else ps.push(new Paragraph({ children: inline(lines.join(' ')), spacing: { after: 120 } }));
    }
    return ps;
  };

  const children: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ text: project.title, heading: HeadingLevel.TITLE }),
    ...(project.subtitle ? [new Paragraph({ children: [new TextRun({ text: project.subtitle, italics: true })], spacing: { after: 240 } })] : [])
  ];
  const wrap = (s: string) => (settings.citationLocale.startsWith('de') ? `„${s}“` : `“${s}”`);

  for (const f of flatten(project.id)) {
    const h = f.h;
    children.push(new Paragraph({ text: `${o.numbering ? f.num + ' ' : ''}${h.title || 'Untitled'}`, heading: H[Math.min(f.depth, 5)] }));
    if (o.bodies && h.body.trim()) children.push(...mdBlocks(h.body.trim()));
    if (o.comments)
      for (const c of db.all('comments').filter((c) => c.targetId === h.id && !c.resolved))
        children.push(new Paragraph({ children: [new TextRun({ text: `[Comment] ${c.text}`, color: 'B07A12', highlight: 'yellow' })] }));
    if (o.items === 'none') continue;
    for (const p of placementsOf(h.id)) {
      const a = db.get('artifacts', p.artifactId);
      if (!a || (o.items === 'quotes' && a.kind !== 'quote' && a.kind !== 'paraphrase')) continue;
      const c = await cite(a, o.citations === 'footnotes' ? 'inline' : o.citations);
      const text = a.kind === 'quote' ? wrap(a.text) : a.text;
      children.push(
        new Paragraph({
          children: [
            ...(a.kind === 'note' ? [new TextRun({ text: 'Note: ', bold: true, color: '7A6A58' })] : []),
            new TextRun({ text, italics: a.kind === 'quote' }),
            ...(c ? [new TextRun({ text: ' ' + c, color: '555555' })] : [])
          ],
          indent: { left: 567, right: 567 },
          spacing: { before: 80, after: 80 },
          alignment: AlignmentType.LEFT
        })
      );
      if (o.itemComments && (a.comment || p.note))
        children.push(new Paragraph({ children: [new TextRun({ text: [p.note, a.comment].filter(Boolean).join(' — '), color: '888888', size: 18 })], indent: { left: 567 } }));
    }
  }
  if (o.bibliography) {
    const srcs = usedSources(project.id);
    if (srcs.length) {
      children.push(new Paragraph({ text: settings.language === 'de' ? 'Literaturverzeichnis' : 'References', heading: HeadingLevel.HEADING_1 }));
      const bib = await bibliography(srcs).catch(() => '');
      for (const l of bib.split('\n').map((x) => x.trim()).filter(Boolean))
        children.push(new Paragraph({ children: [new TextRun(l)], indent: { left: 567, hanging: 567 }, spacing: { after: 100 } }));
    }
  }
  const doc = new Document({
    creator: 'Structed',
    title: project.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 24 } } } },
    sections: [{ children }]
  });
  return Packer.toBlob(doc);
}

export async function exportBib(projectId: string | null, format: 'bibtex' | 'csljson'): Promise<string> {
  const srcs = projectId ? usedSources(projectId) : db.all('sources');
  return format === 'bibtex' ? toBibtex(srcs) : toCslJson(srcs);
}
export { usedSources };
