// TipTap editor for the final text. Quotes are *linked* nodes: they store only the
// artifact id and render text + citation live from the library, so edits to a quote
// or its page number update every place it is used.
import { Editor, Extension, InputRule, Node, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { db } from './db.svelte';
import { settings, textLang } from './settings.svelte';
import { citeText, marks, noteCite, oneLine, wordsOf } from './citecache.svelte';
import { editorState, type InsertMode } from './editorState.svelte';
import { ui, type MenuItem } from './ui.svelte';
import { longpress } from './longpress';
import { artifactLabel, shortCite } from './ops';
import { editableQuote, footnoteContent, footnotePlain, toClipboard, type PMNode } from './footnote';
import { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
export { editableQuote };
import { t } from './i18n';
import { FindHighlight, NonBreaking, SmartQuotes } from './typing';
import { joinPdfLines } from './ocr';
import { CrossRefKey, SectionRef } from './xref.svelte';
import { prefixChoices, prefixText, splitPrefix } from './citePrefix';
import { TextComment } from './textComment';
import { ReadabilityHints } from './hints';
const tr = t; // where `t` is shadowed

type QuoteForm = 'inline' | 'cite' | 'block' | 'footnote';

/** Show a linked quote in another form: quote + citation, citation only, block quote, footnote. */
export function setQuoteForm(editor: Editor, pos: number, form: QuoteForm) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const id = String(node.attrs.id);
  const range = { from: pos, to: pos + node.nodeSize };
  const ref = (mode: 'inline' | 'cite') => ({ type: 'quoteRef', attrs: { id, mode } });
  const chain = editor.chain().focus();
  if (node.type.name === 'quoteRef') {
    if (form === 'inline' || form === 'cite') return chain.command(({ tr }) => (tr.setNodeMarkup(pos, undefined, { ...node.attrs, mode: form }), true)).run();
    if (form === 'block') return chain.insertContentAt(range, { type: 'quoteBlock', attrs: { id } }).run();
    return chain.insertContentAt(range, { type: 'footnote', attrs: { content: [ref('inline')] } }).run();
  }
  if (node.type.name === 'quoteBlock') {
    if (form === 'block') return true;
    const inner = form === 'footnote' ? { type: 'footnote', attrs: { content: [ref('inline')] } } : ref(form);
    return chain.insertContentAt(range, { type: 'paragraph', content: [inner] }).run();
  }
  return false;
}

function quoteMenu(e: MouseEvent, editor: Editor, getPos: (() => number | undefined) | boolean) {
  const pos = typeof getPos === 'function' ? getPos() : undefined;
  if (pos == null) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  e.preventDefault();
  e.stopPropagation();
  const id = String(node.attrs.id);
  const a = db.get('artifacts', id);
  const cur: QuoteForm = node.type.name === 'quoteBlock' ? 'block' : node.attrs.mode === 'cite' ? 'cite' : 'inline';
  const forms: { f: QuoteForm; label: string; icon: string }[] = [
    { f: 'inline', label: 'Quote + citation', icon: 'quote' },
    { f: 'cite', label: 'Citation only', icon: 'link' },
    ...(editor.schema.nodes.quoteBlock ? [{ f: 'block' as const, label: 'Block quote', icon: 'paraphrase' }] : []),
    ...(editor.schema.nodes.footnote ? [{ f: 'footnote' as const, label: 'In a footnote', icon: 'note' }] : [])
  ];
  const items: MenuItem[] = forms.map((x) => ({
    label: t(x.label),
    icon: x.f === cur ? 'check' : x.icon,
    run: () => {
      if (x.f !== cur) setQuoteForm(editor, pos, x.f);
    }
  }));
  if (node.type.name === 'quoteRef') {
    // a word that belongs to the citation, shown in front of it ("Vgl.", "siehe")
    const cur = (node.attrs.prefix as string | null) ?? '';
    const setPrefix = (p: string | null) => editor.chain().focus().command(({ tr }) => (tr.setNodeMarkup(pos, undefined, { ...node.attrs, prefix: p || null }), true)).run();
    const choices = [...new Set([...prefixChoices(), ...(cur ? [cur] : [])])];
    items.push(
      null,
      { label: t('No word in front'), icon: !cur ? 'check' : undefined, run: () => setPrefix(null) },
      ...choices.map((p) => ({ label: `${t('In front')}: ${p}`, icon: cur.toLowerCase() === p.toLowerCase() ? 'check' : undefined, run: () => setPrefix(p) })),
      {
        label: t('Other word in front…'),
        run: () => {
          const v = prompt(t('Word in front of the citation, e.g. “vgl.”, “siehe”, “dazu”'), cur);
          if (v !== null) setPrefix(v.trim());
        }
      }
    );
  }
  items.push(
    null,
    { label: t('As editable text'), icon: 'edit', run: () => (cur === 'cite' ? setQuoteForm(editor, pos, 'inline') && makeEditable(editor, pos) : makeEditable(editor, pos)) },
    null,
    ...(a ? [{ label: t('Edit quote in library'), icon: 'quote', run: () => (ui.editArtifact = { id }) }] : []),
    { label: t('Remove'), icon: 'trash', danger: true, run: () => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run() }
  );
  ui.contextMenu = { x: e.clientX, y: e.clientY, items, title: a ? shortCite(a) || artifactLabel(a, 40) : undefined };
}

/** Right-click, double-click and (touch) long-press open the quote menu; returns a cleanup. */
function menuEvents(dom: HTMLElement, editor: Editor, getPos: (() => number | undefined) | boolean) {
  dom.addEventListener('contextmenu', (e) => quoteMenu(e, editor, getPos));
  dom.addEventListener('dblclick', (e) => quoteMenu(e, editor, getPos));
  let at = { x: 0, y: 0 };
  dom.addEventListener('pointerdown', (e) => (at = { x: e.clientX, y: e.clientY }));
  const lp = longpress(dom, { run: () => quoteMenu(new MouseEvent('contextmenu', { clientX: at.x, clientY: at.y }), editor, getPos) });
  return () => lp.destroy();
}

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
export const QuoteRef = Node.create<{ inNote: boolean }>({
  name: 'quoteRef',
  addOptions() {
    return { inNote: false }; // true in the footnote editor: the citation is shown as in a footnote
  },
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    // prefix: a word that belongs to the citation ("Vgl.", "s.", "zit. nach"), shown in front of it
    return { id: { default: null }, mode: { default: 'inline' }, prefix: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-quote-ref]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-quote-ref': '' })];
  },
  addNodeView() {
    const inNote = this.options.inNote;
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span');
      dom.className = 'qref';
      const unmenu = menuEvents(dom, editor, getPos);
      dom.contentEditable = 'false';
      let attrs = $state({ ...node.attrs });
      /** the text just before: '' at the start of a paragraph, null after another quote/footnote */
      const textBefore = (): string | null => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos == null) return '';
        try {
          const rp = editor.state.doc.resolve(pos);
          if (rp.parentOffset === 0) return '';
          const b = rp.nodeBefore;
          return b?.isText ? (b.text ?? '').slice(-8) : null;
        } catch {
          return '';
        }
      };
      let before = $state<string | null>('');
      queueMicrotask(() => (before = textBefore()));
      const stop = live(() => {
        const { text, cite: raw, a } = quoteParts(attrs.id);
        const cite = inNote ? noteCite(raw, attrs.mode, before ?? '') : raw;
        const pre = prefixText(attrs.prefix, before);
        dom.dataset.kind = a?.kind ?? 'missing';
        dom.replaceChildren();
        if (attrs.mode === 'cite') {
          dom.classList.add('cite-only');
          dom.textContent = pre + (cite || '(?)');
        } else {
          dom.classList.remove('cite-only');
          const [l, r] = marks();
          const q = document.createElement(settings.quoteItalic ? 'em' : 'span');
          q.textContent = text;
          dom.append(pre + l, q, r, cite ? ' ' + cite : '');
        }
        dom.title = (a ? `${a.text}${a.page ? ` – S. ${a.page}` : ''}\n\n` : '') + t('Right-click or double-click: show differently');
      });
      return {
        dom,
        update(n) {
          if (n.type.name !== 'quoteRef') return false;
          attrs = { ...n.attrs };
          before = textBefore();
          return true;
        },
        destroy: () => (stop(), unmenu())
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
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'qblock';
      const unmenu = menuEvents(dom, editor, getPos);
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
        dom.title = tr('Right-click or double-click: show differently');
      });
      return {
        dom,
        update(n) {
          if (n.type.name !== 'quoteBlock') return false;
          attrs = { ...n.attrs };
          return true;
        },
        destroy: () => (stop(), unmenu())
      };
    };
  }
});

