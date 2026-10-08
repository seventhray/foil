/** Condition modifiers on rolls and on Techniques rolled against a target (PHB 6.8.0). */
import { conditionMods, incomingMods, skillFormula, kindOf } from "../../src/combat.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  if (!ok) failed++;
};

const c = (name, note = "") => ({ name, rounds: "", note });
check("Weakened on a named Attribute hits Skills built on it", conditionMods([c("Weakened", "Might 2")], { skill: "prowess" }).total, -2);
check("Weakened on a named Attribute spares other Skills", conditionMods([c("Weakened", "Might 2")], { skill: "resonance" }).total, 0);
check("Weakened with no Attribute named hits every roll", conditionMods([c("Weakened", "")], { skill: "guile" }).total, -1);
check("Weakened instances stack", conditionMods([c("Weakened", "wit 1"), c("Weakened", "Wit 2")], { skill: "acuity" }).total, -3);
check("Reeling only touches Oppose rolls", [conditionMods([c("Reeling", "2")], { skill: "acuity" }).total, conditionMods([c("Reeling", "2")], { skill: "acuity", oppose: true }).total], [0, -2]);
check("Blinded -2 and Prone -1", conditionMods([c("Blinded"), c("Prone")], { skill: "prowess" }).total, -3);
check("Invisible -2 against the attack, Prone +1 for Melee only", [incomingMods([c("Invisible")]).total, incomingMods([c("Prone")], { melee: true }).total, incomingMods([c("Prone")]).total], [-2, 1, 0]);
check("formula folds Mass and Conditions", skillFormula({ skills: { prowess: { formula: "2d8" } }, carry: { penalty: 1 }, conditions: [c("Blinded")] }, "prowess", 1), "2d8 - 2");
check("Might and Finesse are physical, Wit and Presence mental", ["might", "finesse", "wit", "presence"].map(kindOf), ["physical", "physical", "mental", "mental"]);

process.exit(failed ? 1 : 0);
