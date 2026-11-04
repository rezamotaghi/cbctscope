// The open progress rate limits (lib/browser/progress.ts): the scan's throttle and the
// assembly worker's gate, driven by a hand clock.
import { describe, expect, it } from 'vitest';
import { createProgressGate, createThrottle } from '../lib/browser/progress';

describe('createThrottle', () => {
  it('passes the first report, then at most one per interval', () => {
    const t = createThrottle(50);
    expect(t(1000)).toBe(true);
    expect(t(1010)).toBe(false);
    expect(t(1049)).toBe(false);
    expect(t(1050)).toBe(true);
    expect(t(1060)).toBe(false);
  });

  it('a forced report always passes and restarts the interval', () => {
    const t = createThrottle(50);
    expect(t(0)).toBe(true);
    expect(t(10, true)).toBe(true);
    expect(t(40)).toBe(false);
    expect(t(60)).toBe(true);
  });
});

describe('createProgressGate', () => {
  it('reports every 2 % when progress is fast', () => {
    const g = createProgressGate(0.02, 100);
    expect(g(0, 0)).toBe(true);
    expect(g(0.01, 1)).toBe(false);
    expect(g(0.02, 2)).toBe(true);
    expect(g(0.035, 3)).toBe(false);
    expect(g(0.041, 4)).toBe(true);
  });

  it('reports every 100 ms when progress is slow, but only on some progress', () => {
    const g = createProgressGate(0.02, 100);
    expect(g(0.1, 0)).toBe(true);
    expect(g(0.101, 50)).toBe(false);
    expect(g(0.102, 100)).toBe(true);
    expect(g(0.102, 300)).toBe(false); // no progress since the last report
  });

  it('always reports the end', () => {
    const g = createProgressGate(0.02, 100);
    expect(g(0.995, 0)).toBe(true);
    expect(g(1, 1)).toBe(true);
  });
});
