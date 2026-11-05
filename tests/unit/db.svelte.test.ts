import { describe, expect, it } from 'vitest';
import { db, newer, orderBetween } from '../../src/lib/db.svelte';
import { TABLES, type EntityBase } from '../../src/lib/types';

const flushMicro = () => new Promise((r) => setTimeout(r, 0));

describe('database', () => {
  it('creates, updates and soft-deletes entities', () => {
    const p = db.create('projects', { title: 'A' });
    expect(db.get('projects', p.id)?.title).toBe('A');
    const before = p.updatedAt;
    db.update('projects', p.id, { title: 'B' });
    expect(db.get('projects', p.id)?.title).toBe('B');
    expect(db.t.projects[p.id].updatedAt).toBeGreaterThanOrEqual(before);
    db.remove('projects', p.id);
    expect(db.get('projects', p.id)).toBeUndefined();
    expect(db.t.projects[p.id].deleted).toBe(true); // tombstone kept for sync
    expect(db.all('projects')).toHaveLength(0);
  });

  it('persists to IndexedDB and reloads', async () => {
    const p = db.create('projects', { title: 'Persist me' });
    await db.flush();
    db.t.projects = {}; // simulate fresh memory
    await db.init();
    expect(db.get('projects', p.id)?.title).toBe('Persist me');
  });

  it('bumps rev on local changes but not on merges', () => {
    const r0 = db.rev;
    db.create('tags', { name: 'x' });
    expect(db.rev).toBe(r0 + 1);
    db.merge({ tags: { z: { id: 'z', name: 'remote', createdAt: 1, updatedAt: 1, device: 'r' } as never } });
    expect(db.rev).toBe(r0 + 1);
  });

  it('merges last-write-wins per entity with tombstones', () => {
    const a = db.create('projects', { title: 'local' });
    const remoteNewer = { ...$state.snapshot(a), title: 'remote', updatedAt: a.updatedAt + 1000, device: 'zz' };
    const res = db.merge({ projects: { [a.id]: remoteNewer } });
    expect(res.changed).toBe(1);
    expect(db.get('projects', a.id)?.title).toBe('remote');

    const older = { ...remoteNewer, title: 'stale', updatedAt: 5 };
    expect(db.merge({ projects: { [a.id]: older } }).changed).toBe(0);
    expect(db.get('projects', a.id)?.title).toBe('remote');

    const tomb = { ...remoteNewer, deleted: true, updatedAt: remoteNewer.updatedAt + 1 };
    db.merge({ projects: { [a.id]: tomb } });
    expect(db.get('projects', a.id)).toBeUndefined();
  });

  it('reports when local is ahead of remote', () => {
    db.create('projects', { title: 'only local' });
    expect(db.merge({}).localAhead).toBe(true);
    const dump = db.dump();
    expect(db.merge(dump).localAhead).toBe(false);
  });

  it('merges two devices editing different entities without loss', () => {
    const base = db.create('headings', { projectId: 'p', parentId: null, order: 1, title: 'h1', body: '' });
    const other = db.create('headings', { projectId: 'p', parentId: null, order: 2, title: 'h2', body: '' });
    const remote = db.dump();
    // remote device edits h2
    (remote.headings[other.id] as EntityBase & { title: string }).title = 'h2 remote';
    remote.headings[other.id].updatedAt += 10;
    remote.headings[other.id].device = 'remote';
    // local edits h1
    db.update('headings', base.id, { title: 'h1 local' });
    db.merge(remote);
    expect(db.get('headings', base.id)?.title).toBe('h1 local');
    expect(db.get('headings', other.id)?.title).toBe('h2 remote');
  });

  it('tie-breaks equal timestamps deterministically by device', () => {
    const x = { id: 'x', createdAt: 1, updatedAt: 10, device: 'b' };
    const y = { id: 'x', createdAt: 1, updatedAt: 10, device: 'a' };
    expect(newer(x, y)).toBe(true);
    expect(newer(y, x)).toBe(false);
  });

  it('undoes and redoes, grouping batches', async () => {
    const p = db.create('projects', { title: 'one' });
    await flushMicro();
    db.batch('two changes', () => {
      db.update('projects', p.id, { title: 'two' });
      db.create('tags', { name: 'tag' });
    });
    expect(db.all('tags')).toHaveLength(1);
    db.undo();
    expect(db.get('projects', p.id)?.title).toBe('one');
    expect(db.all('tags')).toHaveLength(0);
    db.redo();
    expect(db.get('projects', p.id)?.title).toBe('two');
    expect(db.all('tags')).toHaveLength(1);
  });

  it('coalesces rapid typing into one undo step', async () => {
    const p = db.create('projects', { title: '' });
    await flushMicro();
    for (const t of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      db.update('projects', p.id, { title: t });
      await flushMicro();
    }
    db.undo();
    expect(db.get('projects', p.id)?.title).toBe('');
  });

  it('undo restores deleted entities', async () => {
    const p = db.create('projects', { title: 'keep' });
    await flushMicro();
    db.remove('projects', p.id);
    await flushMicro();
    db.undo();
    expect(db.get('projects', p.id)?.title).toBe('keep');
  });

  it('replaceAll wipes everything', async () => {
    db.create('projects', { title: 'gone' });
    await db.replaceAll({});
    for (const t of TABLES) expect(Object.keys(db.t[t])).toHaveLength(0);
  });

  it('compact drops only old tombstones', async () => {
    const a = db.create('tags', { name: 'old' });
    const b = db.create('tags', { name: 'new' });
    db.remove('tags', a.id);
    db.remove('tags', b.id);
    db.t.tags[a.id].updatedAt = 1;
    await db.compact();
    expect(db.t.tags[a.id]).toBeUndefined();
    expect(db.t.tags[b.id]).toBeDefined();
  });

  it('stores binary blobs', async () => {
    const id = await db.putBlob(new Blob(['hi'], { type: 'text/plain' }));
    expect(await db.hasBlob(id)).toBe(true);
    expect(db.get('blobs', id)?.mime).toBe('text/plain');
  });

  it('orderBetween produces values between neighbours', () => {
    expect(orderBetween(1, 2)).toBe(1.5);
    expect(orderBetween(undefined, 1)).toBe(0);
    expect(orderBetween(3, undefined)).toBe(4);
    expect(orderBetween(undefined, undefined)).toBe(1);
  });
});

describe('nested batches', () => {
  it('form a single undo step', async () => {
    const ids = [1, 2, 3].map((i) => db.create('tags', { name: 't' + i }).id);
    await new Promise((r) => setTimeout(r, 0));
    db.batch('outer', () => {
      for (const id of ids) db.batch('inner', () => db.remove('tags', id));
    });
    expect(db.all('tags')).toHaveLength(0);
    db.undo();
    expect(db.all('tags')).toHaveLength(3);
  });
});
