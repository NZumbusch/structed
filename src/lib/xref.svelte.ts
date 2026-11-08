// Cross-references: "see section 2.3" where the number is a live link to a heading, so it
// follows when the outline is reordered or renumbered (also in footnotes and the Word export).
import { Extension, Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { db } from './db.svelte';
import { flatten, sectionNumber } from './ops';
import { ui, type MenuItem } from './ui.svelte';
import { matches } from './shortcuts';
import { t } from './i18n';

/** Open a menu of the project's sections at the caret; the chosen one is inserted as a reference. */
export function pickCrossRef(editor: Editor) {
  const pid = ui.projectId;
  if (!pid) return;
  const flat = flatten(pid);
  if (!flat.length) return void ui.toast(t('Add headings in the Outline first'), {}, 2500);
  let c = { left: 200, bottom: 200 };
  try {
    c = editor.view.coordsAtPos(editor.state.selection.head);
  } catch {
    /* not rendered */
  }
  const items: MenuItem[] = flat.map((f) => ({
    label: `${' '.repeat(Math.min(f.depth, 3))}${f.num}  ${f.h.title || t('Untitled')}`,
    run: () => editor.chain().focus().insertContent([{ type: 'sectionRef', attrs: { id: f.h.id } }, { type: 'text', text: ' ' }]).run()
  }));
  ui.contextMenu = { x: c.left, y: c.bottom + 4, items, title: t('Cross-reference to…') };
}

export const SectionRef = Node.create({
  name: 'sectionRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { id: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'span[data-section-ref]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-section-ref': '' })];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span');
      dom.className = 'xref';
      dom.contentEditable = 'false';
      let id = $state(String(node.attrs.id));
      const stop = $effect.root(() => {
        $effect(() => {
          const num = sectionNumber(id);
          const h = db.get('headings', id);
          dom.textContent = num ?? '?';
          dom.classList.toggle('missing', num == null);
          dom.title = num == null ? t('The section no longer exists') : `${num} ${h?.title ?? ''}\n${t('Click: go to the section · right-click: more')}`;
        });
      });
      const go = () => document.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      dom.addEventListener('click', (e) => {
        e.preventDefault();
        go();
      });
      dom.addEventListener('contextmenu', (e) => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        ui.openContext(e, [
          { label: t('Go to the section'), icon: 'chevron-right', run: go },
          { label: t('Refer to another section'), icon: 'edit', run: () => pos != null && (editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run(), pickCrossRef(editor)) },
          null,
          { label: t('Remove'), icon: 'trash', danger: true, run: () => pos != null && editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).run() }
        ]);
      });
      return {
        dom,
        update(n) {
          if (n.type.name !== 'sectionRef') return false;
          id = String(n.attrs.id);
          return true;
        },
        destroy: stop
      };
    };
  }
});

/** The configurable shortcut (Settings → Keyboard shortcuts) opens the section menu, in the text and in footnotes. */
export const CrossRefKey = Extension.create({
  name: 'crossRefKey',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleKeyDown: (_v, e) => {
            if (!matches(e, 'write.crossRef')) return false;
            pickCrossRef(editor);
            return true;
          }
        }
      })
    ];
  }
});
