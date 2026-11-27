// The Write editor's typing helpers (see prosefield.ts) for the CodeMirror markdown editor.
import { EditorView, keymap, MatchDecorator, Decoration, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { settings, textLang } from './settings.svelte';
import { NBSP } from './typing';
import { autoType } from './prosefield';

/**
 * The same helpers for the CodeMirror (markdown) editor of the outline notes.
 */
export function proseCodeMirror() {
  let last: { at: number; was: string; now: string } | null = null;
  const input = EditorView.inputHandler.of((view, from, to, text) => {
    if (text.length !== 1 || view.composing) return false;
    const line = view.state.doc.lineAt(from);
    const r = autoType(line.text.slice(0, from - line.from), text, { markdown: true });
    if (!r) return false;
    const start = line.from + r.from;
    const was = view.state.sliceDoc(start, from) + text;
    view.dispatch({
      changes: { from: start, to, insert: r.insert },
      selection: { anchor: start + r.insert.length },
      userEvent: 'input.type',
      scrollIntoView: true
    });
    last = { at: start + r.insert.length, was, now: r.insert };
    return true;
  });
  const keys = Prec.high(
    keymap.of([
      {
        key: 'Backspace',
        run: (view) => {
          const l = last;
          last = null;
          const sel = view.state.selection.main;
          if (!l || !sel.empty || sel.head !== l.at || view.state.sliceDoc(l.at - l.now.length, l.at) !== l.now) return false;
          view.dispatch({ changes: { from: l.at - l.now.length, to: l.at, insert: l.was }, userEvent: 'delete.backward' });
          return true;
        }
      },
      {
        key: 'Mod-Shift-Space',
        run: (view) => {
          view.dispatch(view.state.replaceSelection(NBSP));
          return true;
        }
      }
    ])
  );
  // forget the last change once something else happens
  const reset = EditorView.updateListener.of((u) => {
    if (!last) return;
    if (u.docChanged && !u.transactions.some((tr) => tr.isUserEvent('input.type') || tr.isUserEvent('delete.backward'))) last = null;
    else if (u.selectionSet && !u.docChanged) last = null;
  });
  // a faint mark under each non-breaking space, as in the Write editor
  const nbspMarks = new MatchDecorator({ regexp: /\u00a0/g, decoration: Decoration.mark({ class: 'nbsp' }) });
  const marks = ViewPlugin.define((view) => ({ deco: nbspMarks.createDeco(view) as DecorationSet, update(u) { this.deco = nbspMarks.updateDeco(u, this.deco); } }), {
    decorations: (v) => v.deco
  });
  return [input, keys, reset, marks, EditorView.contentAttributes.of({ spellcheck: String(settings.editorSpellcheck), lang: textLang() })];
}
