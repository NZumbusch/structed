import { openDB, type IDBPDatabase } from 'idb';
import { TABLES, type EntityBase, type TableName, type Tables } from './types';

export function uid(): string {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
}

function deviceId(): string {
  let d = '';
  try {
    d = localStorage.getItem('structed.device') ?? '';
    if (!d) {
      d = uid();
      localStorage.setItem('structed.device', d);
    }
  } catch {
    d = uid();
  }
  return d;
}

export const DEVICE = deviceId();

type Store = { [K in TableName]: Record<string, Tables[K]> };
const emptyStore = (): Store =>
  Object.fromEntries(TABLES.map((t) => [t, {}])) as unknown as Store;

interface UndoEntry {
  table: TableName;
  id: string;
  before: EntityBase | null;
}
interface UndoGroup {
  at: number;
  key: string;
  label: string;
  entries: UndoEntry[];
}

/** True when `a` should win over `b` in a merge. */
export function newer(a: EntityBase, b: EntityBase | undefined): boolean {
  if (!b) return true;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.device > b.device;
}

class Database {
  t: Store = $state(emptyStore());
  ready = $state(false);
  /** Increments on every local change; used to trigger sync. */
  rev = $state(0);
  canUndo = $state(false);

  private idb: IDBPDatabase | null = null;
  private dirty = new Map<string, { table: TableName; id: string }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private undoStack: UndoGroup[] = [];
  private redoStack: UndoGroup[] = [];
  private replaying = false;
  private groupLabel = '';

