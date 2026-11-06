// Word export into a real template (styles, numbering, page setup from the user's own
// paper). Citations become live Zotero fields; TOC and bibliography are Word/Zotero
// fields that refresh in Word.
import JSZip from 'jszip';
import { db } from '../db.svelte';
import { settings } from '../settings.svelte';
import { flatten } from '../ops';
import { bibliography } from '../cite';
import { citeTextAsync, marks, oneLine } from '../citecache.svelte';
import type { Artifact, Project, Source } from '../types';
import seminararbeit from './seminararbeit.json';

export type Snippets = typeof seminararbeit;
export const TEMPLATES: Record<string, { label: string; file: string; snippets: Snippets }> = {
  seminararbeit: { label: 'Seminararbeit', file: 'word/seminararbeit.docx', snippets: seminararbeit }
};

export const COVER_FIELDS = ['workType', 'module', 'institution', 'supervisor', 'title', 'author', 'placeDate'] as const;
export type CoverField = (typeof COVER_FIELDS)[number];

export function defaultCover(p: Project): Record<CoverField, string> {
  const d = settings.coverDefaults ?? {};
  const today = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return {
    workType: d.workType ?? 'Seminararbeit',
    module: d.module ?? '',
    institution: d.institution ?? '',
    supervisor: d.supervisor ?? '',
    title: [p.title, p.subtitle].filter(Boolean).join('\n'),
    author: d.author ?? 'vorgelegt von:\n',
    placeDate: d.placeDate ?? `, den ${today}`
  };
}

// ---------------- XML helpers ----------------
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Fmt {
  b?: boolean;
  i?: boolean;
  u?: boolean;
}
/** Merge bold/italic/underline into a run-properties block, keeping OOXML element order. */
export function rpr(base: string, f: Fmt = {}): string {
  let inner = base.replace(/^<w:rPr>|<\/w:rPr>$/g, '');
  if (!f.b && !f.i && !f.u) return inner ? `<w:rPr>${inner}</w:rPr>` : '';
  inner = inner.replace(/<w:(b|bCs|i|iCs)( w:val="[^"]*")?\/>/g, '').replace(/<w:u [^>]*\/>/g, '');
  const bi = (f.b ? '<w:b/><w:bCs/>' : '') + (f.i ? '<w:i/><w:iCs/>' : '');
  const m = inner.match(/^(<w:rStyle[^>]*\/>)?(<w:rFonts[^>]*\/>)?/);
  const pre = m ? m[0] : '';
  let restXml = inner.slice(pre.length);
  if (f.u) restXml = restXml.includes('<w:lang') ? restXml.replace('<w:lang', '<w:u w:val="single"/><w:lang') : restXml + '<w:u w:val="single"/>';
  return `<w:rPr>${pre}${bi}${restXml}</w:rPr>`;
}

function run(text: string, base: string, f: Fmt = {}): string {
  if (!text) return '';
  return text
    .split('\n')
    .map((part, i) => `<w:r>${rpr(base, f)}${i ? '<w:br/>' : ''}${part ? `<w:t xml:space="preserve">${esc(part)}</w:t>` : ''}</w:r>`)
    .join('');
}
const para = (pPr: string, inner: string) => `<w:p>${pPr}${inner}</w:p>`;

// ---------------- Zotero fields ----------------
function stableNum(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 1e6 + 1;
}
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');

export function zoteroItem(s: Source) {
  const id = stableNum(s.id);
  const itemData: Record<string, unknown> = { ...JSON.parse(JSON.stringify(s.csl)), id };
  const item: Record<string, unknown> = { id, itemData };
  if (s.zoteroKey && s.zoteroLibrary) item.uris = [`http://zotero.org/${s.zoteroLibrary}/items/${s.zoteroKey}`];
  return item;
}

export function citationField(a: Artifact, formatted: string, noteIndex: number, base: string, page?: string): string {
  const s = db.get('sources', a.sourceId);
  if (!s) return '';
  if (!settings.exportZotero) return run(formatted, base);
  const item = { ...zoteroItem(s), ...((page ?? a.page) ? { locator: page ?? a.page, label: 'page' } : {}) };
  const json = {
    citationID: rid(),
    properties: { formattedCitation: formatted, plainCitation: formatted, noteIndex },
    citationItems: [item],
    schema: 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json'
  };
  const r = (x: string) => `<w:r>${rpr(base)}${x}</w:r>`;
  return (
    r('<w:fldChar w:fldCharType="begin"/>') +
    r(`<w:instrText xml:space="preserve"> ADDIN ZOTERO_ITEM CSL_CITATION ${esc(JSON.stringify(json))} </w:instrText>`) +
    r('<w:fldChar w:fldCharType="separate"/>') +
    run(formatted, base) +
    r('<w:fldChar w:fldCharType="end"/>')
  );
}

// ---------------- ProseMirror JSON → OOXML ----------------
interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: PMNode[];
}

