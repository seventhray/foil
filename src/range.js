/**
 * src/range.js
 * Range checks (PHB 4.1.2), pure so they run headlessly. A check only ever
 * produces a note on the roll's card. It never blocks a roll.
 */

import { RANGE_BANDS, RANGE_LABEL } from "./constants.js";

// The last foot of each band; Sight has no end.
export const BAND_END_FEET = { touching: 4, close: 9, near: 19, short: 39, mid: 99, long: 299, sight: Infinity };
export const BAND_START_FEET = { touching: 0, close: 5, near: 10, short: 20, mid: 40, long: 100, sight: 300 };

export const bandOfFeet = feet => RANGE_BANDS.find(b => feet <= BAND_END_FEET[b]) ?? "sight";

/**
 * @param {string} reachBand   the furthest band reached ("" when the Technique states no reach)
 * @param {string} minBand     the nearest band it works from ("" for none)
 * @returns {string} "Reach: Near or farther." and the like
 */
export function reachLine(reachBand, minBand = "") {
  const top = reachBand ? RANGE_LABEL[reachBand] : "";
  const low = minBand ? RANGE_LABEL[minBand] : "";
  if (low && top) return low === top ? `Reach: ${top}.` : `Reach: ${low} to ${top}.`;
  if (low) return `Reach: ${low} or farther.`;
  return top ? `Reach: up to ${top}.` : "";
}

/** The furthest band an Instrument reaches, plus bands a Technique extends it by. */
export function reachBand(instrumentBand, extendBands = 0) {
  if (!instrumentBand) return "";
  const i = RANGE_BANDS.indexOf(instrumentBand) + Math.max(0, Number(extendBands) || 0);
  return RANGE_BANDS[Math.min(RANGE_BANDS.length - 1, Math.max(0, i))];
}

/**
 * A warning when a target sits outside the reach, or "" when it is in range.
 * @param {number} feet  edge-to-edge distance to the target
 */
export function rangeWarning(name, feet, reach, minBand = "") {
  if (!Number.isFinite(feet)) return "";
  const safe = String(name ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const away = `${safe} is about ${Math.round(feet)} ft away (${RANGE_LABEL[bandOfFeet(feet)]})`;
  if (reach && feet > BAND_END_FEET[reach]) return `${away}; reach ends at ${RANGE_LABEL[reach]}, ${BAND_END_FEET[reach]} ft.`;
  if (minBand && feet < BAND_START_FEET[minBand]) return `${away}; this needs ${RANGE_LABEL[minBand]} (${BAND_START_FEET[minBand]} ft) or farther.`;
  return "";
}
