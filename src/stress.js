/**
 * src/stress.js
 * A landed Technique's Stress (PHB 6.7.0). Pure, so it runs headlessly.
 *
 *   margin (attack - Oppose; a tie lands at 0), capped at half the Instrument's
 *   Primary Potential
 *   + one Stress-dealing Type's bonus (Edged: none against any physical Resistance)
 *   + the Technique's own bonus, and any other stated bonus
 *   - Resistance after Pierce (Pierce never takes it below 0; Vulnerable is
 *     negative Resistance and adds, PHB 6.6.0), to a minimum of 0.
 */

/**
 * @param {object} a
 * @param {number} a.attack       the Technique's roll
 * @param {number} a.oppose       the target's Oppose roll
 * @param {number} a.cap          half the Primary Attribute's Potential
 * @param {"physical"|"mental"} a.kind  the kind of Attribute aimed at
 * @param {number} a.resistance   the target's Resistance of that kind (negative = Vulnerable)
 * @param {object|null} a.type    { label, physical, mental, pierce, noBonusVsResistance }
 * @param {number} a.bespoke      the Technique's own bonus
 * @param {number} a.other        any other bonus (a Feat such as Heavy Hand)
 * @param {number} a.pierce       Pierce from the Technique, the Instrument's +N, a Focus Gem
 * @returns {{ landed:boolean, stress:number, margin:number, capped:number, parts:string[] }}
 */
export function stressFor({ attack, oppose, cap, kind = "physical", resistance = 0, type = null,
                            bespoke = 0, other = 0, pierce = 0, name = "the Technique", capAttr = "" }) {
  const margin = Number(attack) - Number(oppose);
  if (margin < 0) return { landed: false, stress: 0, margin, capped: 0, parts: ["the Oppose beat it"] };
  const capped = Math.min(margin, Math.max(0, Number(cap) || 0));
  const parts = [`margin ${margin}${capped < margin ? `, capped at ${cap}${capAttr ? ` (half ${capAttr} Potential)` : ""}` : ""}`];
  const res = Number(resistance) || 0;
  let typeBonus = 0, totalPierce = Number(pierce) || 0;
  if (type) {
    typeBonus = kind === "physical" ? Number(type.physical ?? 0) : Number(type.mental ?? 0);
    if (type.noBonusVsResistance && kind === "physical" && res > 0) {
      typeBonus = 0;
      parts.push(`${type.label}: no bonus against any Resistance`);
    } else if (typeBonus) parts.push(`${type.label} ${typeBonus > 0 ? "+" : ""}${typeBonus}`);
    if (kind === "physical") totalPierce += Number(type.pierce ?? 0);
  }
  if (bespoke) parts.push(`+${bespoke} from ${name}`);
  if (other) parts.push(`${other > 0 ? "+" : ""}${other} other`);
  const effRes = res > 0 ? Math.max(0, res - totalPierce) : res;
  if (res > 0) parts.push(`Resistance ${res}${totalPierce ? `, Pierce ${totalPierce} leaves ${effRes}` : ""}`);
  else if (res < 0) parts.push(`Vulnerable ${-res}`);
  const stress = Math.max(0, capped + typeBonus + Number(bespoke || 0) + Number(other || 0) - effRes);
  return { landed: true, stress, margin, capped, parts };
}
