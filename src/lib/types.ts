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
}

export interface Heading extends EntityBase {
  projectId: string;
  parentId: string | null;
  order: number;
  title: string;
  body: string; // markdown
  status?: HeadingStatus;
  targetWords?: number;
}

/** Bibliographic source. `csl` holds CSL-JSON (as delivered by Zotero/citation-js). */
export interface Source extends EntityBase {
  csl: CSLItem;
  zoteroKey?: string;
  zoteroLibrary?: string; // e.g. "users/123" or "groups/456"
  tags: string[];
  note?: string;
}

export type ArtifactKind = 'quote' | 'paraphrase' | 'note' | 'image';

export interface Artifact extends EntityBase {
  kind: ArtifactKind;
  sourceId?: string | null;
  title?: string; // short label shown when collapsed
  text: string; // the quote / paraphrase / note (markdown allowed for notes)
  fullText?: string; // optional longer context
  page?: string; // "12", "12-14", "xiv"
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
