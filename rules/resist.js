/**
 * src/resist.js
 * Narrow Resistance against an incoming hit (Specialized Resistance, GMG 9.5.1). It counts when the attack's Instrument harms the
 * way the Resistance names: Melee or Ranged by its Type, Kinetic or Incorporeal by the Property an Arcane Instrument harmed through,
 * or Sonic. Rows stored before 2026-11-02 name the older Types; they read as the new scope. Pure, so it runs headlessly.
 */

import { channelsOf } from "./types.js";

/** The scopes a Specialized Resistance can name (GMG 9.5.1). */
export const RESISTANCE_TYPES = ["melee", "ranged", "kinetic", "sonic", "incorporeal"];

/** Older scopes, and what each reads as now. "arcane" covered both of an Arcane Instrument's Properties. */
const LEGACY_SCOPE = { edged: ["melee"], pointed: ["melee"], blunt: ["melee"], grappling: ["melee"], thrown: ["ranged"], drawn: ["ranged"],
  fired: ["ranged"], arcane: ["kinetic", "incorporeal"] };

/** Every scope key a narrow Resistance row accepts. */
export const RESISTANCE_SCOPES = [...RESISTANCE_TYPES];

/** Whether a Feat's Resistance modifier names a narrow scope, an older one included, rather than physical, mental or an Attribute. */
export const isResistanceScope = key => RESISTANCE_SCOPES.includes(key) || key in LEGACY_SCOPE;

/** One scope choice per row: Broad, or the way an attack harms. */
export const SCOPE_GROUPS = [
  { label: "Broad", options: [["physical", "Physical"], ["mental", "Mental"]] },
  { label: "Instrument Type or Property", options: RESISTANCE_TYPES.map(t => [t, t.replace(/^./, c => c.toUpperCase())]) }
];

export const scopeLabel = entry => entry.scope.replace(/^./, c => c.toUpperCase());

/**
 * What a hit through an Instrument counts as for narrow Resistance: its Type, and for an Arcane Instrument the Property it was declared
 * through (channel, a key from channelsOf; the first when none is given).
 */
export function attackScopes(types = [], channel = "") {
  const ch = channelsOf(types);
  const pick = ch.find(c => c.key === channel) ?? ch[0];
  return pick ? [pick.key] : [];
}

/**
 * Does one scope apply to this attack?
 * @param {object} attack { types:[scope], kind:"physical"|"mental" }
 */
export function scopeApplies(entry, attack) {
  const s = entry.scope;
  if (s === "physical" || s === "mental") return attack.kind === s;
  const scopes = LEGACY_SCOPE[s] ?? [s];
  // A card made before the rework lists the Instrument's older Types; read them the way a new card names its scope.
  const have = new Set([...(attack.types ?? []), ...attackScopes(attack.types ?? [])]);
  return scopes.some(k => have.has(k));
}

/**
 * Net change to Resistance from this attack: each narrow Resistance that applies adds.
 * @returns {{ net:number, parts:string[] }}
 */
export function scopedResistance({ narrowResistance = [] } = {}, attack = {}) {
  let net = 0;
  const parts = [];
  for (const v of narrowResistance) {
    if (scopeApplies(v, attack)) { net += Number(v.n); parts.push(`${scopeLabel(v)} Resistance ${Number(v.n) < 0 ? "" : "+"}${v.n}`); }
  }
  return { net, parts };
}
