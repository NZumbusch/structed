// Light-weight bridge between the library panel and the (lazy-loaded) editor.
// Keeps TipTap out of the main bundle.
export type InsertMode = 'inline' | 'editable' | 'block' | 'footnote' | 'cite';

export interface EditorApi {
  headingId: string;
  insertArtifact(artifactId: string, mode: InsertMode, pos?: number): void;
  focus(): void;
}

/** "@…" typed in a text: where, and what is being searched (drives the suggestion list) */
export interface Mention {
  editor: import('@tiptap/core').Editor;
  from: number; // position of the "@"
  to: number; // the cursor
  query: string;
  left: number;
  top: number;
  bottom: number;
}

class EditorState {
  mention: Mention | null = $state(null);
  /** set by the suggestion list: handles ↑ ↓ Enter Tab while it is open; true = handled */
  mentionKey: ((key: string) => boolean) | null = null;
  /** "@" positions closed with Esc (per editor), so they do not open again */
  dismissed = new WeakMap<object, number>();

  active: EditorApi | null = $state(null);
  /** footnote being edited (opened by clicking a footnote marker) */
  footnote: {
    /** free text with linked quotes and citations (inline ProseMirror JSON) */
    content: import('./footnote').PMNode[];
    save: (content: import('./footnote').PMNode[]) => void;
    remove: () => void;
  } | null = $state(null);
}
export const editorState = new EditorState();
