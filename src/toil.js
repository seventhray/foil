/**
 * src/toil.js
 * One stretch of Toil (PHB 6.11.0): about 8 hours of travel, labor, or other sustained effort.
 * Strain on every Attribute: 1, 2 on a failed roll, 1 more per 2 hours past 8 without a rest,
 * plus the Mass penalty (PHB 5.2.6). Strain ignores Resistance and never overflows (PHB 4.2.3). Pure, so the dialog preview and the update use one plan.
 */

/**
 * @param {{ failed:boolean, overtimeHours:number, massPenalty:number }} stretch
 * @returns {{ stress:number, base:number, overtime:number, extra:number }}
 */
export function toilStretch({ failed = false, overtimeHours = 0, massPenalty = 0 }) {
  const base = failed ? 2 : 1;
  const overtime = Math.max(0, Math.floor((Number(overtimeHours) || 0) / 2));
  const extra = Math.max(0, Math.trunc(Number(massPenalty) || 0));
  return { stress: base + overtime + extra, base, overtime, extra };
}
