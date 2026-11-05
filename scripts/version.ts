// Version scheme: stable releases are git tags like v1.0 / v2.0.
// Builds between releases show "<tag>.<commits since tag>", e.g. 1.0.7 (abc1234).
export interface VersionInfo {
  version: string; // "1.0" or "1.0.7"
  stable: boolean;
  commit: string; // short hash
  display: string; // "1.0" or "1.0.7 (abc1234)"
}

/** Parse `git describe --tags --long --always --match "v*"` output. */
export function parseDescribe(desc: string, totalCommits = 0): VersionInfo {
  const d = desc.trim().replace(/-dirty$/, '');
  const m = d.match(/^v?(\d+(?:\.\d+)*)-(\d+)-g([0-9a-f]+)$/);
  if (m) {
    const [, base, n, commit] = m;
    const count = Number(n);
    const version = count === 0 ? base : `${base}.${count}`;
    return { version, stable: count === 0, commit, display: count === 0 ? base : `${version} (${commit})` };
  }
  // no tag yet: just a commit hash
  const commit = /^[0-9a-f]{4,}$/.test(d) ? d : 'unknown';
  const version = `0.0.${totalCommits}`;
  return { version, stable: false, commit, display: `${version} (${commit})` };
}
