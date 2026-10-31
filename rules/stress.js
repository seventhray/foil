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
 * @param {number} a.pierce       Pierce from the Technique, the Instrument's +N, an Enchantment
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

const ATTRS = ["might", "finesse", "wit", "presence"];

/**
 * Stress landing on a target (PHB 6.8.1): it fills the aimed Attribute's current Potential, then the rest
 * overflows onto another Attribute that still has Potential. With one Attribute left to take it, that is the one;
 * with several, the caller chooses. With none left, the target is Destroyed.
 *
 * A generator, so the caller can apply each step as it happens and answer the choice however it likes
 * (Foundry asks in a dialog, the companion app asks in a reducer). It yields
 *   { type: "take", attr, amount, before, after, overflow }   Stress taken from one Attribute, apply it now
 *   { type: "choose", attr, left, room }                      Stress left over; send back one Attribute from `room`
 * and returns { applied: [{ attr, amount }], destroyed, secondWind }.
 *
 * With `secondWind` (GMG 9.5.1), the first Attribute this would Incapacitate stops 1 short of its Potential instead, and the rest
 * overflows onto the others; that Attribute takes no more of this Stress, and what none can take is lost. Its take says
 * secondWind: true, and the return names it in `secondWind` (null when it was not needed).
 *
 * @param {object} a
 * @param {Record<string,number>} a.potentials  each Attribute's current Potential
 * @param {string} a.aim     the Attribute aimed at
 * @param {number} a.amount  the Stress to land
 * @param {boolean} [a.secondWind]  the target's Second Wind is unspent
 */
export function* landStress({ potentials, aim, amount, secondWind = false }) {
  const pot = { ...potentials };
  let left = amount, attr = aim, destroyed = false, held = null;
  const applied = [];
  while (left > 0) {
    let take = Math.min(left, pot[attr] ?? 0);
    const stops = secondWind && !held && take > 0 && take >= pot[attr];
    if (stops) { take = pot[attr] - 1; held = attr; }
    if (take > 0) {
      const before = pot[attr];
      pot[attr] = before - take;
      applied.push({ attr, amount: take });
      left -= take;
      yield { type: "take", attr, amount: take, before, after: pot[attr], overflow: attr !== aim, secondWind: stops };
    }
    if (left <= 0) break;
    const room = ATTRS.filter(k => k !== attr && k !== held && (pot[k] ?? 0) > 0);
    // Nowhere left: Destroyed, unless Second Wind holds an Attribute up, and then the rest is lost.
    if (!room.length) { destroyed = !held; break; }
    if (room.length === 1) attr = room[0];
    else {
      const answer = yield { type: "choose", attr, left, room };
      attr = room.includes(answer) ? answer : room[0];
    }
  }
  return { applied, destroyed, secondWind: held };
}
