// Comments on a passage of the text ("check this source"). The comment lives in the text
// itself, as a mark carrying its words: undo, sync, snapshots and copies keep it with the
// passage, and exports simply leave it out.
import { Mark, mergeAttributes, type Editor } from '@tiptap/core';

export const TextComment = Mark.create({
  name: 'textComment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-comment') },
      text: { default: '', parseHTML: (el) => el.getAttribute('title') ?? '' }
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const { id, text, ...rest } = HTMLAttributes;
    return ['span', mergeAttributes(rest, { class: 'tc', 'data-comment': id, title: text || '' }), 0];
  }
});

export interface CommentAt {
  id: string;
  text: string;
  from: number;
  to: number;
}

/** The comment at the cursor, if the cursor is in (or right at the edge of) a commented passage. */
export function commentAt(editor: Editor): CommentAt | null {
  const type = editor.schema.marks.textComment;
  if (!type) return null;
  const $h = editor.state.selection.$head;
  const marks = [...$h.marks(), ...($h.nodeAfter?.marks ?? []), ...($h.nodeBefore?.marks ?? [])];
  const m = marks.find((x) => x.type === type);
  if (!m) return null;
  return findComment(editor, String(m.attrs.id));
}

/** Where the comment with this id is (it may be split by formatting; the whole span counts). */
export function findComment(editor: Editor, id: string): CommentAt | null {
  const type = editor.schema.marks.textComment;
  let from = -1;
  let to = -1;
  let text = '';
  editor.state.doc.descendants((n, pos) => {
    const m = n.marks.find((x) => x.type === type && x.attrs.id === id);
    if (!m) return;
    if (from < 0) from = pos;
    to = pos + n.nodeSize;
    text = String(m.attrs.text ?? '');
  });
  return from < 0 ? null : { id, text, from, to };
}

export function setCommentText(editor: Editor, c: CommentAt, text: string) {
  const type = editor.schema.marks.textComment;
  // only this comment's mark: an overlapping comment on the same words stays
  editor.view.dispatch(editor.state.tr.removeMark(c.from, c.to, type.create({ id: c.id, text: c.text })).addMark(c.from, c.to, type.create({ id: c.id, text })));
}

export function removeComment(editor: Editor, c: CommentAt) {
  const type = editor.schema.marks.textComment;
  editor.view.dispatch(editor.state.tr.removeMark(c.from, c.to, type.create({ id: c.id, text: c.text })));
}

/** Comment the selected text; returns the new comment (empty until its words are written). */
export function addComment(editor: Editor): CommentAt | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const id = Math.random().toString(36).slice(2, 10);
  const type = editor.schema.marks.textComment;
  editor.view.dispatch(editor.state.tr.addMark(from, to, type.create({ id, text: '' })));
  return { id, text: '', from, to };
}
