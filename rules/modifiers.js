/**
 * src/modifiers.js
 * Aggregates the flat modifiers an actor's items grant, so Training and
 * Resistance reflect Backgrounds, worn Equipment, charms, and Feats (PHB 2.5.0,
 * 5.2.4, 6.6.0). Pure function, no Foundry globals, so it is unit-testable.
 * Resistance also records what granted it. Resistance keyed to one Attribute
 * (a Ward or armor made for it, PHB 5.2.4) counts only for that Attribute.
 */

import { SKILL_KEYS, RESISTANCE_KINDS, ATTRIBUTE_KEYS, LEGACY_SKILL_KEY } from "./constants.js";
import { RESISTANCE_SCOPES } from "./resist.js";

// Equipment whose Resistance or Skill bonus applies only while worn or carried in hand.
const WORN = new Set(["armor", "shield", "ward", "charm"]);
// Slots that count one item at a time (PHB 6.6.0): the equipped one with the most Resistance.
const ONE_AT_A_TIME = ["armor", "ward"];
const resistanceOf = it => (it.system?.qualities ?? []).reduce((n, q) => n + (q.key === "resistance" ? Number(q.value ?? 0) : 0), 0)
  + (it.system?.enchantment?.bonus?.kind === "resistance" ? Number(it.system.enchantment.bonus.n ?? 0) : 0);

const skillKey = k => LEGACY_SKILL_KEY[k] ?? k;

/**
 * @param {Array} items  [{ name, type, system }]
 * Training (Backgrounds, Feats) counts toward a Skill's Training cap; a
 * Skill bonus from gear (a charm, a Buckler) adds to rolls but isn't Training.
 * Training also records what granted it, as Resistance does (each Background or Feat by name).
 * @returns {{ training: Record<string,number>, trainingSources: Record<string, Array<{name:string, value:number}>>,
 *             skillBonus: Record<string,number>, resistance: Record<string,number>,
 *             resistanceSources: Record<string, Array<{name:string, value:number}>>,
 *             attributeResistance: Record<string,number>,
 *             attributeResistanceSources: Record<string, Array<{name:string, value:number}>> }}
 */
export function aggregateModifiers(items = []) {
  const training = Object.fromEntries(SKILL_KEYS.map(k => [k, 0]));
  const trainingSources = Object.fromEntries(SKILL_KEYS.map(k => [k, []]));
  const skillBonus = Object.fromEntries(SKILL_KEYS.map(k => [k, 0]));
  const resistance = Object.fromEntries(RESISTANCE_KINDS.map(k => [k, 0]));
  const resistanceSources = Object.fromEntries(RESISTANCE_KINDS.map(k => [k, []]));

  const attributeResistance = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, 0]));
  const attributeResistanceSources = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, []]));
  const addResistance = (key, value, name) => {
    const v = Number(value ?? 0);
    const [total, sources] = key in resistance ? [resistance, resistanceSources]
                           : key in attributeResistance ? [attributeResistance, attributeResistanceSources] : [];
    if (!total || !v) return;
    total[key] += v;
    const seen = sources[key].find(e => e.name === name);
    if (seen) seen.value += v;
    else sources[key].push({ name: name || "Unnamed", value: v });
  };
  const addTraining = (key, value, name) => {
    const k = skillKey(key), v = Number(value ?? 0);
    if (!(k in training)) return;
    training[k] += v;
    if (!v) return;
    const seen = trainingSources[k].find(e => e.name === name);
    if (seen) seen.value += v;
    else trainingSources[k].push({ name: name || "Unnamed", value: v });
  };

  let initiative = 0, stealth = 0;
  const narrowResistance = [];
  const counted = new Set();
  for (const cat of ONE_AT_A_TIME) {
    const worn = items.filter(it => it.type === "equipment" && it.system?.category === cat && it.system?.location === "equipped");
    if (worn.length) counted.add(worn.reduce((best, it) => resistanceOf(it) > resistanceOf(best) ? it : best));
  }

  for (const it of items) {
    const s = it.system ?? {};
    switch (it.type) {
      case "background":
        for (const [k, v] of Object.entries(s.training ?? {})) addTraining(k, v, it.name);
        break;
      case "equipment":
        if (!WORN.has(s.category) || s.location !== "equipped") break;
        if (ONE_AT_A_TIME.includes(s.category) && !counted.has(it)) break;
        for (const q of s.qualities ?? []) {
          if (q.key === "resistance") addResistance(q.param, q.value, it.name);
          else if (q.key === "skill-bonus" && skillKey(q.param) in skillBonus) skillBonus[skillKey(q.param)] += Number(q.value ?? 0);
        }
        // Its Enchantment (PHB 5.3.4) applies the same way while it is worn.
        if (s.enchantment?.bonus?.kind === "resistance") addResistance(s.enchantment.bonus.param || "physical", s.enchantment.bonus.n, `${it.name} Enchantment`);
        else if (s.enchantment?.bonus?.kind === "skill" && skillKey(s.enchantment.bonus.param) in skillBonus) skillBonus[skillKey(s.enchantment.bonus.param)] += Number(s.enchantment.bonus.n ?? 0);
        break;
      case "feat":
        for (const m of s.modifiers ?? []) {
          if (m.type === "training") addTraining(m.key, m.value, it.name);
          else if (m.type === "resistance" && RESISTANCE_SCOPES.includes(m.key)) narrowResistance.push({ scope: m.key, material: "", n: Number(m.value ?? 0) });
          else if (m.type === "resistance") addResistance(m.key, m.value, it.name);
          else if (m.type === "initiative") initiative += Number(m.value ?? 0);
          else if (m.type === "stealth") stealth += Number(m.value ?? 0);
        }
        break;
    }
  }
  for (const list of [...Object.values(resistanceSources), ...Object.values(attributeResistanceSources)])
    list.sort((a, b) => b.value - a.value);
  return { training, trainingSources, skillBonus, resistance, resistanceSources, attributeResistance, attributeResistanceSources, initiative, stealth, narrowResistance };
}
