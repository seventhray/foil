/** Condition modifiers on rolls and on Techniques rolled against a target (PHB 6.8.0). */
import { restPlan } from "../../src/rest.js";
import { conditionMods, conditionFlags, allowedAims, targetFlags, harmFlags, incomingMods, skillFormula, kindOf } from "../../src/combat.js";

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

check("Frightened and Restrained are flagged, not applied", [conditionFlags([c("Frightened"), c("Restrained")], { skill: "prowess" }).length, conditionMods([c("Frightened"), c("Restrained")], { skill: "prowess" }).total], [2, 0]);
check("Restrained is not flagged for a Skill without Finesse", conditionFlags([c("Restrained")], { skill: "resonance" }), []);
check("Technique-use Conditions flag only for Techniques", [conditionFlags([c("Stunned"), c("Charmed")]).length, conditionFlags([c("Stunned"), c("Charmed")], { technique: true }).length], [0, 2]);
check("Invisible target and harm-ended Conditions are flagged", [targetFlags([c("Invisible")]).length, harmFlags([c("Charmed"), c("Enthralled"), c("Prone")]).length], [1, 2]);
check("Weakened with no Attribute named says so", conditionMods([c("Weakened", "")], { skill: "guile" }).parts[0].label.includes("no Attribute named"), true);

const T = (key, family) => ({ key, family });
check("a stated Deals Stress line decides the Attributes", allowedAims({ text: "Deals Stress to Presence or Wit.", stressTypes: [T("edged", "melee")] }), ["wit", "presence"]);
check("Edged reaches physical Attributes only", allowedAims({ stressTypes: [T("edged", "melee")] }), ["might", "finesse"]);
check("Incorporeal reaches mental Attributes only", allowedAims({ stressTypes: [T("incorporeal", "arcane")] }), ["wit", "presence"]);
check("Kinetic reaches both", allowedAims({ stressTypes: [T("kinetic", "arcane")] }), ["might", "finesse", "wit", "presence"]);
check("the Technique's required Type narrows a multi-Type Instrument", allowedAims({ stressTypes: [T("kinetic", "arcane"), T("incorporeal", "arcane")], requires: ["incorporeal"] }), ["wit", "presence"]);

const hurt = [{ key: "might", cur: 4, max: 10 }, { key: "wit", cur: 9, max: 10 }];
const plan = restPlan(hurt, { might: 2, wit: 2 }, 1);
check("rest: 8 hours on one ration feeds all four blocks", [plan.hours, plan.used, plan.short, plan.unfedHours], [8, 1, 0, 0]);
check("rest: expected recovery is 2.5 a block, capped at what is missing", [plan.rows[0].avgRec, plan.rows[1].avgRec, plan.rows[1].best], [5, 1, 10]);
const thin = restPlan(hurt, { might: 3, wit: 2 }, 1);
check("rest: unfed blocks fall to the later Attributes", [thin.rows[0].fed, thin.rows[1].fed, thin.short, thin.unfedHours], [3, 1, 1, 2]);
check("rest: creatures track no rations", [restPlan(hurt, { might: 2 }, null).used, restPlan(hurt, { might: 2 }, null).rows[0].fed], [0, 2]);

process.exit(failed ? 1 : 0);
