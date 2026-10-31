/**
 * rules/feats.js
 * What Learned Feats add to a Technique (PHB 7.2.2), found by the Feat's name on the actor: +1 to the roll (Brawler, Deadeye,
 * Silver Tongue), or +1 Stress when it deals Stress (Heavy Hand, Hunter's Mark, Focused Blast, Cutting Word, Cruel Whisper).
 * A built-in Technique is a Technique. A Melee or Ranged Technique is one through an Instrument of that Family (PHB 4.1.1).
 * Pure. rollKitSteps and rollTechniqueSteps add them when the host passes { feats: true }.
 */

import { familiesOf } from "./resist.js";

/** Each Feat: its name, what it adds, and when, from the Instrument's Types and Families and the Attribute targeted. */
export const FEAT_BONUSES = [
  { name: "Brawler", roll: 1, when: t => t.families.includes("melee") },
  { name: "Deadeye", roll: 1, when: t => t.families.includes("ranged") },
  { name: "Silver Tongue", roll: 1, when: t => t.target === "wit" || t.target === "presence" },
  { name: "Heavy Hand", stress: 1, when: t => t.families.includes("melee") },
  { name: "Hunter's Mark", stress: 1, when: t => t.families.includes("ranged") },
  { name: "Focused Blast", stress: 1, when: t => t.types.includes("kinetic") },
  { name: "Cutting Word", stress: 1, when: t => t.types.includes("sonic") },
  { name: "Cruel Whisper", stress: 1, when: t => t.types.includes("incorporeal") }
];

/**
 * The Feat bonuses for one Technique, as named parts: { roll: [{ label, value }], stress: [{ label, value }] }.
 * @param {object} actor  { items }
 * @param {object} a
 * @param {string[]} a.types   the Instrument's Types; none for an innate Technique
 * @param {string} a.target    the Attribute it targets: the one aimed at, or the one its Condition is resisted with
 * @param {boolean} a.stress   whether it deals Stress
 */
export function featBonuses(actor, { types = [], target = "", stress = false }) {
  const held = new Set((actor?.items ?? []).filter(i => i.type === "feat").map(i => String(i.name).trim().toLowerCase()));
  const t = { types, families: familiesOf(types), target };
  const out = { roll: [], stress: [] };
  for (const f of FEAT_BONUSES) {
    if (!held.has(f.name.toLowerCase()) || !f.when(t)) continue;
    if (f.roll) out.roll.push({ label: f.name, value: f.roll });
    if (f.stress && stress) out.stress.push({ label: f.name, value: f.stress });
  }
  return out;
}
