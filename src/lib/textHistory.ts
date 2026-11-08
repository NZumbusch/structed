// Version history of the written text, in small steps: a version is kept whenever a
// sentence was finished, and at least every 30 seconds while writing. It lives in its own
// local database on this device (not in the backup or the sync), is written after the
// text is saved, and is thinned out as it ages, so it costs nothing while typing.
import { openDB, type IDBPDatabase } from 'idb';

export interface TextVersion {
  id?: number;
  headingId: string;
  at: number;
  /** ProseMirror JSON of the section */
  draft: string;
  words: number;
}

const MIN_GAP = 30_000; // at least this long between versions, unless a sentence was finished
const SENTENCE_GAP = 3_000; // never more often than this
const KEEP_ALL = 24 * 3600_000; // keep every version of the last day; older: one per hour, older than 30 days: one per day

let dbp: Promise<IDBPDatabase> | null = null;
function store() {
  dbp ??= openDB('structed-history', 1, {
    upgrade(db) {
      const s = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
      s.createIndex('heading', ['headingId', 'at']);
    }
  });
  return dbp;
}

const last = new Map<string, { at: number; sentences: number; draft: string }>();
const sentenceEnds = (plain: string) => (plain.match(/[.!?…](\s|$)/g) ?? []).length;

/** Called after a section's text was saved. Decides cheaply whether to keep a version. */
export async function recordVersion(headingId: string, draft: string, plain: string, words: number, now = Date.now(), force = false) {
  try {
    let prev = last.get(headingId);
    if (!prev) {
      const latest = (await versions(headingId)).at(-1);
      prev = latest ? { at: latest.at, sentences: -1, draft: latest.draft } : { at: 0, sentences: -1, draft: '' };
    }
    if (draft === prev.draft) return;
    const sentences = sentenceEnds(plain);
    const finished = prev.sentences >= 0 && sentences !== prev.sentences;
    const gap = now - prev.at;
    if (!force && !(gap >= MIN_GAP || (finished && gap >= SENTENCE_GAP))) {
      if (prev.sentences < 0) last.set(headingId, { ...prev, sentences });
      return;
    }
    last.set(headingId, { at: now, sentences, draft });
    const db = await store();
    await db.add('versions', { headingId, at: now, draft, words } satisfies TextVersion);
    if (Math.random() < 0.05) void thin(headingId, now);
  } catch {
    /* no IndexedDB (private mode): no history */
  }
}

/** All versions of a section, oldest first. */
export async function versions(headingId: string): Promise<TextVersion[]> {
  try {
    const db = await store();
    return (await db.getAllFromIndex('versions', 'heading', IDBKeyRange.bound([headingId, 0], [headingId, Infinity]))) as TextVersion[];
  } catch {
    return [];
  }
}

/** Older versions are thinned out: one per hour after a day, one per day after a month. */
export async function thin(headingId: string, now = Date.now()) {
  const all = await versions(headingId);
  const db = await store();
  const seen = new Set<string>();
  for (const v of [...all].reverse()) {
    const age = now - v.at;
    if (age < KEEP_ALL) continue;
    const bucket = age < 30 * KEEP_ALL ? Math.floor(v.at / 3600_000) : Math.floor(v.at / KEEP_ALL) + 'd';
    if (seen.has(String(bucket))) await db.delete('versions', v.id!);
    else seen.add(String(bucket));
  }
}

/** for tests */
export function forgetLast() {
  last.clear();
}
