// TipTap editor for the final text. Quotes are *linked* nodes: they store only the
// artifact id and render text + citation live from the library, so edits to a quote
// or its page number update every place it is used.
import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { db } from './db.svelte';
import { settings } from './settings.svelte';
import { citeText, marks, oneLine, wordsOf } from './citecache.svelte';
import { editorState, type InsertMode } from './editorState.svelte';

/** Mount a reactive renderer into a node view; returns a cleanup function. */
function live(render: () => void) {
  return $effect.root(() => {
    $effect(render);
  });
}

function quoteParts(id: string) {
  const a = db.get('artifacts', id);
  if (!a) return { text: '⚠ ' + 'Zitat gelöscht', cite: '', a };
  return { text: oneLine(a.text), cite: citeText(a), a };
}

/** Inline linked quote ("„…“ (Autor, Jahr, S.)") or citation only. */
export const QuoteRef = Node.create({
  name: 'quoteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { id: { default: null }, mode: { default: 'inline' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-quote-ref]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-quote-ref': '' })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'qref';
      dom.contentEditable = 'false';
      let attrs = $state({ ...node.attrs });
      const stop = live(() => {
        const { text, cite, a } = quoteParts(attrs.id);
        dom.dataset.kind = a?.kind ?? 'missing';
        dom.replaceChildren();
        if (attrs.mode === 'cite') {
          dom.classList.add('cite-only');
          dom.textContent = cite || '(?)';
        } else {
          dom.classList.remove('cite-only');
          const [l, r] = marks();
          const q = document.createElement(settings.quoteItalic ? 'em' : 'span');
          q.textContent = text;
          dom.append(l, q, r, cite ? ' ' + cite : '');
        }
        dom.title = a ? `${a.text}${a.page ? ` – S. ${a.page}` : ''}` : '';
      });
      return {
        dom,
        update(n) {
          if (n.type.name !== 'quoteRef') return false;
          attrs = { ...n.attrs };
          return true;
        },
        destroy: stop
      };
    };
  }
});

/** Block quote linked to a library item (Word style "Zitat" + centered citation). */
export const QuoteBlock = Node.create({
  name: 'quoteBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { id: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'div[data-quote-block]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-quote-block': '' })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'qblock';
      dom.contentEditable = 'false';
      let attrs = $state({ ...node.attrs });
      const stop = live(() => {
        const { text, cite } = quoteParts(attrs.id);
        const [l, r] = marks();
        const t = document.createElement('p');
        t.className = 'qb-text';
        t.textContent = l + text + r;
        const c = document.createElement('p');
        c.className = 'qb-cite';
        c.textContent = cite;
        dom.replaceChildren(t, c);
      });
      return {
        dom,
        update(n) {
          if (n.type.name !== 'quoteBlock') return false;
          attrs = { ...n.attrs };
          return true;
        },
        destroy: stop
      };
    };
  }
});

/** Footnote: text before, an optional linked quote, text after. Numbered automatically. */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { before: { default: '' }, quoteId: { default: null }, after: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '' })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('sup');
      dom.className = 'fn';
      dom.contentEditable = 'false';
      dom.tabIndex = 0;
      let attrs = $state({ ...node.attrs });
      const stop = live(() => {
        const q = attrs.quoteId ? quoteParts(attrs.quoteId) : null;
        const [l, r] = marks();
        dom.title = [attrs.before, q ? `${l}${q.text}${r} ${q.cite}` : '', attrs.after].filter(Boolean).join(' ');
      });
      const open = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        editorState.footnote = {
          text: dom.title,
          before: attrs.before,
          quoteId: attrs.quoteId,
          after: attrs.after,
          save: (v) => editor.chain().command(({ tr }) => (tr.setNodeMarkup(pos, undefined, { ...v }), true)).run(),
          remove: () => editor.chain().deleteRange({ from: pos, to: pos + 1 }).run()
        };
      };
      dom.addEventListener('click', open);
      dom.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()));
      return {
        dom,
        update(n) {
          if (n.type.name !== 'footnote') return false;
          attrs = { ...n.attrs };
          return true;
        },
        destroy: stop
      };
    };
  }
});

export function createEditor(opts: {
  element: HTMLElement;
  content: string | undefined;
  placeholder: string;
  onChange: (json: string) => void;
  onFocus: () => void;
}) {
  let initial: object | string = '';
  try {
    initial = opts.content ? JSON.parse(opts.content) : '';
  } catch {
    initial = '';
  }
  return new Editor({
    element: opts.element,
    content: initial,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        link: false
      }),
      Placeholder.configure({ placeholder: opts.placeholder }),
      QuoteRef,
      QuoteBlock,
      Footnote
    ],
    editorProps: {
      attributes: {
        class: 'prose',
        spellcheck: String(settings.editorSpellcheck),
        lang: settings.editorLang
      }
    },
    onUpdate: ({ editor }) => opts.onChange(JSON.stringify(editor.getJSON())),
    onFocus: () => opts.onFocus()
  });
}

/** Decide the node for an artifact and insertion mode. */
export function insertArtifact(editor: Editor, artifactId: string, mode: InsertMode, pos?: number) {
  const a = db.get('artifacts', artifactId);
  if (!a) return;
  let m = mode;
  // long quotes become block quotes (APA: 40+ words), notes are inserted as text
  if (m === 'inline' && settings.autoBlockWords > 0 && a.kind === 'quote' && wordsOf(a.text) >= settings.autoBlockWords) m = 'block';
  const chain = editor.chain().focus();
  if (pos != null) chain.setTextSelection(pos);
  if (a.kind === 'note' || (a.kind === 'paraphrase' && m === 'inline')) {
    // own notes / paraphrases: insert their text (editable), plus citation for paraphrases
    chain.insertContent([{ type: 'text', text: oneLine(a.text) + ' ' }, ...(a.sourceId ? [{ type: 'quoteRef', attrs: { id: a.id, mode: 'cite' } }] : [])]).run();
    return;
  }
  if (m === 'block') chain.insertContent({ type: 'quoteBlock', attrs: { id: a.id } }).run();
  else if (m === 'footnote') chain.insertContent({ type: 'footnote', attrs: { before: '', quoteId: a.id, after: '' } }).run();
  else chain.insertContent({ type: 'quoteRef', attrs: { id: a.id, mode: m } }).run();
}

/** Plain text of a draft (for word counts and search). */
export function draftText(json: string | undefined): string {
  if (!json) return '';
  try {
    const out: string[] = [];
    const walk = (n: { type?: string; text?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
      if (n.text) out.push(n.text);
      if (n.type === 'quoteRef' || n.type === 'quoteBlock') {
        const a = db.get('artifacts', String(n.attrs?.id));
        if (a && n.attrs?.mode !== 'cite') out.push(a.text);
      }
      (n.content as (typeof n)[] | undefined)?.forEach(walk);
      if (n.type === 'paragraph') out.push('\n');
    };
    walk(JSON.parse(json));
    return out.join(' ');
  } catch {
    return '';
  }
}
