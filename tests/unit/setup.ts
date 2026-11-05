import 'fake-indexeddb/auto';
import { beforeAll, beforeEach } from 'vitest';

const browser = typeof window !== 'undefined';

// jsdom lacks matchMedia
if (browser && !window.matchMedia) {
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
  if (!browser) return;
  const { db } = await import('../../src/lib/db.svelte');
  if (!db.ready) await db.init();
});
beforeEach(async () => {
  if (!browser) return;
  const { db } = await import('../../src/lib/db.svelte');
  await db.replaceAll({});
  localStorage.clear();
});
