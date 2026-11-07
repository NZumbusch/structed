// Light-weight bridge between the library panel and the (lazy-loaded) editor.
// Keeps TipTap out of the main bundle.
export type InsertMode = 'inline' | 'editable' | 'block' | 'footnote' | 'cite';

export interface EditorApi {
  headingId: string;
  insertArtifact(artifactId: string, mode: InsertMode, pos?: number): void;
  focus(): void;
}

class EditorState {
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