/**
 * Footnote: free text with any number of linked quotes and citations (`content`, inline
 * ProseMirror JSON), numbered automatically. Older footnotes stored text before, one
 * quote and text after; they are read through `footnoteContent`.
 */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { content: { default: null }, before: { default: '' }, quoteId: { default: null }, quoteText: { default: null }, after: { default: '' } };
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
        dom.title = footnotePlain(footnoteContent(attrs));
      });
      const open = () => {
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return;
        editorState.footnote = {
          content: footnoteContent(attrs),
          // history: false while typing (autosave); the last save is one undo step
          save: (content, history = true) =>
            editor
              .chain()
              .command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, { content, before: '', quoteId: null, quoteText: null, after: '' });
                if (!history) tr.setMeta('addToHistory', false);
                return true;
              })
              .run(),
          remove: () => editor.chain().deleteRange({ from: pos, to: pos + 1 }).run(),
          // back in the text, right after the footnote marker
          focusAfter: () => {
            if (editor.isDestroyed) return;
            const still = editor.state.doc.nodeAt(pos)?.type.name === 'footnote'; // (an empty new one is removed)
            editor.chain().focus().setTextSelection(Math.min(pos + (still ? 1 : 0), editor.state.doc.content.size)).run();
          }
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

/**
 * Like Word: "word - word" becomes "word – word" (en dash) as soon as the word after
 * the hyphen is finished. Hyphens inside words (E-Mail, 12-14) stay. Backspace right
 * after the change brings the hyphen back.
 */
