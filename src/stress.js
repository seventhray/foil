/**
 * src/stress.js
 * A landed Technique's Stress (PHB 6.7.0). Pure, so it runs headlessly.
 *
 *   margin (attack - Oppose; a tie lands at 0), doubled through a Heavy Instrument,
 *   then capped by its weight: half its Primary Potential for Light, all of it for
 *   Medium or Heavy.
 *   Only the margin is capped; the bonuses below add after it
 *   + the bonus of the Type the Technique was declared with (Edged: physical Resistance, after
 *     Pierce, counts double), and Drawn or Fired on top of it (PHB 4.1.1)
 *   + the Technique's own bonus, and any other stated bonus
 *   - Resistance after Pierce (Pierce never takes it below 0; a negative Resistance is
 *     negative Resistance and adds, PHB 6.6.0), to a minimum of 0.
 */

/**
 * @param {object} a
 * @param {number} a.attack       the Technique's roll
 * @param {number} a.oppose       the target's Oppose roll
 * @param {number} a.cap          the margin cap (see above)
 * @param {string} a.capLabel     how the cap was set, such as "half Might Potential"
 * @param {number} a.mult         the weight's margin multiplier (a.double is the older Heavy flag)
 * @param {"physical"|"mental"} a.kind  the kind of Attribute aimed at
 * @param {number} a.resistance   the target's Resistance of that kind (negative adds Stress)
 * @param {object|null} a.type    { label, physical, mental, pierce, doubleResistance }
 * @param {object[]} a.always    Types whose bonus is never chosen and always adds (Drawn, Fired)
 * @param {number} a.bespoke      the Technique's own bonus
 * @param {number} a.other        any other bonus (a Feat such as Heavy Hand)
 * @param {number} a.pierce       Pierce from the Technique, the Instrument's +N, a Focus Gem
 * @returns {{ landed:boolean, stress:number, margin:number, capped:number, parts:string[] }}
 */
/** Drawn and Fired are not chosen: their bonus adds to every Technique through the Instrument (PHB 4.1.1). */
export const ALWAYS_TYPES = ["drawn", "fired"];
export const isAlwaysType = t => ALWAYS_TYPES.includes(String(t?.key ?? t?.label ?? "").toLowerCase());
/** The always-on Types of a list, leaving out the one that was (wrongly) picked as the chosen Type. */
export const alwaysTypes = (types = [], chosen = null) => (types ?? []).filter(t => isAlwaysType(t) && t !== chosen);

export function stressFor({ attack, oppose, cap, kind = "physical", resistance = 0, resistanceParts = null, type = null, always = [],
                            bespoke = 0, bespokeParts = null, other = 0, pierce = 0, pierceParts = null, name = "the Technique",
                            capAttr = "", capLabel = "", double = false, mult = 1, multLabel = "" }) {
  const sgn = n => `${n < 0 ? "-" : "+"}${Math.abs(n)}`;
  const list = (parts, total, fallback) => (parts?.length ? parts : total ? [{ label: fallback, value: total }] : []);
  const raw = Number(attack) - Number(oppose);
  const m = double ? 2 : Number(mult) || 1;
  const margin = m !== 1 && raw > 0 ? Math.floor(raw * m) : raw;
  const parts = [`margin ${attack} - ${oppose} = ${raw}`];
  if (raw < 0) return { landed: false, stress: 0, margin, capped: 0, parts: [...parts, "the Oppose beat it"] };
  parts.push(`x${m}${multLabel ? ` (${multLabel})` : ""} = ${margin}`);
  const capNum = Math.max(0, Number(cap) || 0);
  const capped = Math.min(margin, capNum);
  parts.push(`cap ${capNum}${capLabel ? ` (${capLabel})` : capAttr ? ` (half ${capAttr} Potential)` : ""}: ${capped}`);

  const adds = [];
  let totalPierce = 0;
  const pierces = list(pierceParts, Number(pierce) || 0, "Pierce").map(p => ({ label: p.label, value: Number(p.value) || 0 }));
  if (type) {
    const b = kind === "physical" ? Number(type.physical ?? 0) : Number(type.mental ?? 0);
    adds.push({ label: `${type.label} (declared Type)`, value: b });
    if (kind === "physical" && Number(type.pierce ?? 0)) pierces.push({ label: type.label, value: Number(type.pierce) });
  } else adds.push({ label: "declared Type: none", value: 0 });
  for (const a of always ?? []) adds.push({ label: a.label, value: kind === "physical" ? Number(a.physical ?? 0) : Number(a.mental ?? 0) });
  const own = list(bespokeParts, Number(bespoke) || 0, name);
  if (own.length) adds.push(...own.map(p => ({ label: p.label, value: Number(p.value) || 0 })));
  else adds.push({ label: name, value: 0 });
  adds.push({ label: "other", value: Number(other) || 0 });
  parts.push(...adds.map(a => `${a.label} ${sgn(a.value)}`));
  totalPierce = pierces.reduce((n, p) => n + p.value, 0);

  const res = Number(resistance) || 0;
  let effRes = res > 0 ? Math.max(0, res - totalPierce) : res;
  const doubled = !!type?.doubleResistance && kind === "physical" && effRes > 0;
  if (doubled) effRes *= 2;
  const from = resistanceParts?.length ? ` (${resistanceParts.join(", ")})` : "";
  parts.push(`Resistance ${res}${from}`);
  parts.push(`Pierce ${totalPierce}${pierces.length ? ` (${pierces.map(p => `${p.label} ${p.value}`).join(", ")})` : ""}${res > 0 ? `, leaves ${Math.max(0, res - totalPierce)}` : res < 0 ? ", none to lower" : ""}`);
  if (doubled) parts.push(`doubled against ${type.label}: ${effRes}`);
  if (res < 0) parts.push(`Resistance below 0 adds ${-res}`);
  const sum = adds.reduce((n, a) => n + a.value, 0);
  const before = capped + sum - effRes;
  const stress = Math.max(0, before);
  parts.push(`${capped} ${sgn(sum)} ${effRes < 0 ? "+" : "-"} ${Math.abs(effRes)} = ${before}${before < 0 ? ", raised to 0" : ""}`);
  return { landed: true, stress, margin, capped, parts };
}
