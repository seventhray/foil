/**
 * src/resist.js
 * Narrow Resistance against an incoming hit (Specialized Resistance, GMG 9.5.1). It counts when the
 * attack's Instrument has the Type, or belongs to the Family, that the Resistance names.
 * Pure, so it runs headlessly.
 */

/** Instrument Families (PHB 4.1.1): Melee, Ranged, Arcane, each a group of Types. */
export const RESISTANCE_FAMILIES = {
  melee: ["edged", "pointed", "blunt", "grappling", "parry"],
  ranged: ["thrown", "drawn", "fired"],
  arcane: ["kinetic", "incorporeal", "fortifying"]
};

/** Instrument Types a Specialized Resistance can name. */
export const RESISTANCE_TYPES = ["edged", "pointed", "blunt", "grappling", "thrown", "drawn", "fired", "kinetic", "incorporeal", "sonic"];

/** Every scope key a narrow Resistance row accepts. */
export const RESISTANCE_SCOPES = [...Object.keys(RESISTANCE_FAMILIES), ...RESISTANCE_TYPES];

/** One scope choice per row: Broad, a Family, or an Instrument Type. */
export const SCOPE_GROUPS = [
  { label: "Broad", options: [["physical", "Physical"], ["mental", "Mental"]] },
  { label: "Family", options: Object.keys(RESISTANCE_FAMILIES).map(f => [f, f.replace(/^./, c => c.toUpperCase())]) },
  { label: "Instrument Type", options: RESISTANCE_TYPES.map(t => [t, t.replace(/^./, c => c.toUpperCase())]) }
];

export const scopeLabel = entry => entry.scope.replace(/^./, c => c.toUpperCase());

/** The Families an Instrument's Types belong to. */
export const familiesOf = types => Object.entries(RESISTANCE_FAMILIES).filter(([, members]) => types.some(t => members.includes(t))).map(([f]) => f);

/**
 * Does one scope apply to this attack?
 * @param {object} attack { types:[slug], families:[slug], kind:"physical"|"mental" }
 */
export function scopeApplies(entry, attack) {
  const s = entry.scope;
  if (s === "physical" || s === "mental") return attack.kind === s;
  if (s in RESISTANCE_FAMILIES) return (attack.families ?? []).includes(s);
  return (attack.types ?? []).includes(s);
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