export const AutoDash = Extension.create({
  name: 'autoDash',
  addInputRules() {
    return [
      new InputRule({
        find: /(?:^|[^\s-])( -) [^\s-][^\s]*?([\s.,;:!?)\]»«“”"'…])$/,
        handler: ({ state, range, match }) => {
          if (!settings.editorAutoDash) return null;
          const dash = range.from + match[0].indexOf(' -') + 1;
          const typed = match[2];
          state.tr.insertText('–', dash, dash + 1).insertText(typed, range.to);
        }
      })
    ];
  }
});

/**
 * Typing "@" starts a citation search right in the text ("@nora 31"): the list of
 * suggestions follows the caret; Enter or Tab inserts the citation (Name, year, page).
 * The "@" must start a word, so e-mail addresses do not trigger it. Esc closes it.
 */
export const CiteTrigger = Extension.create({
  name: 'citeTrigger',
  addProseMirrorPlugins() {
    const editor = this.editor;
    const find = (state: import('@tiptap/pm/state').EditorState) => {
      const sel = state.selection;
      if (!sel.empty) return null;
      const at = sel.$from;
      if (!at.parent.isTextblock) return null;
      const before = at.parent.textBetween(0, at.parentOffset, undefined, '\ufffc');
      const m = /(?:^|[\s(\[„“"'])@([^@\n\ufffc]{0,40})$/.exec(before);
      if (!m || /\s{2}$/.test(m[1])) return null;
      const from = at.pos - m[1].length - 1;
      return { from, to: at.pos, query: m[1] };
    };
    return [
      new Plugin({
        view: () => ({
          update: (view) => {
            const f = editor.isFocused || view.hasFocus() ? find(view.state) : null;
            const gone = editorState.dismissed.get(editor);
            if (!f || gone === f.from) {
              if (editorState.mention?.editor === editor) editorState.mention = null;
              return;
            }
            const c = view.coordsAtPos(f.from);
            editorState.mention = { editor, ...f, left: c.left, top: c.top, bottom: c.bottom };
          },
          destroy: () => {
            if (editorState.mention?.editor === editor) editorState.mention = null;
          }
        }),
        props: {
          handleKeyDown: (_view, e) => {
            const m = editorState.mention;
            if (!m || m.editor !== editor) return false;
            if (e.key === 'Escape') {
              editorState.dismissed.set(editor, m.from);
              editorState.mention = null;
              e.stopPropagation();
              return true;
            }
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) return editorState.mentionKey?.(e.key) ?? false;
            return false;
          }
        }
      })
    ];
  }
});

/**
 * Copy and cut: other programs get the text with each quote's citation and the footnotes
 * numbered below (HTML and plain text); pasting back into Structed keeps quotes linked.
 */
const CLIP = 'application/x-structed';
function copySelection(view: EditorView, e: ClipboardEvent, cut: boolean) {
  const sel = view.state.selection;
  if (sel.empty || !e.clipboardData) return false;
  const slice = sel.content();
  const { html, text } = toClipboard(slice.content.toJSON() as PMNode[]);
  e.clipboardData.setData('text/html', html);
  e.clipboardData.setData('text/plain', text);
  e.clipboardData.setData(CLIP, JSON.stringify(slice.toJSON()));
  e.preventDefault();
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
  return true;
}
function pasteOwn(view: EditorView, e: ClipboardEvent) {
  const raw = e.clipboardData?.getData(CLIP);
  if (!raw) return false;
  try {
    const slice = Slice.fromJSON(view.state.schema, JSON.parse(raw));
    view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView().setMeta('uiEvent', 'paste'));
    return true;
  } catch {
    return false; // e.g. a block quote pasted into a footnote: fall back to the text
  }
}
const clipboardProps = {
  // text from a PDF: join its broken lines (Ctrl+Shift+V pastes without formatting, as in Word)
  transformPastedText: (text: string) => joinPdfLines(text),
  handleDOMEvents: {
    copy: (view: EditorView, e: Event) => copySelection(view, e as ClipboardEvent, false),
    cut: (view: EditorView, e: Event) => copySelection(view, e as ClipboardEvent, true)
  },
  handlePaste: (view: EditorView, e: ClipboardEvent) => pasteOwn(view, e)
};

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y go through the shared history of all sections (Write). */
const SharedUndo = Extension.create({
  name: 'sharedUndo',
  priority: 1000,
  addKeyboardShortcuts() {
    const undo = () => editorState.history?.undo() ?? false;
    const redo = () => editorState.history?.redo() ?? false;
    return { 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo };
  }
});

/** Marks the top-level block holding the caret with `.focus-cur` (focus mode dims the rest). */
export const CurrentBlock = Extension.create({
  name: 'currentBlock',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const head = state.selection.$head;
            if (head.depth < 1) {
              // a selected top-level node (e.g. a block quote)
              const n = state.doc.nodeAt(head.pos);
              return n ? DecorationSet.create(state.doc, [Decoration.node(head.pos, head.pos + n.nodeSize, { class: 'focus-cur' })]) : null;
            }
            const start = head.before(1);
            return DecorationSet.create(state.doc, [Decoration.node(start, start + head.node(1).nodeSize, { class: 'focus-cur' })]);
          }
        }
      })
    ];
  }
});

