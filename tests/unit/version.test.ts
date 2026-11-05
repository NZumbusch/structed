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
