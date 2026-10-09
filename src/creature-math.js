/**
 * src/creature-math.js
 * Creature building (GMG 9.1.0 to 9.3.0, 12.3.0, 12.7.0), pure so it runs headlessly.
 * Threat is the creature's counterpart to a character's XP.
 */

import { DIE_SIZES } from "./dice.js";

const halfUp = x => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5));

/** The tier table's anchor Threat for each tier (GMG 9.1.0). */
export const TIER_THREAT = { 1: -384, 2: -256, 3: -128, 4: 0, 5: 128, 6: 256, 7: 384, 8: 832, 9: 1152, 10: 1536 };

/** A creature's tier: the row whose Threat is nearest its own, a tie going lower (GMG 9.1.0). */
export function tierFor(threat) {
  let best = 1, gap = Infinity;
  for (const [tier, t] of Object.entries(TIER_THREAT)) {
    const d = Math.abs(threat - t);
    if (d < gap) { gap = d; best = Number(tier); }
  }
  return best;
}

/** The GMG 9.1.0 formulas. */
export function creatureNumbers(threat) {
  const potential = 2 * halfUp((20 + threat / 32) / 2);
  const nonneg = threat >= 0;
  const train = nonneg ? halfUp(2 + threat / 500) : Math.floor((potential - 8) / 8);
  const points = nonneg ? halfUp(2 + threat / 533) : Math.floor((potential - 8) / 8);
  return {
    threat, tier: tierFor(threat), potential, totalPotential: 4 * potential, ceiling: 2 * potential,
    allowance: nonneg ? halfUp(40 + 3.6 * Math.sqrt(threat)) : 2 * potential - 12,
    training: Math.max(0, train), resistancePoints: Math.max(0, points), resistanceBudget: 8 * Math.max(0, points),
    resistanceCap: Math.max(0, points) + 1
  };
}

/** CR to Threat (GMG 12.7.0). Fractions are written "1/8", "1/4", "1/2". */
const CR_THREAT = { "0": -384, "1/8": -384, "1/4": -256, "1/2": -128, "1": -64, "2": 32, "3": 104, "4": 160, "5": 208, "6": 256, "7": 304,
  "8": 360, "9": 424, "10": 488, "11": 560, "12": 632, "13": 712, "14": 800, "15": 888, "16": 984, "17": 1088, "18": 1192, "19": 1304, "20": 1416 };
export const CR_CHOICES = Object.keys(CR_THREAT).filter(k => k !== "0").concat(["21+"]);
export function crToThreat(cr) {
  const key = String(cr).trim();
  if (key in CR_THREAT) return CR_THREAT[key];
  const n = Number(key.replace("+", ""));
  return Number.isFinite(n) && n >= 21 ? 1536 + 64 * (n - 21) : null;
}

/** Steps (one step is 2 Potential) for the shapes in GMG 9.2.0, by Attribute. */
export const SHAPES = {
  none:   { label: "No particular shape", steps: { might: 0, finesse: 0, wit: 0, presence: 0 } },
  brute:  { label: "Brute", steps: { might: 2, finesse: 0, wit: -1, presence: -1 } },
  quick:  { label: "Quick and thoughtless", steps: { might: 0, finesse: 1, wit: -1, presence: 0 } }
};

/**
 * The Potentials after Differentiate. No Attribute moves more than two steps, and the
 * Total Potential lands within one step of the tier's number (GMG 9.2.0).
 */
export function differentiate(baseline, steps) {
  const out = {}, notes = [];
  let sum = 0;
  for (const k of ["might", "finesse", "wit", "presence"]) {
    const s = Math.max(-2, Math.min(2, Math.trunc(steps[k] ?? 0)));
    if (s !== steps[k]) notes.push(`${k} moves at most two steps`);
    out[k] = Math.max(0, baseline + 2 * s);
    sum += s;
  }
  if (Math.abs(sum) > 1) notes.push("Total Potential must land within one step of the tier's number");
  return { potentials: out, notes, total: Object.values(out).reduce((a, b) => a + b, 0) };
}

// Dice for a target Potential (GMG 12.3.0).
const TABLE = { 8: "1d8", 10: "1d10", 12: "1d12", 14: "1d6+1d8", 16: "2d8", 18: "1d8+1d10", 20: "1d20", 22: "1d10+1d12", 24: "2d12",
  26: "1d20+1d6", 28: "1d20+1d8", 30: "1d20+1d10", 32: "1d20+1d12", 34: "1d20+1d8+1d6", 36: "1d20+2d8", 38: "1d20+1d10+1d8", 40: "2d20",
  42: "1d20+1d12+1d10", 44: "2d20+1d4", 46: "2d20+1d6", 48: "2d20+1d8", 52: "2d20+1d12", 56: "2d20+2d8", 60: "3d20", 64: "3d20+1d4",
  68: "3d20+1d8", 72: "3d20+1d12", 80: "4d20" };

/** @returns {{ formula:string, counts:Object<string,number>, potential:number }} */
export function diceFor(target) {
  let t = Math.trunc(target);
  if (t <= 1) return { formula: "none", counts: {}, potential: 0 };
  if (t <= 3) return { formula: "1d4", counts: { d4: 1 }, potential: 4 };
  t -= t % 2;
  let formula = TABLE[t] ?? null;
  if (!formula) {
    const anchors = t >= 60 ? 3 : t >= 40 ? 2 : 1;
    let rest = t - 20 * anchors;
    const parts = [`${anchors}d20`];
    const dice = [12, 10, 8, 6, 4];
    while (rest > 0) {
      const d = dice.find(x => x <= rest) ?? 4;
      parts.push(`1d${d}`); rest -= d;
    }
    formula = parts.join("+");
  }
  const counts = {};
  for (const m of formula.matchAll(/(\d+)d(\d+)/g)) counts[`d${m[2]}`] = (counts[`d${m[2]}`] ?? 0) + Number(m[1]);
  const potential = DIE_SIZES.reduce((n, f) => n + f * (counts[`d${f}`] ?? 0), 0);
  return { formula, counts, potential };
}
