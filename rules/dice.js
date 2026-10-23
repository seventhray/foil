/**
 * src/dice.js
 * Attribute-pool parsing. A pool is expressed as per-size die counts
 * ({ d4, d6, d8, d10, d12, d20 }). Potential is the pool's maximum possible roll
 * (sum of die faces).
 */

// Die sizes a pool can hold, smallest to largest (rulebook 2.1.0).
export const DIE_SIZES = [4, 6, 8, 10, 12, 20];

/**
 * Build a pool from per-size die counts.
 * @param {object} counts  e.g. { d4: 2, d8: 1 }
 * `min` is one per die, `avg` is each die's own average summed (a dN averages
 * (N+1)/2, PHB 2.2.3), and `max` is the sum of faces, which is Potential.
 * @returns {{ min:number, avg:number, max:number, dieCount:number, formula:string, valid:boolean }}
 */
export function poolFromCounts(counts) {
  const c = counts ?? {};
  let max = 0, avg = 0, dieCount = 0;
  const parts = [];
  for (const faces of DIE_SIZES) {
    const n = Math.max(0, Math.trunc(Number(c[`d${faces}`] ?? 0)) || 0);
    if (!n) continue;
    max      += n * faces;
    avg      += n * (faces + 1) / 2;
    dieCount += n;
    parts.push(`${n}d${faces}`);
  }
  return { min: dieCount, avg, max, dieCount, formula: parts.join(" + "), valid: dieCount > 0 };
}
