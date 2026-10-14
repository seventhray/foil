/**
 * src/creature-math.js
 * Creature building (GMG 9.1.0 to 9.3.0, 11.3.0, 11.7.0), pure so it runs headlessly.
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

// What Training in one Skill costs in all, +1 for 8 XP and each further point 2 more (PHB 2.3.0).
const trainingTotal = n => { let c = 0; for (let h = 0; h < n; h++) c += 8 + 2 * h; return c; };

/** The GMG 9.1.0 formulas. The Allowance includes Training in two Skills (GMG 9.4.0). */
export function creatureNumbers(threat) {
  const potential = 2 * halfUp((20 + threat / 32) / 2);
  const nonneg = threat >= 0;
  const train = nonneg ? halfUp(2 + threat / 500) : Math.floor((potential - 8) / 8);
  const points = nonneg ? halfUp(2 + threat / 533) : Math.floor((potential - 8) / 8);
  return {
    threat, tier: tierFor(threat), potential, totalPotential: 4 * potential, ceiling: 2 * potential,
    allowance: (nonneg ? halfUp(40 + 3.6 * Math.sqrt(threat)) : 2 * potential - 12) + 2 * trainingTotal(Math.max(0, train)),
    training: Math.max(0, train), resistancePoints: Math.max(0, points), resistanceBudget: 8 * Math.max(0, points),
    resistanceCap: Math.max(0, points) + 1
  };
}

/** CR to Threat (GMG 11.7.0). Fractions are written "1/8", "1/4", "1/2". */
const CR_THREAT = { "0": -384, "1/8": -384, "1/4": -256, "1/2": -128, "1": -64, "2": 32, "3": 104, "4": 160, "5": 208, "6": 256, "7": 304,
  "8": 360, "9": 424, "10": 488, "11": 560, "12": 632, "13": 712, "14": 800, "15": 888, "16": 984, "17": 1088, "18": 1192, "19": 1304, "20": 1416 };
export const CR_CHOICES = Object.keys(CR_THREAT).filter(k => k !== "0").concat(["21+"]);
export function crToThreat(cr) {
  const key = String(cr).trim();
  if (key in CR_THREAT) return CR_THREAT[key];
  const n = Number(key.replace("+", ""));
  return Number.isFinite(n) && n >= 21 ? 1536 + 64 * (n - 21) : null;
}

/**
 * The Potentials after Assign Attributes. The Total Potential lands within one step of the
 * tier's number (GMG 9.2.0).
 */
export function assignAttributes(baseline, steps) {
  const out = {}, notes = [];
  let sum = 0;
  for (const k of ["might", "finesse", "wit", "presence"]) {
    const s = Math.trunc(steps[k] ?? 0);
    out[k] = Math.max(0, baseline + 2 * s);
    sum += s;
  }
  if (Math.abs(sum) > 1) notes.push("Total Potential must land within one step of the tier's number");
  return { potentials: out, notes, total: Object.values(out).reduce((a, b) => a + b, 0) };
}

// Dice for a target Potential (GMG 11.3.0).
const TABLE = { 8: "1d8", 10: "1d10", 12: "1d12", 14: "1d6+1d8", 16: "2d8", 18: "1d8+1d10", 20: "1d20", 22: "1d10+1d12", 24: "2d12",
  26: "1d20+1d6", 28: "1d20+1d8", 30: "1d20+1d10", 32: "1d20+1d12", 34: "1d20+1d8+1d6", 36: "1d20+2d8", 38: "1d20+1d10+1d8", 40: "2d20",
  42: "1d20+1d12+1d10", 44: "2d20+1d4", 46: "2d20+1d6", 48: "2d20+1d8", 50: "2d20+1d10", 52: "2d20+1d12", 54: "2d20+1d8+1d6",
  56: "2d20+2d8", 58: "2d20+1d10+1d8", 60: "3d20", 62: "2d20+1d12+1d10", 64: "3d20+1d4", 66: "3d20+1d6", 68: "3d20+1d8", 70: "3d20+1d10",
  72: "3d20+1d12", 74: "3d20+1d8+1d6", 76: "3d20+2d8", 78: "3d20+1d10+1d8", 80: "4d20" };

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

// ─── d20 stat-block conversion (GMG 11.2.0, 11.5.0, 11.7.0) ───────────────────

/** Source abilities for each Attribute (GMG 11.2.0). */
export const SOURCE_ABILITIES = { might: ["str", "con"], finesse: ["dex", "con"], wit: ["int", "wis"], presence: ["cha", "wis"] };

/**
 * Assign Attributes from Ability Scores (GMG 11.7.0): average each Attribute's two source abilities, take the
 * center of the four, and move an Attribute one step for each full 4 points from the center.
 */
export function abilitySteps(scores) {
  const source = {};
  for (const [attr, [a, b]] of Object.entries(SOURCE_ABILITIES)) source[attr] = ((Number(scores[a]) || 10) + (Number(scores[b]) || 10)) / 2;
  const center = Object.values(source).reduce((n, v) => n + v, 0) / 4;
  const steps = {};
  for (const [attr, v] of Object.entries(source)) {
    const d = v - center;
    const mag = Math.floor(Math.abs(d) / 4);
    steps[attr] = d < 0 ? -mag : mag;
  }
  return { source, center, steps };
}

/** Armor Class to physical Resistance (GMG 11.5.0). */
export const acToResistance = ac => (ac >= 20 ? 3 : ac >= 17 ? 2 : ac >= 13 ? 1 : 0);

