// Every synced record is an Entity. Merging between devices is last-write-wins
// per entity (by `updatedAt`, tie-broken by `device`). Deletions are tombstones.

export interface EntityBase {
  id: string;
  createdAt: number;
  updatedAt: number;
  device: string;
  deleted?: boolean;
}

export type HeadingStatus = 'idea' | 'draft' | 'revise' | 'done';

export interface Project extends EntityBase {
  title: string;
  subtitle?: string;
  kind?: string; // essay, thesis, article...
  citationStyle?: string;
  citationLocale?: string;
  targetWords?: number;
  /** Word export: title page fields (workType, module, institution, supervisor, title, author, placeDate) */
  cover?: Record<string, string>;
  /** optional motto quote on its own page after the title page */
  mottoId?: string | null;
  /** linked Zotero collection: every source in it (or in a subcollection) belongs to the project */
  zoteroCollection?: ZoteroLink | null;
}

export interface ZoteroLink {
  library: string; // "users/123" | "groups/456"
  key: string; // the collection chosen
  name: string;
  /** the collection and its subcollections (refreshed when the project's sources are checked) */
  keys: string[];
}

export type ReadingStatus = 'toread' | 'reading' | 'read';

export interface Heading extends EntityBase {
  projectId: string;
  parentId: string | null;
  order: number;
  title: string;
  body: string; // markdown notes / gist
  /** final text of this section (ProseMirror JSON), written in the "Write" stage */
  draft?: string;
  status?: HeadingStatus;
  targetWords?: number;
}

/** Bibliographic source. `csl` holds CSL-JSON (as delivered by Zotero/citation-js). */
export interface Source extends EntityBase {
  csl: CSLItem;
  zoteroKey?: string;
  zoteroLibrary?: string; // e.g. "users/123" or "groups/456"
  /** keys of the Zotero collections the item is in (as last seen) */
  zoteroCollections?: string[];
  tags: string[];
  note?: string;
  reading?: ReadingStatus | null;
}

/** CSL locator labels offered for quotes */
export const LOCATOR_LABELS = ['page', 'column', 'paragraph', 'section', 'line', 'chapter', 'volume', 'folio', 'note', 'number', 'verse', 'sub-verbo', 'figure', 'table'] as const;
export type LocatorLabel = (typeof LOCATOR_LABELS)[number];

export type ArtifactKind = 'quote' | 'paraphrase' | 'note' | 'image';

export interface Artifact extends EntityBase {
  kind: ArtifactKind;
  sourceId?: string | null;
  title?: string; // short label shown when collapsed
  text: string; // the quote / paraphrase / note (markdown allowed for notes)
  fullText?: string; // optional longer context
  page?: string; // "12", "12-14", "xiv"
  /** what `page` counts: page (default), column, paragraph… (CSL locator label) */
  pageLabel?: LocatorLabel;
  /** secondary citation: the work quoted, as found in `sourceId` ("Kaufmann 1996, Sp. 1121, zit. nach …") */
  original?: { sourceId: string; page?: string; pageLabel?: LocatorLabel } | null;
  comment?: string;
  tags: string[];
  color?: string;
  imageId?: string; // blob id for kind=image
  zoteroKey?: string; // annotation key when imported
}

/** An artifact attached to a heading inside a project. One artifact can be placed many times. */
export interface Placement extends EntityBase {
  projectId: string;
  headingId: string;
  artifactId: string;
  order: number;
  note?: string; // context note: why it's here
}

export interface Comment extends EntityBase {
  projectId: string;
  targetId: string; // heading id or placement id
  text: string;
  resolved?: boolean;
}

export interface Tag extends EntityBase {
  name: string;
  color?: string;
}

/**
 * Project selection ("Auswahl"): items or whole sources the user wants for a project
 * before (or without) placing them under a heading. A whole source includes all of its
 * current and future items; `excluded` hides a single item of a selected source.
 */
export interface Selection extends EntityBase {
  projectId: string;
  refType: 'source' | 'artifact';
  refId: string;
  excluded?: boolean;
}

export interface Snapshot extends EntityBase {
  projectId: string;
  name: string;
  data: string; // JSON of project subset
}

/** Metadata for a binary blob (image). The bytes live in IndexedDB and in Drive. */
export interface BlobMeta extends EntityBase {
  mime: string;
  size: number;
  driveId?: string;
}

export interface Tables {
  projects: Project;
  headings: Heading;
  sources: Source;
  artifacts: Artifact;
  placements: Placement;
  comments: Comment;
  tags: Tag;
  snapshots: Snapshot;
  blobs: BlobMeta;
  selections: Selection;
}
export type TableName = keyof Tables;
export const TABLES: TableName[] = [
  'projects',
  'headings',
  'sources',
  'artifacts',
  'placements',
  'comments',
  'tags',
  'snapshots',
  'selections',
  'blobs'
];

export interface CSLName {
  family?: string;
  given?: string;
  literal?: string;
}
export interface CSLDate {
  'date-parts'?: (number | string)[][];
  raw?: string;
  literal?: string;
}
export interface CSLItem {
  id: string;
  type: string;
  title?: string;
  author?: CSLName[];
  editor?: CSLName[];
  issued?: CSLDate;
  'container-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  page?: string;
  volume?: string;
  issue?: string;
  DOI?: string;
  URL?: string;
  ISBN?: string;
  [k: string]: unknown;
}
