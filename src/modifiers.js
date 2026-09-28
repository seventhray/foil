/**
 * src/modifiers.js
 * Aggregates the flat stat modifiers an actor's items grant, so Training and
 * Resistance reflect Backgrounds, worn Equipment, and Feats (PHB §2.5.0: base
 * Training +0 / Resistance 0, Background grants +1 Training ×3, Equipment adds
 * Resistance). Pure function — no Foundry globals — so it is unit-testable.
 *
 * Resistance also records what granted it. A number on its own tells a player
 * their armor is working but not which armor, which matters the moment they
 * carry two sources or wonder why a total changed.
 */

import { APTITUDE_KEYS, RESISTANCE_KINDS, ATTRIBUTE_KIND } from "./constants.js";

// Equipment categories whose Resistance applies only while worn/equipped.
const WORN = new Set(["armor", "shield", "ward"]);

/**
 * @param {Array} items  [{ name, type, system }]
 * @returns {{ training: Record<string,number>,
 *             resistance: Record<string,number>,
 *             resistanceSources: Record<string, Array<{name:string, value:number}>> }}
 */
export function aggregateModifiers(items = []) {
  const training = Object.fromEntries(APTITUDE_KEYS.map(k => [k, 0]));
  const resistance = Object.fromEntries(RESISTANCE_KINDS.map(k => [k, 0]));
  const resistanceSources = Object.fromEntries(RESISTANCE_KINDS.map(k => [k, []]));

  // A Quality or Feat modifier may name the kind directly ("physical") or, from
  // a pre-v0.2.0 entry, an Attribute; map either onto a kind.
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

  for (const it of items) {
    const s = it.system ?? {};
    switch (it.type) {
      case "background":
        for (const k of APTITUDE_KEYS) training[k] += Number(s.training?.[k] ?? 0);
        break;
      case "equipment":
        if (!WORN.has(s.category) || !s.equipped) break;
        for (const q of s.qualities ?? []) {
          if (q.key === "resistance") addResistance(q.param, q.value, it.name);
        }
        break;
      case "feat":
        // Only the few Feats that carry a flat modifier (e.g. Tempered);
        // conditional/prose Feats leave `modifiers` empty and contribute nothing.
        for (const m of s.modifiers ?? []) {
          const v = Number(m.value ?? 0);
          if (m.type === "training" && m.key in training) training[m.key] += v;
          else if (m.type === "resistance") addResistance(m.key, v, it.name);
        }
        break;
    }
  }
  // Biggest contributor first, so a glance lands on what is doing the work.
  for (const k of RESISTANCE_KINDS) resistanceSources[k].sort((a, b) => b.value - a.value);
  return { training, resistance, resistanceSources };
}
