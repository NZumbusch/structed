// One undo history for all sections in Write, like a single Word document: Ctrl+Z undoes
// the most recent change in whichever section it happened, and jumps there. Each section
// keeps its own ProseMirror history; this only remembers the order of their changes.
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { closeHistory, undoDepth } from '@tiptap/pm/history';

export class SharedHistory {
  private undos: string[] = [];
  private redos: string[] = [];
  private depth = new Map<string, number>();
  private replaying = false;

  constructor(
    private get: (id: string) => Editor | undefined,
    private reveal: (id: string, editor: Editor) => void
  ) {}

  /** Call for every transaction of a section's editor. */
  track(id: string, editor: Editor, tr: Transaction) {
    const d = undoDepth(editor.state);
    const old = this.depth.get(id) ?? 0;
    this.depth.set(id, d);
    if (this.replaying || !tr.docChanged || tr.getMeta('addToHistory') === false) return;
    if (d > old) this.undos.push(id); // a new undo step (changes typed in quick succession are one step)
    this.redos = [];
  }

  /** A section got the cursor: its next change starts a new step, so steps never span a switch. */
  entered(editor: Editor) {
    editor.view.dispatch(closeHistory(editor.state.tr));
  }

  undo(): boolean {
    return this.step(this.undos, this.redos, (e) => e.commands.undo());
  }
  redo(): boolean {
    return this.step(this.redos, this.undos, (e) => e.commands.redo());
  }
  get canUndo() {
    return this.undos.length > 0;
  }
  get canRedo() {
    return this.redos.length > 0;
  }

  private step(from: string[], to: string[], run: (e: Editor) => boolean): boolean {
    while (from.length) {
      const id = from.pop()!;
      const e = this.get(id);
      if (!e) continue;
      this.replaying = true;
      let ok = false;
      try {
        ok = run(e);
      } finally {
        this.replaying = false;
      }
      if (!ok) continue;
      to.push(id);
      this.reveal(id, e);
      return true;
    }
    return false;
  }
}
