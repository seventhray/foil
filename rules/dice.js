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

/**
 * Roll a formula as combat.js writes it: terms like `1d10[Might]` (dice) and `2[Training]` (a flat number), joined
 * by + or -, or the plain `0`. `rollDie(faces)` supplies each die, so a host can use its own random source.
 * Returns the total and every die, because a Foil Token rerolls one die (PHB 3.2.0).
 * @returns {{ total:number, dice:{ faces:number, value:number, label:string, sign:number }[], flat:number }}
 */
export function rollFormula(formula, rollDie) {
  const text = String(formula ?? "").trim();
  const term = /([+-]?)\s*(?:(\d*)d(\d+)|(\d+))(?:\[([^\]]*)\])?/y;
  const dice = [];
  let total = 0, flat = 0, pos = 0, first = true;
  while (pos < text.length) {
    term.lastIndex = pos;
    const m = term.exec(text);
    if (!m || (!first && !m[1])) throw new Error(`cannot read "${text.slice(pos)}" in the formula "${text}"`);
    const sign = m[1] === "-" ? -1 : 1;
    if (m[3] !== undefined) {
      const count = m[2] === "" ? 1 : Number(m[2]), faces = Number(m[3]);
      if (!(faces >= 2) || count > 100) throw new Error(`bad dice "${m[0].trim()}" in the formula "${text}"`);
      for (let i = 0; i < count; i++) {
        const value = rollDie(faces);
        dice.push({ faces, value, label: m[5] ?? "", sign });
        total += sign * value;
      }
    } else {
      flat += sign * Number(m[4]);
      total += sign * Number(m[4]);
    }
    pos = term.lastIndex;
    while (text[pos] === " ") pos++;
    first = false;
  }
  return { total, dice, flat };
}
