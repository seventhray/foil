/**
 * src/rest.js
 * Rest (PHB 6.10.0), pure so the dialog's preview and the roll use one plan.
 * 1d4 Stress comes off an Attribute per 2-hour block, and one ration feeds 8 hours.
 * Blocks past what the rations feed heal nothing, taken in Attribute order.
 */

import { REST_BLOCK_HOURS, REST_RATION_HOURS } from "./constants.js";

/**
 * @param {{key:string,cur:number,max:number}[]} attrs  the Attributes that can be rested, in order
 * @param {Record<string,number>} blocks  2-hour blocks chosen per Attribute
 * @param {number|null} rations  rations on hand, or null when none are tracked
 */
export function restPlan(attrs, blocks, rations = null) {
  const total = attrs.reduce((n, a) => n + Math.max(0, Math.trunc(blocks[a.key] ?? 0)), 0);
  const hours = total * REST_BLOCK_HOURS;
  const needed = Math.ceil(hours / REST_RATION_HOURS);
  const used = rations === null ? 0 : Math.min(needed, rations);
  let left = rations === null ? total : Math.min(total, Math.floor(used * REST_RATION_HOURS / REST_BLOCK_HOURS));
  const rows = attrs.map(a => {
    const chosen = Math.max(0, Math.trunc(blocks[a.key] ?? 0));
    const fed = Math.min(chosen, left);
    left -= fed;
    const missing = Math.max(0, a.max - a.cur);
    const avgRec = Math.min(missing, fed * 2.5);
    const maxRec = Math.min(missing, fed * 4);
    return { key: a.key, chosen, fed, hours: chosen * REST_BLOCK_HOURS, missing, avgRec, maxRec,
             expected: a.cur + avgRec, best: a.cur + maxRec, max: a.max, cur: a.cur };
  });
  const sum = f => rows.reduce((n, r) => n + r[f], 0);
  return {
    rows, hours, needed, used, short: rations === null ? 0 : Math.max(0, needed - rations),
    unfedHours: (total - rows.reduce((n, r) => n + r.fed, 0)) * REST_BLOCK_HOURS,
    avgRec: sum("avgRec"), maxRec: sum("maxRec")
  };
}