interface Ctx {
  sn: Snippets;
  footnotes: string[];
  cited: Map<string, Source>;
  citeFormat: (a: Artifact) => Promise<string>;
}

async function inline(nodes: PMNode[] | undefined, ctx: Ctx, base: string, noteIndex = 0): Promise<string> {
  let out = '';
  for (const n of nodes ?? []) {
    if (n.type === 'text') {
      const m = new Set((n.marks ?? []).map((x) => x.type));
      out += run(n.text ?? '', base, { b: m.has('bold'), i: m.has('italic'), u: m.has('underline') });
    } else if (n.type === 'hardBreak') out += `<w:r>${rpr(base)}<w:br/></w:r>`;
    else if (n.type === 'quoteRef') {
      const a = db.get('artifacts', String(n.attrs?.id));
      if (!a) continue;
      const src = db.get('sources', a.sourceId);
      if (src) ctx.cited.set(src.id, src);
      if (n.attrs?.mode !== 'cite') {
        const [l, r] = marks();
        out += run(l, base) + run(oneLine(a.text), base, { i: settings.quoteItalic }) + run(r + (src ? ' ' : ''), base);
      }
      if (src) out += citationField(a, await ctx.citeFormat(a), noteIndex, base);
    } else if (n.type === 'footnote') {
      const id = ctx.footnotes.length + 1;
      const fb = ctx.sn.footnotePPr.match(/<w:rPr>.*?<\/w:rPr>/s)?.[0] ?? '';
      let inner = ctx.sn.footnoteRefRun + run(' ' + String(n.attrs?.before ?? '').trim(), fb);
      const a = n.attrs?.quoteId ? db.get('artifacts', String(n.attrs.quoteId)) : undefined;
      if (a) {
        const src = db.get('sources', a.sourceId);
        if (src) ctx.cited.set(src.id, src);
        const [l, r] = marks();
        inner += run((n.attrs?.before ? ' ' : '') + l, fb) + run(oneLine(n.attrs?.quoteText ? String(n.attrs.quoteText) : a.text), fb, { i: settings.quoteItalic }) + run(r + ' ', fb);
        if (src) inner += citationField(a, await ctx.citeFormat(a), id, fb);
      }
      if (n.attrs?.after) inner += run(' ' + String(n.attrs.after).trim(), fb);
      ctx.footnotes.push(`<w:footnote w:id="${id}">${para(ctx.sn.footnotePPr, inner)}</w:footnote>`);
      out += `<w:r>${ctx.sn.footnoteRefRPr}<w:footnoteReference w:id="${id}"/></w:r>`;
    }
  }
  return out;
}

async function blocks(doc: PMNode | undefined, ctx: Ctx): Promise<string> {
  const { sn } = ctx;
  let out = '';
  for (const b of doc?.content ?? []) {
    if (b.type === 'paragraph') out += para(sn.bodyPPr, await inline(b.content, ctx, sn.bodyRPr));
    else if (b.type === 'blockquote') {
      for (const p of b.content ?? []) out += para(sn.quotePPr, await inline(p.content, ctx, sn.quoteRPr));
    } else if (b.type === 'bulletList' || b.type === 'orderedList') {
      let i = 0;
      for (const li of b.content ?? [])
        for (const p of li.content ?? []) {
          const bullet = b.type === 'bulletList' ? '•\t' : `${++i}.\t`;
          out += para(sn.bodyPPr, run(bullet, sn.bodyRPr) + (await inline(p.content, ctx, sn.bodyRPr)));
        }
    } else if (b.type === 'quoteBlock') {
      const a = db.get('artifacts', String(b.attrs?.id));
      if (!a) continue;
      const src = db.get('sources', a.sourceId);
      if (src) ctx.cited.set(src.id, src);
      const [l, r] = marks();
      out += para(sn.quotePPr, run(l + a.text.trim() + r, sn.quoteRPr));
      if (src) out += para(sn.quoteCitePPr, citationField(a, await ctx.citeFormat(a), 0, sn.bodyRPr));
    }
  }
  return out;
}

