/** Condition modifiers on rolls and on Techniques rolled against a target (PHB 6.8.0). */
import { entryLabel, withDuration } from "../../src/pricing.js";
import { reachBand, reachLine, rangeWarning, bandOfFeet } from "../../src/range.js";
import { aggregateModifiers } from "../../src/modifiers.js";
import { parseVulnerable, scopedResistance } from "../../src/resist.js";
import { abilitySteps, acToResistance, vulnerableRefund, creatureNumbers, tierFor, crToThreat, diceFor, assignAttributes } from "../../src/creature-math.js";
import { NATURAL_WEAPONS, MONSTER_FEATS, TRAITS } from "../../src/creature-data.js";
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

const def = (key, ml) => ({ key, pricingKind: "perPoint", magnitudeLabel: ml, label: ml });
check("effect labels show N and duration", [entryLabel({ key: "weaken", magnitude: 2 }, def("weaken", "-N [target Attribute]")), entryLabel({ key: "reeling-minute", magnitude: 3 }, def("reeling-minute", "-N Oppose")), entryLabel({ key: "mend", magnitude: 2 }, def("mend", "Mend Nd4"))], ["-2 [target Attribute] (1 round)", "-3 Oppose (1 minute)", "Mend 2d4"]);
check("a Lasts choice swaps an Effect for its 1-minute twin", [withDuration("reeling", true), withDuration("reeling-minute", false), withDuration("pierce", true)], ["reeling-minute", "reeling", "pierce"]);

check("feet map to the PHB 4.1.2 bands", [0, 4, 5, 19, 20, 99, 100, 300].map(bandOfFeet), ["touching", "touching", "close", "near", "short", "mid", "long", "sight"]);
check("reach lines read plainly", [reachLine("close"), reachLine("", "near"), reachLine("short", "near"), reachLine("")], ["Reach: up to Close.", "Reach: Near or farther.", "Reach: Near to Short.", ""]);
check("Extend Range adds bands to the Instrument's reach", [reachBand("close", 1), reachBand("long", 3), reachBand("", 2)], ["near", "sight", ""]);
check("range warnings only fire outside the reach", [rangeWarning("Orc", 8, "close"), rangeWarning("Orc", 35, "close").includes("reach ends at Close"), rangeWarning("Orc", 12, "short", "near"), rangeWarning("Orc", 6, "short", "near").includes("needs Near")], ["", true, "", true]);

const feat = (name, modifiers) => ({ name, type: "feat", system: { modifiers } });
const agg = aggregateModifiers([feat("Cave Reflexes", [{ type: "initiative", key: "", value: 2 }]), feat("Vigilant", [{ type: "initiative", key: "", value: 2 }]),
  feat("Camouflaged Skin", [{ type: "stealth", key: "", value: 2 }]), feat("Dark Sight", [{ type: "training", key: "acuity", value: 2 }])]);
check("Feat modifiers add to Initiative, Stealth, and Training", [agg.initiative, agg.stealth, agg.training.acuity], [4, 2, 2]);

const atk = { types: ["edged", "pointed"], families: ["melee"], damageTypes: ["edged", "pointed"], materials: "Metal + Leather", kind: "physical" };
check("old Vulnerable text becomes scoped rows", parseVulnerable("Fire 2, silver 1, Melee 1"), [{ scope: "fire", material: "", n: 2 }, { scope: "material", material: "silver", n: 1 }, { scope: "melee", material: "", n: 1 }]);
check("Vulnerable nets against a matching Instrument Type, Family, and Material only", [
  scopedResistance({ vulnerabilities: [{ scope: "edged", n: 2 }] }, atk).net,
  scopedResistance({ vulnerabilities: [{ scope: "melee", n: 1 }, { scope: "fire", n: 3 }] }, atk).net,
  scopedResistance({ vulnerabilities: [{ scope: "material", material: "metal", n: 1 }] }, atk).net,
  scopedResistance({ vulnerabilities: [{ scope: "mental", n: 4 }] }, atk).net], [-2, -1, -1, 0]);