/**
 * The small editor inside the footnote dialog: the same text features as the main text
 * (marks, linked quotes and citations, dash), without blocks, lists or nested footnotes.
 */
export function createFootnoteEditor(opts: { element: HTMLElement; content: PMNode[]; placeholder: string }) {
  return new Editor({
    element: opts.element,
    content: { type: 'doc', content: [{ type: 'paragraph', content: opts.content.length ? opts.content : undefined }] },
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        link: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false
      }),
      Placeholder.configure({ placeholder: opts.placeholder }),
      QuoteRef.configure({ inNote: true }),
      SectionRef,
      CrossRefKey,
      AutoDash,
      SmartQuotes,
      NonBreaking,
      CiteTrigger
    ],
    editorProps: {
      ...clipboardProps,
      attributes: { class: 'prose fnprose', spellcheck: String(settings.editorSpellcheck), lang: textLang() }
    }
  });
}

/** Inline content of the footnote editor; paragraphs become line breaks (a footnote is one paragraph). */
export function footnoteEditorContent(editor: Editor): PMNode[] {
  const paras = (editor.getJSON().content ?? []) as PMNode[];
  const out: PMNode[] = [];
  paras.forEach((p, i) => {
    if (i && (p.content?.length || 0)) out.push({ type: 'hardBreak' });
    out.push(...(p.content ?? []));
  });
  return out;
}

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
      TextComment,
      SectionRef,
      CrossRefKey,
      Footnote,
      CurrentBlock,
      SharedUndo,
      AutoDash,
      SmartQuotes,
      NonBreaking,
      FindHighlight,
      ReadabilityHints,
      CiteTrigger
    ],
    editorProps: {
      ...clipboardProps,
      attributes: {
        class: 'prose',
        spellcheck: String(settings.editorSpellcheck),
        lang: textLang()
      }
    },
    onUpdate: ({ editor }) => opts.onChange(JSON.stringify(editor.getJSON())),
    onFocus: () => opts.onFocus()
  });
}