// ---------------- whole document ----------------
export interface WordOptions {
  template?: string;
  cover?: boolean;
  toc?: boolean;
  bibliography?: boolean;
  bibTitle?: string;
  /** citation formatting used for the field text (Zotero re-renders it on refresh) */
  style?: string;
  locale?: string;
  templateBytes?: ArrayBuffer;
}

export async function buildWordDocument(project: Project, o: WordOptions = {}): Promise<Blob> {
  const tpl = TEMPLATES[o.template ?? settings.exportTemplate] ?? TEMPLATES.seminararbeit;
  const sn = tpl.snippets;
  const bytes = o.templateBytes ?? (await (await fetch(`${import.meta.env.BASE_URL}${tpl.file}`)).arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  const style = o.style ?? 'apa';
  const locale = o.locale ?? 'de-DE';
  const ctx: Ctx = {
    sn,
    footnotes: [],
    cited: new Map(),
    citeFormat: (a) => citeTextAsync(a, { style, locale })
  };
  let body = '';

  // title page
  if (o.cover ?? settings.exportCover) {
    const cover = { ...defaultCover(project), ...(project.cover ?? {}) } as Record<string, string>;
    for (const c of sn.cover) body += para(c.pPr, c.key ? run(cover[c.key] ?? '', c.rPr) : '');
    body += sn.coverEnd;
    const motto = project.mottoId ? db.get('artifacts', project.mottoId) : undefined;
    if (motto && sn.motto) {
      const [l, r] = marks();
      const pageBreak = (pPr: string) => pPr.replace(/(<w:pStyle [^>]*\/>)?/, (m) => m + '<w:pageBreakBefore/>');
      const src = db.get('sources', motto.sourceId);
      if (src) ctx.cited.set(src.id, src);
      body += para(pageBreak(sn.motto.quotePPr), run(l + motto.text.trim() + r, sn.motto.quoteRPr));
      if (src) body += para(sn.motto.citePPr, citationField(motto, await ctx.citeFormat(motto), 0, sn.motto.citeRPr));
      body += sn.motto.sectEnd;
    }
  }

  const flat = flatten(project.id);
  // table of contents (Word updates page numbers when the file is opened)
  if (o.toc ?? settings.exportToc) {
    body += sn.tocBefore.join('');
    body += para(sn.tocHeading.pPr.replace(/(<w:pStyle [^>]*\/>)/, '$1<w:pageBreakBefore/>'), run('Inhaltsverzeichnis', sn.tocHeading.rPr));
    const entries = flat.filter((f) => f.depth < 3);
    const all = [...entries.map((f, i) => ({ text: `${f.num}\t${f.h.title}`, depth: f.depth, anchor: `_TocS${i}` }))];
    if (o.bibliography ?? settings.exportBibliography) all.push({ text: o.bibTitle ?? settings.exportBibTitle, depth: 0, anchor: '_TocSBib' });
    const fr = (x: string) => `<w:r>${sn.tocRPr}${x}</w:r>`;
    all.forEach((e, i) => {
      // level 3 uses the TOC2 paragraph (tab stops for number + leader); Word rebuilds the TOC on open
      const pPr = e.depth === 0 ? sn.toc1PPr : sn.toc2PPr;
      const start = i === 0 ? fr('<w:fldChar w:fldCharType="begin"/>') + fr('<w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText>') + fr('<w:fldChar w:fldCharType="separate"/>') : '';
      const parts = e.text.split('\t');
      const link =
        `<w:hyperlink w:anchor="${e.anchor}" w:history="1">` +
        parts.map((t, k) => (k ? fr('<w:tab/>') : '') + run(t, sn.tocRPr)).join('') +
        fr('<w:tab/>') + fr('<w:fldChar w:fldCharType="begin"/>') + fr(`<w:instrText xml:space="preserve"> PAGEREF ${e.anchor} \\h </w:instrText>`) + fr('<w:fldChar w:fldCharType="separate"/>') + run('–', sn.tocRPr) + fr('<w:fldChar w:fldCharType="end"/>') +
        '</w:hyperlink>';
      const end = i === all.length - 1 ? fr('<w:fldChar w:fldCharType="end"/>') : '';
      body += para(pPr, start + link + end);
    });
    if (!all.length) body += para(sn.toc1PPr, '');
    body += sn.tocAfter.join('');
  }

  // sections
  let bm = 100;
  const tocIndex = new Map(flat.filter((f) => f.depth < 3).map((f, i) => [f.h.id, i]));
  for (const f of flat) {
    const lvl = Math.min(f.depth, 2);
    const anchor = tocIndex.has(f.h.id) ? `_TocS${tocIndex.get(f.h.id)}` : `_S${bm}`;
    const id = bm++;
    body += para(sn.heading[lvl], `<w:bookmarkStart w:id="${id}" w:name="${anchor}"/>` + run(f.h.title || ' ', sn.headingRPr[lvl]) + `<w:bookmarkEnd w:id="${id}"/>`);
    let doc: PMNode | undefined;
    try {
      doc = f.h.draft ? JSON.parse(f.h.draft) : undefined;
    } catch {
      doc = undefined;
    }
    body += await blocks(doc, ctx);
  }

  // bibliography (Zotero rebuilds it on refresh)
  if (o.bibliography ?? settings.exportBibliography) {
    const id = bm++;
    body += para(sn.bibHeadingPPr, `<w:bookmarkStart w:id="${id}" w:name="_TocSBib"/>` + run(o.bibTitle ?? settings.exportBibTitle, '') + `<w:bookmarkEnd w:id="${id}"/>`);
    const sources = [...ctx.cited.values()];
    const html = sources.length ? await bibliography(sources, { style, locale, format: 'html' }).catch(() => '') : '';
    const entries = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.csl-entry')];
    const br = (x: string) => `<w:r>${rpr(sn.bibRPr)}${x}</w:r>`;
    const fieldStart =
      settings.exportZotero
        ? br('<w:fldChar w:fldCharType="begin"/>') + br('<w:instrText xml:space="preserve"> ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY </w:instrText>') + br('<w:fldChar w:fldCharType="separate"/>')
        : '';
    const fieldEnd = settings.exportZotero ? br('<w:fldChar w:fldCharType="end"/>') : '';
    if (!entries.length) body += para(sn.bibPPr, fieldStart + fieldEnd);
    entries.forEach((e, i) => {
      let inner = '';
      const walk = (n: ChildNode, f: Fmt) => {
        if (n.nodeType === 3) inner += run(n.textContent ?? '', sn.bibRPr, f);
        else if (n instanceof Element) {
          const nf = { ...f, i: f.i || n.tagName === 'I' || n.tagName === 'EM', b: f.b || n.tagName === 'B' };
          n.childNodes.forEach((c) => walk(c, nf));
        }
      };
      e.childNodes.forEach((c) => walk(c, {}));
      body += para(sn.bibPPr, (i === 0 ? fieldStart : '') + inner + (i === entries.length - 1 ? fieldEnd : ''));
    });
  }

  const docXml = (await zip.file('word/document.xml')!.async('string')).replace('{{BODY}}', () => body);
  zip.file('word/document.xml', docXml);
  const fnXml = (await zip.file('word/footnotes.xml')!.async('string')).replace('{{FOOTNOTES}}', () => ctx.footnotes.join(''));
  zip.file('word/footnotes.xml', fnXml);
  const core = await zip.file('docProps/core.xml')?.async('string');
  if (core) zip.file('docProps/core.xml', core.replace('<dc:title></dc:title>', `<dc:title>${esc(project.title)}</dc:title>`));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
