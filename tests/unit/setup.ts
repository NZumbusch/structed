import 'fake-indexeddb/auto';
import { beforeAll, beforeEach } from 'vitest';

// jsdom lacks matchMedia
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
}

beforeAll(async () => {
  const { db } = await import('../../src/lib/db.svelte');
  if (!db.ready) await db.init();
});
beforeEach(async () => {
  const { db } = await import('../../src/lib/db.svelte');
  await db.replaceAll({});
  localStorage.clear();
});