  async init() {
    // v2 adds 'selections'; upgrades only create what is missing, existing data stays.
    this.idb = await openDB('structed', 2, {
      upgrade(db) {
        for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobdata')) db.createObjectStore('blobdata');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      }
    });
    const next = emptyStore();
    for (const t of TABLES) {
      const all = (await this.idb.getAll(t)) as EntityBase[];
      const rec = next[t] as Record<string, EntityBase>;
      for (const e of all) rec[e.id] = e;
    }
    this.t = next;
    this.ready = true;
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });
  }

  // ---------- reads ----------
  get<K extends TableName>(table: K, id: string | null | undefined): Tables[K] | undefined {
    if (!id) return undefined;
    const e = this.t[table][id];
    return e && !e.deleted ? e : undefined;
  }
  all<K extends TableName>(table: K): Tables[K][] {
    return Object.values(this.t[table]).filter((e) => !e.deleted);
  }

  // ---------- writes ----------
  create<K extends TableName>(
    table: K,
    data: Omit<Tables[K], keyof EntityBase> & Partial<EntityBase>
  ): Tables[K] {
    const now = Date.now();
    const e = {
      ...data,
      id: data.id ?? uid(),
      createdAt: now,
      updatedAt: now,
      device: DEVICE,
      deleted: false
    } as unknown as Tables[K];
    this.recordUndo(table, e.id, `create:${table}`);
    (this.t[table] as Record<string, Tables[K]>)[e.id] = e;
    this.markDirty(table, e.id);
    return this.t[table][e.id] as Tables[K];
  }

  update<K extends TableName>(table: K, id: string, patch: Partial<Tables[K]>) {
    const cur = this.t[table][id];
    if (!cur) return;
    this.recordUndo(table, id, `update:${table}:${id}:${Object.keys(patch).join(',')}`);
    Object.assign(cur, patch, { updatedAt: Date.now(), device: DEVICE });
    this.markDirty(table, id);
  }

  remove(table: TableName, id: string) {
    const cur = this.t[table][id];
    if (!cur || cur.deleted) return;
    this.recordUndo(table, id, `remove`);
    cur.deleted = true;
    cur.updatedAt = Date.now();
    cur.device = DEVICE;
    this.markDirty(table, id);
  }

  /** Group several writes into one undo step. */
  private batchDepth = 0;
  batch<T>(label: string, fn: () => T): T {
    if (this.batchDepth++ === 0) {
      this.groupLabel = label;
      this.openGroup(`batch:${label}:${uid()}`, label, true);
    }
    try {
      return fn();
    } finally {
      if (--this.batchDepth === 0) {
        this.groupLabel = '';
        this.closeGroup();
      }
    }
  }

  // ---------- undo ----------
  private current: UndoGroup | null = null;
  private forceGroup = false;

  private openGroup(key: string, label: string, force = false) {
    const last = this.undoStack[this.undoStack.length - 1];
    const now = Date.now();
    if (!force && last && last.key === key && now - last.at < 1500) {
      last.at = now;
      this.current = last;
      return;
    }
    this.current = { at: now, key, label, entries: [] };
    this.undoStack.push(this.current);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.forceGroup = force;
  }
  private closeGroup() {
    this.current = null;
    this.forceGroup = false;
    this.canUndo = this.undoStack.length > 0;
  }

  private recordUndo(table: TableName, id: string, key: string) {
    if (this.replaying) return;
    if (!this.current) {
      this.openGroup(key, this.groupLabel || key);
      queueMicrotask(() => {
        if (!this.forceGroup) this.closeGroup();
      });
    }
    const g = this.current!;
    if (g.entries.some((e) => e.table === table && e.id === id)) return;
    const cur = this.t[table][id];
    g.entries.push({ table, id, before: cur ? ($state.snapshot(cur) as EntityBase) : null });
  }

  undo() {
    const g = this.undoStack.pop();
    if (!g) return null;
    const redo: UndoGroup = { ...g, entries: [] };
    this.replaying = true;
    for (const en of [...g.entries].reverse()) {
      const cur = this.t[en.table][en.id];
      redo.entries.push({ table: en.table, id: en.id, before: cur ? ($state.snapshot(cur) as EntityBase) : null });
      this.restore(en);
    }
    this.replaying = false;
    this.redoStack.push(redo);
    this.canUndo = this.undoStack.length > 0;
    return g.label;
  }
  redo() {
    const g = this.redoStack.pop();
    if (!g) return null;
    const back: UndoGroup = { ...g, entries: [] };
    this.replaying = true;
    for (const en of [...g.entries].reverse()) {
      const cur = this.t[en.table][en.id];
      back.entries.push({ table: en.table, id: en.id, before: cur ? ($state.snapshot(cur) as EntityBase) : null });
      this.restore(en);
    }
    this.replaying = false;
    this.undoStack.push(back);
    this.canUndo = true;
    return g.label;
  }
  private restore(en: UndoEntry) {
    const rec = this.t[en.table] as Record<string, EntityBase>;
    const now = Date.now();
    if (en.before) rec[en.id] = { ...en.before, updatedAt: now, device: DEVICE };
    else if (rec[en.id]) Object.assign(rec[en.id], { deleted: true, updatedAt: now, device: DEVICE });
    this.markDirty(en.table, en.id);
  }

  // ---------- persistence ----------
  private markDirty(table: TableName, id: string) {
    this.dirty.set(`${table}/${id}`, { table, id });
    this.rev++;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 400);
  }

  async flush() {
    if (!this.idb || this.dirty.size === 0) return;
    const items = [...this.dirty.values()];
    this.dirty.clear();
    const tx = this.idb.transaction(TABLES, 'readwrite');
    for (const { table, id } of items) {
      const e = this.t[table][id];
      if (e) tx.objectStore(table).put($state.snapshot(e));
    }
    await tx.done;
  }

  // ---------- sync / backup ----------
  /** Everything including tombstones, as plain objects. */
  dump(): Store {
    return $state.snapshot(this.t) as Store;
  }

  /**
   * Merge a remote/backup dataset. Returns how many local entities changed and
   * whether local has entities newer than (or missing from) the remote set.
   */
  merge(remote: Partial<Store>): { changed: number; localAhead: boolean } {
    let changed = 0;
    let localAhead = false;
    for (const t of TABLES) {
      const r = (remote[t] ?? {}) as Record<string, EntityBase>;
      const l = this.t[t] as Record<string, EntityBase>;
      for (const id in r) {
        if (newer(r[id], l[id])) {
          l[id] = r[id];
          this.dirty.set(`${t}/${id}`, { table: t, id });
          changed++;
        }
      }
      if (!localAhead) {
        for (const id in l) {
          if (!r[id] || newer(l[id], r[id])) {
            localAhead = true;
            break;
          }
        }
      }
    }
    if (changed) {
      this.undoStack = [];
      this.redoStack = [];
      this.canUndo = false;
      this.flush();
    }
    return { changed, localAhead };
  }

  /** Replace everything (restore from backup, destructive). */
  async replaceAll(data: Partial<Store>) {
    const next = emptyStore();
    for (const t of TABLES) Object.assign(next[t], data[t] ?? {});
    this.t = next;
    const tx = this.idb!.transaction(TABLES, 'readwrite');
    for (const t of TABLES) {
      await tx.objectStore(t).clear();
      for (const e of Object.values(next[t])) tx.objectStore(t).put(e);
    }
    await tx.done;
    this.undoStack = [];
    this.redoStack = [];
    this.canUndo = false;
    this.rev++;
  }

  /** Physically drop tombstones older than `ms` (keeps sync safe for that window). */
  async compact(ms = 1000 * 60 * 60 * 24 * 60) {
    const cut = Date.now() - ms;
    const tx = this.idb!.transaction(TABLES, 'readwrite');
    for (const t of TABLES) {
      const rec = this.t[t] as Record<string, EntityBase>;
      for (const id in rec) {
        if (rec[id].deleted && rec[id].updatedAt < cut) {
          delete rec[id];
          tx.objectStore(t).delete(id);
        }
      }
    }
    await tx.done;
  }

  // ---------- binary blobs ----------
  async putBlob(blob: Blob, id = uid()): Promise<string> {
    await this.idb!.put('blobdata', blob, id);
    if (!this.t.blobs[id])
      this.create('blobs', { id, mime: blob.type, size: blob.size } as never);
    return id;
  }
  async getBlob(id: string): Promise<Blob | undefined> {
    return this.idb!.get('blobdata', id);
  }
  async hasBlob(id: string): Promise<boolean> {
    return !!(await this.idb!.getKey('blobdata', id));
  }
  async putBlobData(id: string, blob: Blob) {
    await this.idb!.put('blobdata', blob, id);
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.idb!.get('meta', key);
  }
  async setMeta(key: string, value: unknown) {
    await this.idb!.put('meta', value, key);
  }
}

export const db = new Database();

// ---------- ordering helpers ----------
export function orderBetween(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 1;
  if (a === undefined) return b! - 1;
  if (b === undefined) return a + 1;
  return (a + b) / 2;
}
export const byOrder = (x: { order: number }, y: { order: number }) => x.order - y.order;