check("narrow Resistance adds and Vulnerable subtracts", scopedResistance({ vulnerabilities: [{ scope: "edged", n: 1 }], narrowResistance: [{ scope: "edged", n: 3 }] }, atk).net, 2);

const tierRows = [[1, -384, 8, 32, 0, 4, 16], [4, 0, 20, 80, 16, 40, 40], [5, 128, 24, 96, 16, 81, 48], [7, 384, 32, 128, 24, 111, 64], [9, 1152, 56, 224, 32, 162, 112], [10, 1536, 68, 272, 40, 181, 136]];
check("creature formulas reproduce the GMG tier table", tierRows.map(([t, th]) => { const n = creatureNumbers(th); return [n.tier, n.potential, n.totalPotential, n.resistanceBudget, n.allowance, n.ceiling]; }),
  tierRows.map(([t, th, p, tp, rb, a, c]) => [t, p, tp, rb, a, c]));
check("a tier is the nearest anchor, a tie going lower", [tierFor(64), tierFor(65), tierFor(-1000), tierFor(2000)], [4, 5, 1, 10]);
check("CR converts to Threat, past CR 21 by 64 each", [crToThreat("9"), crToThreat("1/2"), crToThreat("24")], [424, -128, 1728]);
check("Threat 1728 gives Potential 74 and Allowance 190", [creatureNumbers(1728).potential, creatureNumbers(1728).allowance], [74, 190]);
check("dice follow the Target Potential table", [diceFor(20).formula, diceFor(14).formula, diceFor(3).formula, diceFor(50).formula, diceFor(1).formula], ["1d20", "1d6+1d8", "1d4", "2d20+1d10", "none"]);
check("Assign Attributes moves two Potential a step and flags a bad total", [assignAttributes(20, { might: 2, finesse: 0, wit: -1, presence: -1 }).potentials.might, assignAttributes(20, { might: 2, finesse: 0, wit: -1, presence: -1 }).notes.length, assignAttributes(20, { might: 2, finesse: 2, wit: 0, presence: 0 }).notes.length], [24, 0, 1]);

check("the GMG's Natural Weapons, Monster Feats, and Traits load", [NATURAL_WEAPONS.length, MONSTER_FEATS.length, TRAITS.length, NATURAL_WEAPONS.filter(w => w.pick).length], [44, 16, 14, 3]);
check("Legendary Action prices per use and Specialized Resistance per point", [MONSTER_FEATS.find(f => f.name === "Legendary Action").per, MONSTER_FEATS.find(f => f.name === "Specialized Resistance").per], ["use", "point"]);

const brute = abilitySteps({ str: 25, dex: 9, con: 23, int: 10, wis: 14, cha: 13 });
check("the GMG brute example steps Might up and Wit down", [brute.steps.might, brute.steps.finesse, brute.steps.wit, brute.steps.presence, brute.center], [1, 0, -1, 0, 16.375]);
const controller = abilitySteps({ str: 11, dex: 16, con: 16, int: 20, wis: 14, cha: 16 });
check("the GMG controller example moves nothing", Object.values(controller.steps), [0, 0, 0, 0]);
check("AC converts to physical Resistance by the table", [10, 12, 13, 16, 17, 19, 20, 25].map(acToResistance), [0, 0, 1, 1, 2, 2, 3, 3]);
check("Vulnerable refunds by scope: Broad 8, Family 2 or 4, damage type 1 or 2", vulnerableRefund([{ scope: "physical", n: 1 }, { scope: "kinetic", n: 4 }, { scope: "sonic", n: 1 }, { scope: "fire", n: 2 }, { scope: "psychic", n: 1 }]), 8 + 8 + 4 + 2 + 2);

process.exit(failed ? 1 : 0);
