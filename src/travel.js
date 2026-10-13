/**
 * src/travel.js
 * One Travel leg (PHB 6.11.0): 1 Stress to every Attribute, 2 on a failed leg roll, plus the
 * Mass penalty (PHB 5.2.6), and one ration. Pure, so the dialog preview and the update use one plan.
 */

/**
 * @param {{ failed:boolean, massPenalty:number, rations:number|null }} leg
 * @returns {{ stress:number, base:number, extra:number, rationUsed:boolean }}
 */
export function travelLeg({ failed = false, massPenalty = 0, rations = null }) {
  const base = failed ? 2 : 1;
  const extra = Math.max(0, Math.trunc(Number(massPenalty) || 0));
  return { stress: base + extra, base, extra, rationUsed: rations === null ? false : rations > 0 };
}