/**
 * Insert a citation (citation only) over [from, to]; a word typed right before it ("vgl. ",
 * "s. ") becomes part of the citation, exactly as written.
 */
export function insertCitation(editor: Editor, from: number, to: number, id: string) {
  const at = editor.state.doc.resolve(from);
  const before = at.parent.textBetween(0, at.parentOffset, undefined, '\ufffc');
  const sp = splitPrefix(before);
  const cut = sp ? before.length - sp.keep.length : 0;
  // only plain text: an italic "vgl." stays text with its formatting
  let marked = false;
  if (sp) editor.state.doc.nodesBetween(from - cut, from, (n) => void (n.isText && n.marks.length && (marked = true)));
  const plain = !!sp && !marked;
  const start = plain ? from - cut : from;
  return editor
    .chain()
    .focus()
    .insertContentAt({ from: start, to }, { type: 'quoteRef', attrs: { id, mode: 'cite', prefix: plain ? sp!.prefix : null } })
    .run();
}

/** Decide the node for an artifact and insertion mode. */
export function insertArtifact(editor: Editor, artifactId: string, mode: InsertMode, pos?: number) {
  const a = db.get('artifacts', artifactId);
  if (!a) return;
  let m = mode;
  // long quotes become block quotes (APA: 40+ words), notes are inserted as text
  if (m === 'inline' && settings.autoBlockWords > 0 && a.kind === 'quote' && wordsOf(a.text) >= settings.autoBlockWords) m = 'block';
  editor.view.focus(); // at once, so typing right after the insert lands in the text
  const chain = editor.chain().focus();
  if (pos != null) chain.setTextSelection(pos);
  if (a.kind === 'note' || (a.kind === 'paraphrase' && m === 'inline')) {
    // own notes / paraphrases: insert their text (editable), plus citation for paraphrases
    chain.insertContent([{ type: 'text', text: oneLine(a.text) + ' ' }, ...(a.sourceId ? [{ type: 'quoteRef', attrs: { id: a.id, mode: 'cite' } }] : [])]).run();
    return;
  }
  if (m === 'editable') {
    chain.insertContent(editableQuote(a.id)).run();
    return;
  }
  if (m === 'block') chain.insertContent({ type: 'quoteBlock', attrs: { id: a.id } }).run();
  else if (m === 'footnote') chain.insertContent({ type: 'footnote', attrs: { content: [{ type: 'quoteRef', attrs: { id: a.id, mode: 'inline' } }] } }).run();
  else if (m === 'cite') {
    chain.run();
    const { from, to } = editor.state.selection;
    insertCitation(editor, from, to, a.id);
  } else chain.insertContent({ type: 'quoteRef', attrs: { id: a.id, mode: m } }).run();
}

/** Replace the linked quote node at `pos` by editable text (keeps the citation linked). */
export function makeEditable(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const id = String(node.attrs.id);
  if (node.type.name === 'quoteRef' && node.attrs.mode !== 'cite') {
    return editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, editableQuote(id)).run();
  }
  if (node.type.name === 'quoteBlock') {
    return editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: 'blockquote', content: [{ type: 'paragraph', content: editableQuote(id) }] })
      .run();
  }
  return false;
}

/** The linked quote node currently selected (tap/click on it), if any. */
export function selectedQuotePos(editor: Editor): number | null {
  const sel = editor.state.selection as { node?: { type: { name: string }; attrs: Record<string, unknown> }; from: number };
  const n = sel.node;
  if (n && ((n.type.name === 'quoteRef' && n.attrs.mode !== 'cite') || n.type.name === 'quoteBlock')) return sel.from;
  return null;
}

export { draftText, charCount } from './draft';

/** Plain text of the editor's current selection (quotes with their text), '' if nothing is selected. */
export function selectionText(editor: Editor): string {
  const sel = editor.state.selection;
  // a clicked quote (node selection) is not "selected text"
  if (sel.empty || 'node' in sel) return '';
  const { from, to } = sel;
  return editor.state.doc.textBetween(from, to, '\n', (n) => {
    if (n.type.name !== 'quoteRef' && n.type.name !== 'quoteBlock') return n.type.name === 'hardBreak' ? '\n' : '';
    const a = db.get('artifacts', String(n.attrs.id));
    if (!a || n.attrs.mode === 'cite') return '';
    const [l, r] = marks();
    return l + oneLine(a.text) + r;
  });
}
