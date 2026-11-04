// BROWSER. The open progress (docs/web-build.md, section 5): the pure rate limits that keep a
// big open from flooding the UI thread with reports. The clock is a parameter, so the tests
// drive it by hand.

/**
 * At most one report per `minMs`: the first report always passes, a final report passes
 * when `force` is set (the caller's "done", so the last count is never swallowed).
 */
export function createThrottle(minMs: number) {
  let last = -Infinity;
  return (now: number, force = false): boolean => {
    if (!force && now - last < minMs) return false;
    last = now;
    return true;
  };
}

/**
 * The assembly worker's rule: report at least every `step` of progress or every `maxMs`,
 * whichever comes first, and always the end. A report needs some progress since the last one.
 */
export function createProgressGate(step = 0.02, maxMs = 100) {
  let lastFraction = -Infinity;
  let lastAt = -Infinity;
  return (fraction: number, now: number): boolean => {
    const due =
      fraction >= 1 || fraction - lastFraction >= step || (fraction > lastFraction && now - lastAt >= maxMs);
    if (!due) return false;
    lastFraction = fraction;
    lastAt = now;
    return true;
  };
}
