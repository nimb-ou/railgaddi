// Spelling slips in a search ("banglore", "darjiling", "dehli"): how many letters apart two names
// are, counting a swapped pair as one, and giving up early past the most we'd forgive.

let prev2 = new Int32Array(64);
let prev = new Int32Array(64);
let cur = new Int32Array(64);

/** Edits (insert, delete, change, swap two neighbours) from `a` to `b`, or `max + 1` if more. */
export function typos(a: string, b: string, max: number): number {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (m + 1 > prev.length) [prev2, prev, cur] = [new Int32Array(m + 1), new Int32Array(m + 1), new Int32Array(m + 1)];
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let best = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === bj ? 0 : 1));
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[m];
}

/** How many slips to forgive in a query this long: none in short ones, where a slip is another name. */
export const forgive = (q: string) => (q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0);

/**
 * The fewest slips between what was typed and a name, read whole or, from six letters on, as the
 * start of a longer name ("banglo" for Bangalore; shorter starts match too much). Names must start
 * with the same letter. A match on the start only counts half a slip more. Infinity if too many.
 */
export function slips(q: string, name: string, max = forgive(q)): number {
  if (!max || !name || name.charCodeAt(0) !== q.charCodeAt(0)) return Infinity;
  const whole = typos(q, name, max);
  let start = max + 1;
  if (whole && q.length >= 6 && name.length > q.length) {
    for (let k = Math.max(q.length - 1, 2); k <= Math.min(name.length - 1, q.length + 1); k++) start = Math.min(start, typos(q, name.slice(0, k), max));
  }
  const best = Math.min(whole, start + 0.5);
  return best <= max + 0.5 && (whole <= max || start <= max) ? best : Infinity;
}
