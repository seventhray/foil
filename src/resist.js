/**
 * src/resist.js
 * Vulnerable and narrow Resistance against an incoming hit (PHB 6.6.0, GMG 4.3.0).
 * Pure, so it runs headlessly. A Vulnerable N or a narrow Resistance counts when the
 * attack's Instrument has the Type, the Family, the damage type, or the Material it names.
 */

import { DAMAGE_TYPES } from "./constants.js";

/** Instrument Type families a Vulnerable can name (GMG 4.3.0). */
export const VULNERABLE_FAMILIES = { melee: "physical", ranged: "physical", grappling: "physical", kinetic: "physical", sonic: "mental", incorporeal: "mental" };

/** One scope choice per row: Broad, a Family, a damage type or Instrument Type, or a Material. */
export const SCOPE_GROUPS = [
  { label: "Broad", options: [["physical", "Physical"], ["mental", "Mental"]] },
  { label: "Family", options: Object.keys(VULNERABLE_FAMILIES).map(f => [f, f.replace(/^./, c => c.toUpperCase())]) },
  { label: "Damage type or Instrument Type", options: Object.keys(DAMAGE_TYPES).map(d => [d, d.replace(/^./, c => c.toUpperCase())]) },
  { label: "Material", options: [["material", "Material (name it)"]] }
];

export const scopeLabel = (entry) => entry.scope === "material" ? `${entry.material || "a Material"}`
  : entry.scope.replace(/^./, c => c.toUpperCase());

/** "Fire 2, silver 1" from the old free-text field. */
export function parseVulnerable(text) {
  const out = [];
  for (const part of String(text ?? "").split(/[,;]/)) {
    const m = part.trim().match(/^(.+?)\s+(\d+)$/);
    if (!m) continue;
    const name = m[1].trim().toLowerCase();
    if (name in DAMAGE_TYPES || name in VULNERABLE_FAMILIES || name === "physical" || name === "mental") out.push({ scope: name, material: "", n: +m[2] });
    else out.push({ scope: "material", material: m[1].trim(), n: +m[2] });
  }
  return out;
}

/**
 * Does one scope apply to this attack?
 * @param {object} attack { types:[slug], families:[slug], damageTypes:[slug], materials:string, kind:"physical"|"mental" }
 */
export function scopeApplies(entry, attack) {
  const s = entry.scope;
  if (s === "physical" || s === "mental") return attack.kind === s;
  if (s === "material") return !!entry.material && String(attack.materials ?? "").toLowerCase().includes(entry.material.toLowerCase());
  if (s in VULNERABLE_FAMILIES) return (attack.families ?? []).includes(s);
  return (attack.types ?? []).includes(s) || (attack.damageTypes ?? []).includes(s);
}

/**
 * Net change to Resistance from this attack: narrow Resistance adds, Vulnerable subtracts.
 * @returns {{ net:number, parts:string[] }}
 */
export function scopedResistance({ vulnerabilities = [], narrowResistance = [] } = {}, attack = {}) {
  let net = 0;
  const parts = [];
  for (const v of narrowResistance) {
    if (scopeApplies(v, attack)) { net += Number(v.n); parts.push(`${scopeLabel(v)} Resistance +${v.n}`); }
  }
  for (const v of vulnerabilities) {
    if (scopeApplies(v, attack)) { net -= Number(v.n); parts.push(`Vulnerable to ${scopeLabel(v)} ${v.n}`); }
  }
  return { net, parts };
}
