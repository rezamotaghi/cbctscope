// The update page's pure logic (components/updateCheck.ts): the strict reading of the address
// after the # sign, the numeric comparison, the four verdicts and the address the desktop app's
// version panel links. The desktop menu's own address is pinned equal in tests/desktopNative.test.ts.
import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion, updatePageUrl, updateVerdict, versionFromHash } from '../components/updateCheck';

describe('the update page', () => {
  it('reads a version only from #from= and three dot-separated integers', () => {
    expect(versionFromHash('#from=2.1.0')).toBe('2.1.0');
    expect(versionFromHash('#from=0.0.0')).toBe('0.0.0');
    expect(versionFromHash('#from=12.34.56')).toBe('12.34.56');
    for (const bad of ['', '#', '#from=', '#from=2.1', '#from=2.1.0.1', '#from=v2.1.0', '#from=2.1.0-beta', '#from=2.1.0&x=1', '#x=1&from=2.1.0', '#FROM=2.1.0', '#from=<script>', '#from=2.1.0%20', 'from=2.1.0', '#from=1234567890.0.0']) {
      expect(versionFromHash(bad), bad).toBeNull();
    }
  });

  it('compares numerically, part by part', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1);
    expect(compareVersions('2.1.0', '2.1.0')).toBe(0);
    expect(compareVersions('3.0.0', '2.99.99')).toBe(1);
    expect(compareVersions('2.1.9', '2.1.10')).toBe(-1);
    expect(compareVersions('02.1.0', '2.1.0')).toBe(0);
    expect(() => compareVersions('2.1', '2.1.0')).toThrow(/not a major.minor.patch/);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3.4')).toBeNull();
  });

  it('gives the four verdicts', () => {
    expect(updateVerdict('2.1.0', '2.2.0')).toEqual({ kind: 'older', installed: '2.1.0', newest: '2.2.0' });
    expect(updateVerdict('2.2.0', '2.2.0')).toEqual({ kind: 'same', installed: '2.2.0', newest: '2.2.0' });
    expect(updateVerdict('2.3.0', '2.2.0')).toEqual({ kind: 'newer', installed: '2.3.0', newest: '2.2.0' });
    expect(updateVerdict(null, '2.2.0')).toEqual({ kind: 'unknown', newest: '2.2.0' });
  });

  it('never throws: a version that is not strict, on either side, gives the no-version verdict', () => {
    for (const bad of ['2.2.0-beta.1', '2.2', '', 'v2.2.0', '2.2.0.1', 'x']) {
      expect(updateVerdict('2.1.0', bad), `site ${bad}`).toEqual({ kind: 'unknown', newest: bad });
      expect(updateVerdict(bad, '2.2.0'), `installed ${bad}`).toEqual({ kind: 'unknown', newest: '2.2.0' });
      expect(updateVerdict(null, bad)).toEqual({ kind: 'unknown', newest: bad });
    }
  });

  it('links the website page with a strict version after the #, the bare page otherwise', () => {
    expect(updatePageUrl('2.1.0')).toBe('https://cbctscope.com/update#from=2.1.0');
    expect(updatePageUrl('2.1.0-beta')).toBe('https://cbctscope.com/update');
    expect(updatePageUrl('')).toBe('https://cbctscope.com/update');
  });
});
