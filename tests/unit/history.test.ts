import { describe, expect, it } from 'vitest';
import { forgetLast, recordVersion, thin, versions } from '../../src/lib/textHistory';

describe('text version history', () => {
  it('keeps a version per finished sentence, at most every few seconds, and at least every 30 s', async () => {
    forgetLast();
    const h = 'h-' + Math.random();
    const t0 = 1_000_000_000_000;
    await recordVersion(h, 'a', 'Eins', 1, t0); // first version
    await recordVersion(h, 'b', 'Eins zwei', 2, t0 + 1000); // too soon, no sentence finished
    await recordVersion(h, 'c', 'Eins zwei.', 2, t0 + 2000); // sentence finished, but < 3 s
    await recordVersion(h, 'd', 'Eins zwei. Drei.', 3, t0 + 5000); // finished a sentence, 5 s later
    await recordVersion(h, 'e', 'Eins zwei. Drei. Vier', 4, t0 + 9000); // nothing finished
    await recordVersion(h, 'f', 'Eins zwei. Drei. Vier fünf', 5, t0 + 40_000); // 35 s later
    await recordVersion(h, 'f', 'Eins zwei. Drei. Vier fünf', 5, t0 + 90_000); // unchanged: nothing
    expect((await versions(h)).map((v) => v.draft)).toEqual(['a', 'd', 'f']);
  });
  it('thins out old versions: one per hour after a day', async () => {
    forgetLast();
    const h = 'h-' + Math.random();
    const day = 24 * 3600_000;
    const now = 100 * day;
    const base = now - 3 * day; // 3 days ago, within one hour
    for (let i = 0; i < 5; i++) await recordVersion(h, 'v' + i, '', 0, base + i * 60_000, true);
    await recordVersion(h, 'fresh', '', 0, now - 1000, true);
    await thin(h, now);
    expect((await versions(h)).map((v) => v.draft)).toEqual(['v4', 'fresh']);
  });
});
