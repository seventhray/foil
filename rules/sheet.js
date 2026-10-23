/**
 * rules/sheet.js
 * What a sheet derives from its stored data: Potential and dice pools, Resistance, Skill rolls and
 * Training caps, Mass, Initiative, and whether the actor is Destroyed. Pure: it works on a plain object
 * and a list of items ({ type, system }), so Foundry's DataModels and the companion app run the same code.
 * Each function sets derived fields on `sys` in place.
 */

import { poolFromCounts } from "./dice.js";
import {
  ATTRIBUTE_KEYS, SKILL_ATTRS, ATTRIBUTE_KIND, RESISTANCE_KINDS, CARRY_FREE_MULTIPLE, RATION_LBS
} from "./constants.js";
import { aggregateModifiers } from "./modifiers.js";
import { skillFormula } from "./combat.js";

/** Stress down to half Potential or less lifts Incapacitation (PHB 6.8.1). */
export function recoveryThreshold(max) {
  return max - Math.floor(max / 2);
}

/** Derived fields shared by characters and creatures. */
export function deriveCore(sys, items = []) {
  const mods = aggregateModifiers(items);

  const attrs = sys.attributes ?? {};
  for (const key of ATTRIBUTE_KEYS) {
    const a = attrs[key];
    if (!a) continue;
    const pool = poolFromCounts(a.dice);
    a.potential ??= {};
    const current = Number(a.potential.current ?? 0);
    a.potential.max = pool.max;
    a.dieCount      = pool.dieCount;
    a.diceFormula   = pool.formula;
    a.min           = pool.min;
    a.avg           = pool.avg;
    a.max           = pool.max;
    // Stored flag, plus a floor: a bar at zero is always Incapacitated.
    a.down          = pool.max > 0 && (!!a.incapacitated || current <= 0);
    a.recoverAt     = recoveryThreshold(pool.max);
    a.validPool     = pool.valid;
    a.kind          = ATTRIBUTE_KIND[key];
  }

  sys.resistance ??= {};
  for (const kind of RESISTANCE_KINDS) {
    const base  = Number(sys.resistance[kind] ?? 0);
    const bonus = Number(mods.resistance[kind] ?? 0);
    const from = base ? [{ name: "Base", value: base }, ...(mods.resistanceSources?.[kind] ?? [])]
                      : (mods.resistanceSources?.[kind] ?? []);
    sys.resistance[`${kind}Base`]  = base;
    sys.resistance[`${kind}Bonus`] = bonus;
    sys.resistance[`${kind}Total`] = base + bonus;
    sys.resistance[`${kind}FromLabel`] = from.map(e => `+${e.value} ${e.name}`).join(", ");
  }
  // Resistance made for one Attribute (PHB 5.2.4) adds to its kind's total for that Attribute only.
  for (const key of ATTRIBUTE_KEYS) {
    const a = attrs[key];
    if (!a) continue;
    const extra = Number(mods.attributeResistance?.[key] ?? 0);
    a.resistanceExtra = extra;
    a.resistanceTotal = Number(sys.resistance[`${a.kind}Total`] ?? 0) + extra;
    a.resistanceFromLabel = (mods.attributeResistanceSources?.[key] ?? []).map(e => `+${e.value} ${e.name}`).join(", ");
  }

  // Mass (PHB 5.2.6): everything equipped or carried, worn Armor included.
  const might = attrs.might?.potential?.max ?? 0;
  const carried = items.reduce((n, it) => n + Number(it.system?.carriedWeight ?? 0), 0)
                + Number(sys.rations ?? 0) * RATION_LBS;
  sys.carry = {
    weight: carried,
    rationMass: Number(sys.rations ?? 0) * RATION_LBS,
    rationEach: RATION_LBS,
    limit: CARRY_FREE_MULTIPLE * might,
    penalty: might > 0 && carried > CARRY_FREE_MULTIPLE * might
      ? Math.ceil(carried / might) - CARRY_FREE_MULTIPLE : 0
  };
  // The Mass math, every term named (PHB 5.2.6).
  sys.carry.math = `Mass ${carried} lbs (items ${carried - sys.carry.rationMass}, rations ${sys.carry.rationMass}); free up to ${CARRY_FREE_MULTIPLE} x Might Potential ${might} = ${sys.carry.limit}`
    + (sys.carry.penalty ? `; penalty: ${carried} / ${might} rounded up, minus ${CARRY_FREE_MULTIPLE} = -${sys.carry.penalty}` : "; no penalty");

  const skills = sys.skills ?? {};
  for (const [key, pair] of Object.entries(SKILL_ATTRS)) {
    const sk = skills[key];
    if (!sk) continue;
    sk.attributes    = pair;
    sk.trainingBase  = Number(sk.training ?? 0);
    sk.trainingBonus = Number(mods.training[key] ?? 0);
    sk.trainingTotal = sk.trainingBase + sk.trainingBonus;
    // Gear's +N to a Skill adds to rolls without being Training (PHB 7.9.4).
    sk.skillBonus    = Number(mods.skillBonus?.[key] ?? 0);
    const flat       = sk.trainingTotal + sk.skillBonus;
    // Training can't pass the dice in the Skill's two pools (PHB 2.2.1).
    sk.trainingCap  = pair.reduce((n, ak) => n + (attrs[ak]?.dieCount ?? 0), 0);
    sk.overCap      = sk.trainingTotal > sk.trainingCap;

    const live = ak => (attrs[ak]?.down ? null : attrs[ak]);
    const sum  = field => pair.reduce((n, ak) => n + (live(ak) ? Number(live(ak)[field] ?? 0) : 0), 0);
    sk.rollMin = sum("min") + flat;
    sk.rollAvg = sum("avg") + flat;
    sk.rollMax = sum("max") + flat;
    // A creature that isn't pushing back sets its Passive Skill as the Difficulty (PHB 2.2.2).
    sk.passive = Math.floor(sk.rollMax / 2);

    const parts = pair.filter(ak => live(ak)?.diceFormula).map(ak => attrs[ak].diceFormula);
    if (flat) parts.push(String(flat));
    sk.formula = parts.join(" + ") || "0";
    sk.usable  = pair.some(ak => live(ak)?.diceFormula);
  }

  // Initiative is an Acuity roll (PHB 6.2.0); Feats add to it.
  sys.narrowResistance = mods.narrowResistance ?? [];
  sys.initiativeBonus = Number(mods.initiative ?? 0);
  sys.initiativeFormula = skillFormula(sys, "acuity", sys.initiativeBonus);

  // Destroyed (PHB 6.8.2): every Attribute Incapacitated at once.
  const active = ATTRIBUTE_KEYS.filter(k => (attrs[k]?.potential?.max ?? 0) > 0);
  sys.destroyed = active.length > 0 && active.every(k => attrs[k].down);
}

/** A character's derived fields: the shared ones, and the XP still to spend. */
export function deriveCharacter(sys, items = []) {
  deriveCore(sys, items);
  sys.xp.available = Number(sys.xp.total ?? 0) - Number(sys.xp.spent ?? 0);
}

/** A creature's derived fields: the shared ones, and Total Potential, the four Potentials added together (PHB Key Terms). */
export function deriveCreature(sys, items = []) {
  deriveCore(sys, items);
  sys.health = ATTRIBUTE_KEYS.reduce((n, k) => n + (sys.attributes[k]?.potential?.max ?? 0), 0);
}
