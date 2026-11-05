import { db } from './db.svelte';
import { download, pickFile } from './clipboard';

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

export async function exportBackup() {
  await db.flush();
  const blobs: Record<string, string> = {};
  for (const b of db.all('blobs')) {
    const data = await db.getBlob(b.id);
    if (data) blobs[b.id] = await blobToDataUrl(data);
  }
  const payload = { format: 'structed', version: 1, exportedAt: Date.now(), tables: db.dump(), blobs };
  const d = new Date().toISOString().slice(0, 10);
  download(`structed-backup-${d}.json`, JSON.stringify(payload), 'application/json');
}

export async function importBackup(mode: 'merge' | 'replace'): Promise<string> {
  const f = await pickFile('.json,application/json');
  if (!f) return '';
  const data = JSON.parse(await f.text());
  if (data.format !== 'structed' || !data.tables) throw new Error('Not a Structed backup file.');
  if (mode === 'replace') await db.replaceAll(data.tables);
  else db.merge(data.tables);
  for (const [id, url] of Object.entries((data.blobs ?? {}) as Record<string, string>)) {
    const blob = await (await fetch(url)).blob();
    await db.putBlobData(id, blob);
  }
  return f.name;
}

// ---------- snapshots ----------
export function takeSnapshot(projectId: string, name: string) {
  const pick = <T extends { projectId: string }>(xs: T[]) => xs.filter((x) => x.projectId === projectId);
  const data = {
    project: db.get('projects', projectId),
    headings: pick(db.all('headings')),
    placements: pick(db.all('placements')),
    comments: pick(db.all('comments'))
  };
  return db.create('snapshots', { projectId, name, data: JSON.stringify(data) });
}

export function restoreSnapshot(id: string) {
  const s = db.get('snapshots', id);
  if (!s) return;
  const data = JSON.parse(s.data);
  db.batch('restore snapshot', () => {
    takeSnapshot(s.projectId, `Before restoring “${s.name}”`);
    for (const t of ['headings', 'placements', 'comments'] as const) {
      for (const e of db.all(t)) if (e.projectId === s.projectId) db.remove(t, e.id);
      for (const e of data[t] ?? []) {
        const cur = db.t[t][e.id];
        if (cur) db.update(t, e.id, { ...e, deleted: false });
        else db.create(t, e);
      }
    }
    if (data.project) db.update('projects', s.projectId, { title: data.project.title, subtitle: data.project.subtitle });
  });
}
