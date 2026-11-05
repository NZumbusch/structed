import { describe, expect, it } from 'vitest';
import { parseDescribe } from '../../scripts/version';

describe('parseDescribe', () => {
  it('stable when exactly on a tag', () => {
    expect(parseDescribe('v1.0-0-gabc1234')).toEqual({ version: '1.0', stable: true, commit: 'abc1234', display: '1.0' });
  });
  it('appends commits since tag', () => {
    const v = parseDescribe('v2.1-7-gdeadbee');
    expect(v.version).toBe('2.1.7');
    expect(v.stable).toBe(false);
    expect(v.display).toBe('2.1.7 (deadbee)');
  });
  it('ignores -dirty suffix', () => {
    expect(parseDescribe('v1.0-3-g1234567-dirty').version).toBe('1.0.3');
  });
  it('falls back to 0.0.<count> without tags', () => {
    expect(parseDescribe('abc1234', 42)).toEqual({ version: '0.0.42', stable: false, commit: 'abc1234', display: '0.0.42 (abc1234)' });
  });
  it('handles garbage', () => {
    expect(parseDescribe('unknown').commit).toBe('unknown');
  });
});

import { EARLY_MS, renewPlan } from '../../src/lib/sync.svelte';
describe('renewPlan', () => {
  it('refreshes silently a few minutes before expiry with a refresh token', () => {
    const p = renewPlan(0, 3_600_000, true);
    expect(p.refreshAt).toBe(3_600_000 - EARLY_MS);
    expect(p.preSyncAt).toBeNull();
  });
  it('without refresh token: last sync and click-renew window before expiry', () => {
    const p = renewPlan(0, 3_600_000, false);
    expect(p.preSyncAt).toBe(3_600_000 - EARLY_MS);
    expect(p.gestureFrom).toBe(3_600_000 - EARLY_MS);
  });
  it('acts immediately when already past the window', () => {
    expect(renewPlan(5000, 1000, true).refreshAt).toBe(5000);
  });
});
