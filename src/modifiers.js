/**
 * src/modifiers.js
 * Aggregates the flat modifiers an actor's items grant, so Training and
 * Resistance reflect Backgrounds, worn Equipment, charms, and Feats (PHB 2.5.0,
 * 6.6.0, 7.5.4). Pure function, no Foundry globals, so it is unit-testable.
 * Resistance also records what granted it.
 */

import { SKILL_KEYS, RESISTANCE_KINDS, ATTRIBUTE_KIND, LEGACY_SKILL_KEY } from "./constants.js";

// Equipment whose Resistance or Skill bonus applies only while worn or carried in hand.
const WORN = new Set(["armor", "shield", "ward", "charm"]);

const skillKey = k => LEGACY_SKILL_KEY[k] ?? k;

/**
 * @param {Array} items  [{ name, type, system }]
 * Training (Backgrounds, Feats) counts toward a Skill's Training cap; a
 * Skill bonus from gear (a charm, a Buckler) adds to rolls but isn't Training.
 * @returns {{ training: Record<string,number>, skillBonus: Record<string,number>, resistance: Record<string,number>,
 *             resistanceSources: Record<string, Array<{name:string, value:number}>> }}
 */
export function aggregateModifiers(items = []) {
  const training = Object.fromEntries(SKILL_KEYS.map(k => [k, 0]));
  const skillBonus = Object.fromEntries(SKILL_KEYS.map(k => [k, 0]));
  const resistance = Object.fromEntries(RESISTANCE_KINDS.map(k => [k, 0]));
  const resistanceSources = Object.fromEntries(RESISTANCE_KINDS.map(k => [k, []]));

  const kindOf = key => (key in resistance) ? key : ATTRIBUTE_KIND[key];
  const addResistance = (key, value, name) => {
    const kind = kindOf(key);
    const v = Number(value ?? 0);
    if (!kind || !v) return;
    resistance[kind] += v;
    const seen = resistanceSources[kind].find(e => e.name === name);
    if (seen) seen.value += v;
    else resistanceSources[kind].push({ name: name || "Unnamed", value: v });
  };
  const addTraining = (key, value) => {
    const k = skillKey(key);
    if (k in training) training[k] += Number(value ?? 0);
  };

  for (const it of items) {
    const s = it.system ?? {};
    switch (it.type) {
      case "background":
        for (const [k, v] of Object.entries(s.training ?? {})) addTraining(k, v);
        break;
      case "equipment":
        if (!WORN.has(s.category) || s.location !== "equipped") break;
        for (const q of s.qualities ?? []) {
          if (q.key === "resistance") addResistance(q.param, q.value, it.name);
          else if (q.key === "skill-bonus" && skillKey(q.param) in skillBonus) skillBonus[skillKey(q.param)] += Number(q.value ?? 0);
        }
        break;
      case "feat":
        for (const m of s.modifiers ?? []) {
          if (m.type === "training") addTraining(m.key, m.value);
          else if (m.type === "resistance") addResistance(m.key, m.value, it.name);
        }
        break;
    }
  }
  for (const k of RESISTANCE_KINDS) resistanceSources[k].sort((a, b) => b.value - a.value);
  return { training, skillBonus, resistance, resistanceSources };
}
