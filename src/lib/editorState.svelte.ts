// Light-weight bridge between the library panel and the (lazy-loaded) editor.
// Keeps TipTap out of the main bundle.
export type InsertMode = 'inline' | 'block' | 'footnote' | 'cite';

export interface EditorApi {
  headingId: string;
  insertArtifact(artifactId: string, mode: InsertMode, pos?: number): void;
  focus(): void;
}

class EditorState {
  active: EditorApi | null = $state(null);
  /** footnote being edited (opened by clicking a footnote marker) */
  footnote: { text: string; before: string; quoteId: string | null; after: string; save: (v: { before: string; quoteId: string | null; after: string }) => void; remove: () => void } | null = $state(null);
}
export const editorState = new EditorState();
