// Model, migration, pricing, and Stress checks against the 0.6.0 rules.
import "./stub-foundry.mjs";
import { SYSTEM_ROOT } from "../books.mjs";
const R = `${SYSTEM_ROOT}/src`;
const { CharacterData, CreatureData, recoveryThreshold } = await import(`${R}/data/actor-models.js`);
const { InstrumentTypeData, EffectData } = await import(`${R}/data/definition-models.js`);
const { InstrumentData, TechniqueData, EquipmentData } = await import(`${R}/data/item-models.js`);
const { aggregateModifiers } = await import(`${R}/modifiers.js`);
const { priceTechnique, strainFor, patternCost, selectiveCost } = await import(`${R}/pricing.js`);
const { stressFor } = await import(`${R}/stress.js`);
const { XP_COST, trainingCost, knowHowCost, marginCap, CONDITION_OPPOSE, CONDITIONS } = await import(`${R}/constants.js`);

let fails = 0;
const check = (label, fn) => { try { const r = fn(); console.log(`  PASS  ${label}${r ? " — " + r : ""}`); } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fails++; } };
const eq = (got, want, what = "") => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what} got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); return JSON.stringify(got); };
const char = (src, items = []) => { const c = new CharacterData(src, { parent: { items: { contents: items } } }); c.prepareDerivedData(); return c; };
const pools = (m, f, w, p) => ({ might: { dice: m, potential: { current: 99 } }, finesse: { dice: f, potential: { current: 99 } },
  wit: { dice: w, potential: { current: 99 } }, presence: { dice: p, potential: { current: 99 } } });

console.log("Advancement costs (PHB 2.3.0):");
check("Talent steps 8/12/16/20 by size, d12 to d20 100", () => eq([XP_COST.talent[4], XP_COST.talent[6], XP_COST.talent[8], XP_COST.talent[10], XP_COST.d12ToD20], [8, 12, 16, 20, 100]));
check("Know-how 12 XP plus 4 per die in the pool", () => eq([{ d4: 2 }, { d4: 3, d12: 1 }, {}].map(knowHowCost), [20, 28, 12]));
check("Training 8 XP plus 2 per point held", () => eq([0, 1, 2, 3].map(trainingCost), [8, 10, 12, 14]));


console.log("Migration from pre-0.6.0 worlds:");
check("Aptitudes become Skills; Fortitude to Discipline, Command to Assertiveness", () => {
  const out = CharacterData.migrateData({ aptitudes: { prowess: { training: 1 }, fortitude: { training: 2 }, command: { training: 3 } } });
  if ("aptitudes" in out) throw new Error("aptitudes not removed");
  return eq([out.skills.prowess.training, out.skills.discipline.training, out.skills.assertiveness.training], [1, 2, 3]);
});
check("FOIL integers become a lean; Leniency becomes Levity", () => {
  const out = CharacterData.migrateData({ foil: { faith: 3, order: -2, individualism: 0, leniency: 1 } });
  return eq([out.foil.faith.lean, out.foil.order.lean, out.foil.individualism.lean, out.foil.levity.lean], ["high", "low", "", "high"]);
});
check("Action Points are dropped", () => { const out = CharacterData.migrateData({ ap: 3 }); return eq("ap" in out, false); });
check("per-Attribute Resistance collapses to physical and mental", () => {
  const out = CreatureData.migrateData({ attributes: { might: { resistance: 4 }, finesse: { resistance: 4 }, wit: { resistance: 1 }, presence: {} } });
  return eq(out.resistance, { physical: 4, mental: 1 });
});
check("Origin becomes Ancestry", () => eq(CharacterData.migrateData({ origin: "Keshwick" }).ancestry, "Keshwick"));
check("Instrument Type bonusStress becomes stressPhysical", () => eq(InstrumentTypeData.migrateData({ bonusStress: 2 }).stressPhysical, 2));
check("Effect pricingKind linear/condition/reaction map to perPoint/flat/quick", () =>
  eq(["linear", "condition", "reaction"].map(k => EffectData.migrateData({ pricingKind: k }).pricingKind), ["perPoint", "flat", "quick"]));
check("legacy Sonic Instrument Types map to sonic", () => eq(new InstrumentData({ types: ["command", "guile", "resonance"] }).types, ["sonic"]));
check("Bolster on a ward becomes a Skill-bonus charm", () => {
  const out = EquipmentData.migrateData({ category: "ward", qualities: [{ key: "bolster", value: 1, param: "command" }] });
  return eq([out.category, out.qualities[0].key, out.qualities[0].param], ["charm", "skill-bonus", "assertiveness"]);
});

console.log("\nAttributes, Skills, Training (PHB 2.1-2.2):");
check("Prowess on 1d12 + 1d10 with Training +1 reads 3 / 13 / 23", () => {
  const c = char({ attributes: pools({ d12: 1 }, { d10: 1 }, { d8: 1 }, { d6: 1 }), skills: { prowess: { training: 1 } } });
  const s = c.skills.prowess; return eq(`${s.rollMin} / ${s.rollAvg} / ${s.rollMax}`, "3 / 13 / 23");
});
check("Training cap is the dice in the two pools", () => {
  const c = char({ attributes: pools({ d6: 2, d4: 1 }, { d8: 1, d4: 2 }, { d4: 2 }, { d4: 2 }) });
  return eq([c.skills.prowess.trainingCap, c.skills.resonance.trainingCap, c.skills.discipline.trainingCap], [6, 4, 5]);
});
check("passive value is floor(average) + Training", () => {
  const c = char({ attributes: pools({ d8: 1 }, { d10: 1 }, { d4: 1 }, { d4: 1 }), skills: { prowess: { training: 1 } } });
  return eq(c.skills.prowess.passive, 11);
});
check("an Incapacitated Attribute drops out of every Skill it feeds", () => {
  const src = { attributes: pools({ d12: 1 }, { d10: 1 }, { d8: 1 }, { d6: 1 }) };
  src.attributes.might.potential.current = 0;
  const c = char(src);
  return eq([c.skills.prowess.formula, c.skills.discipline.formula, c.skills.acuity.formula], ["1d10", "1d8", "1d10 + 1d8"]);
});
check("Incapacitation lifts at Stress half Potential or less, rounded down", () =>
  eq([10, 11, 12, 36].map(recoveryThreshold), [5, 6, 6, 18]));

console.log("\nModifiers (PHB 2.5.2, 6.6.0, 7.5.x):");
const gear = [
  { name: "Leather", type: "equipment", system: { category: "armor", location: "equipped", qualities: [{ key: "resistance", param: "physical", value: 1 }] } },
  { name: "Half Plate", type: "equipment", system: { category: "armor", location: "carried", qualities: [{ key: "resistance", param: "physical", value: 3 }] } },
  { name: "Mental Ward +1", type: "equipment", system: { category: "ward", location: "equipped", qualities: [{ key: "resistance", param: "mental", value: 1 }] } },
  { name: "Charm", type: "equipment", system: { category: "charm", location: "equipped", qualities: [{ key: "skill-bonus", param: "acuity", value: 1 }] } },
  { name: "Tough Hide", type: "feat", system: { modifiers: [{ type: "resistance", key: "physical", value: 2 }] } },
  { name: "Soldier", type: "background", system: { training: { prowess: 1, discipline: 1, assertiveness: 1 } } }
];
check("old equipped flags migrate to a location", () => eq(
  [EquipmentData.migrateData({ equipped: true }).location, EquipmentData.migrateData({ equipped: false }).location], ["equipped", "carried"]));
check("worn Resistance and Feats stack; stowed gear doesn't count", () => {
  const m = aggregateModifiers(gear); return eq([m.resistance.physical, m.resistance.mental], [3, 1]);
});
check("a one-Attribute Ward counts only for that Attribute; a blank one counts for nothing", () => {
  const m = aggregateModifiers([
    { name: "Wit Ward +2", type: "equipment", system: { category: "ward", location: "equipped", qualities: [{ key: "resistance", param: "wit", value: 2 }] } },
    { name: "Tailored Mail", type: "equipment", system: { category: "armor", location: "equipped", qualities: [{ key: "resistance", param: "might", value: 1 }] } },
    { name: "Unset Ward +1", type: "equipment", system: { category: "ward", location: "equipped", qualities: [{ key: "resistance", param: "", value: 1 }] } }
  ]);
  return eq([m.resistance.physical, m.resistance.mental, m.attributeResistance.wit, m.attributeResistance.might, m.attributeResistance.presence], [0, 0, 2, 1, 0]);
});
check("one Ward and one armor count at a time, the strongest", () => {
  const w = (name, cat, param, value) => ({ name, type: "equipment", system: { category: cat, location: "equipped", qualities: [{ key: "resistance", param, value }] } });
  const m = aggregateModifiers([w("Mental Ward +1", "ward", "mental", 1), w("Mental Ward +2", "ward", "mental", 2), w("Leather", "armor", "physical", 1), w("Mail", "armor", "physical", 2)]);
  return eq([m.resistance.mental, m.resistance.physical], [2, 2]);
});
check("Background Training counts as Training; a charm's +1 is a Skill bonus", () => {
  const m = aggregateModifiers(gear); return eq([m.training.prowess, m.training.acuity, m.skillBonus.acuity], [1, 0, 1]);
});
check("a charm adds to rolls but not toward the Training cap", () => {
  const c = char({ attributes: pools({ d4: 2 }, { d4: 2 }, { d4: 2 }, { d4: 2 }), skills: { acuity: { training: 2 } } }, [gear[3]]);
  const s = c.skills.acuity; return eq([s.trainingTotal, s.skillBonus, s.overCap, s.rollMax], [2, 1, false, 19]);
});

console.log("\nCarrying (PHB 5.2.6):");
check("past 4x Might Potential, -1 per extra multiple", () => {
  const armor = { system: { carriedWeight: 55 } };
  const c = char({ attributes: pools({ d6: 2 }, { d4: 1 }, { d4: 1 }, { d4: 1 }), rations: 3 }, [armor]);
  return eq([c.carry.limit, c.carry.weight, c.carry.penalty], [48, 61, 2]);
});

console.log("\nInstrument pricing (PHB 5.2.2):");
globalThis.CONFIG.FOIL.instrumentTypes = Object.fromEntries([
  ["quick", "other"], ["edged", "melee"], ["pointed", "melee"], ["blunt", "melee"], ["parry", "melee"], ["grappling", "melee"],
  ["thrown", "ranged"], ["drawn", "ranged"], ["fired", "ranged"], ["kinetic", "arcane"], ["incorporeal", "arcane"],
  ["fortifying", "arcane"], ["sonic", "sonic"], ["blocking", "other"], ["tool", "other"]
].map(([k, fam]) => [k, { key: k, label: k, family: fam, blocking: k === "blocking" }]));
for (const [name, cat, weight, types, range, price] of [
  ["Longsword", "melee", "medium", ["edged", "pointed", "parry"], "Close", 45],
  ["Quarterstaff", "melee", "medium", ["blunt", "blocking"], "Near", 45],
  ["Greatsword", "melee", "heavy", ["edged", "pointed"], "Close", 60],
  ["Halberd", "melee", "heavy", ["edged", "pointed"], "Near", 70],
  ["Longbow", "ranged", "medium", ["pointed", "drawn"], "Long Range", 75],
  ["Arbalest", "ranged", "heavy", ["pointed", "fired"], "Long Range", 105],
  ["Sling", "ranged", "light", ["thrown"], "Mid Range", 25],
  ["Grand Staff", "arcane", "heavy", ["kinetic", "incorporeal", "fortifying"], "Long Range", 70],
  ["Siege Horn", "sonic", "heavy", ["sonic"], "Long Range", 55]
]) check(`${name} prices at ${price}p`, () => {
  const i = new InstrumentData({ category: cat, weight, types, range, price }); i.prepareDerivedData();
  return eq(i.formulaPrice, price);
});
check("+2 Medium Instrument adds 45p, +2 to rolls, Pierce +1, crafts from 46p", () => {
  const i = new InstrumentData({ category: "melee", weight: "medium", types: ["edged", "pointed"], bonus: 2, size: "medium" }); i.prepareDerivedData();
  return eq([i.bonusPrice, i.bonusRoll, i.bonusPierce, i.craftCost], [45, 2, 1, 46]);
});
check("+0 Large item crafts from 3 Tier 0 batches (6p)", () => {
  const i = new InstrumentData({ category: "sonic", weight: "heavy", types: ["sonic"], size: "large" }); i.prepareDerivedData();
  return eq(i.craftCost, 6);
});
check("a Light Instrument works on the Quick Action; a Medium or Heavy one doesn't (PHB 4.1.1)", () => {
  const q = weight => { const i = new InstrumentData({ category: "melee", weight, types: ["edged"] }); i.prepareDerivedData(); return i.quick; };
  return eq([q("light"), q("medium"), q("heavy")], [true, false, false]);
});
check("a Blocking-only +N applies to Oppose only", () => {
  const i = new InstrumentData({ category: "arcane", weight: "light", types: ["blocking", "fortifying"], bonus: 1 }); i.prepareDerivedData();
  return eq([i.bonusRoll, i.bonusPierce, i.bonusOppose], [0, 0, 1]);
});

console.log("\nTechnique pricing (PHB 4.2.1):");
const REG = {
  stress: { pricingKind: "flat", pricingParams: { base: 4 } },
  pierce: { pricingKind: "perPoint", pricingParams: { perPoint: 4 } },
  weaken: { pricingKind: "perPoint", pricingParams: { perPoint: 18 } },
  "skill-mod": { pricingKind: "perPoint", pricingParams: { perPoint: 6 } },
  resistance: { pricingKind: "perPoint", pricingParams: { perPoint: 4 } },
  pattern: { pricingKind: "pattern", pricingParams: {} },
  selective: { pricingKind: "selective", pricingParams: {} },
  upkeep: { pricingKind: "upkeep", pricingParams: { base: 4 }, exemptFromPremium: true },
  quick: { pricingKind: "quick", pricingParams: {}, exemptFromPremium: true, setsFloor: true }
};
const x = (effects, opts) => priceTechnique(effects, REG, opts).xp;
check("Sunder (Stress, Pierce 1) is 12", () => eq(x([{ key: "stress" }, { key: "pierce", magnitude: 1 }]), 12));
check("Gutting Blow (Stress, Pierce 1, -1 Attribute) is 34", () => eq(x([{ key: "stress" }, { key: "pierce", magnitude: 1 }, { key: "weaken", magnitude: 1 }]), 34));
check("Harrow (Stress, -1 Attribute, Cone Near) is 39", () => eq(x([{ key: "stress" }, { key: "weaken", magnitude: 1 }, { key: "pattern", pattern: "cone", bands: 2 }]), 39));
check("Roaring Fireball (Stress, Radius Near) is 44", () => eq(x([{ key: "stress" }, { key: "pattern", pattern: "radius", bands: 2 }]), 44));
check("Hallowed Circle (Resistance +1, Selective 4 Near, Upkeep) is 22", () =>
  eq(x([{ key: "resistance", magnitude: 1 }, { key: "selective", selectiveR: 2 }, { key: "upkeep" }]), 22));
check("Warding Stance (+1, Fortifying floor) is 8", () => eq(x([{ key: "skill-mod", magnitude: 1 }], { floor: true }), 8));
check("pattern and selective costs", () => eq([patternCost("beam", 3), patternCost("cone", 2), patternCost("radius", 2), selectiveCost(3)], [6, 9, 36, 3]));
check("Strain is floor((XP - 24) / 8), never below 0", () => eq([7, 8, 31, 32, 39, 40, 56, 66].map(strainFor), [0, 0, 0, 1, 1, 2, 4, 5]));
check("Fortifying in Requires sets the 8 XP floor on its own", () => {
  globalThis.CONFIG.FOIL.effects = REG;
  const t = new TechniqueData({ requires: ["fortifying"], effects: [{ key: "resistance", magnitude: 1 }] }); t.prepareDerivedData();
  return eq([t.xpCost, t.strain], [8, 0]);
});

console.log("\nStress (PHB 6.7.0):");
const edged = { label: "Edged", physical: 3, mental: 0, pierce: 0, doubleResistance: true };
const pointed = { label: "Pointed", physical: 1, mental: 0, pierce: 1 };
const sonic = { label: "Sonic", physical: -1, mental: 1, pierce: 0 };
check("PHB 6.7.0 Hand Axe: margin 10, +3 Edged, Mail 2 counts double: 9; unarmored: 13", () =>
  eq([stressFor({ attack: 16, oppose: 6, cap: 12, resistance: 2, type: edged }).stress,
      stressFor({ attack: 16, oppose: 6, cap: 12, resistance: 0, type: edged }).stress], [9, 13]));
check("Edged after Pierce: Resistance 2, Pierce 1 leaves 1, doubled to 2", () =>
  eq(stressFor({ attack: 16, oppose: 6, cap: 12, resistance: 2, type: edged, pierce: 1 }).stress, 11));
check("Edged doubling applies only against physical Resistance", () =>
  eq(stressFor({ attack: 16, oppose: 6, cap: 12, kind: "mental", resistance: 2, type: edged }).stress, 8));
check("Wren round 1: margin 4, Sonic +1, Resistance 1: 4", () =>
  eq(stressFor({ attack: 16, oppose: 12, cap: 6, kind: "mental", resistance: 1, type: sonic }).stress, 4));
check("every opposed Condition names two Skills (PHB 6.8.x); Weakened and Wary don't", () =>
  eq(CONDITIONS.filter(c => !CONDITION_OPPOSE[c]), ["Weakened", "Wary"]) && Object.values(CONDITION_OPPOSE).every(v => v.length === 2));
check("margin caps at half the Primary Potential", () => eq(stressFor({ attack: 30, oppose: 10, cap: 6 }).stress, 6));
check("margin cap by weight: half Light, all Medium, all Heavy (PHB 6.7.0)", () =>
  eq(["light", "medium", "heavy"].map(k => marginCap(24, k)), [12, 24, 24]));
check("a tie lands at margin 0; a lost roll doesn't land", () =>
  eq([stressFor({ attack: 10, oppose: 10, cap: 6 }).landed, stressFor({ attack: 9, oppose: 10, cap: 6 }).landed], [true, false]));
check("Pointed's Pierce 1 plus a Technique's Pierce 1 against Mail 2: margin 5 lands 6", () =>
  eq(stressFor({ attack: 15, oppose: 10, cap: 10, resistance: 2, type: pointed, pierce: 1 }).stress, 6));
check("weight classes: no dice; margin x1 / x1 / x2; Heavy two hands and the whole turn", () => {
  const d = ["light", "medium", "heavy"].map(w => { const i = new InstrumentData({ category: "melee", weight: w, types: ["edged"] }); i.prepareDerivedData(); return [i.weightDice, i.twoHanded, i.doublesMargin, i.marginMultiplier]; });
  return eq(d, [["", false, false, 1], ["", false, false, 1], ["", true, true, 2]]);
});
check("only the margin is capped: margin 10 at a cap of 8, +3 Edged against no Resistance, lands 11", () =>
  eq(stressFor({ attack: 20, oppose: 10, cap: 8, type: { label: "Edged", physical: 3, mental: 0, pierce: 0, doubleResistance: true } }).stress, 11));
check("a Heavy margin doubles before the cap: margin 5 through a cap of 24 is 10", () =>
  eq([stressFor({ attack: 15, oppose: 10, cap: 24, double: true }).stress, stressFor({ attack: 30, oppose: 10, cap: 24, double: true }).stress], [10, 24]));
check("weight dice apply to targeted Techniques only", () => {
  const a = new TechniqueData({ effects: [{ key: "stress" }] }); a.prepareDerivedData();
  const b = new TechniqueData({ requires: ["fortifying"], effects: [{ key: "resistance", magnitude: 1 }] }); b.prepareDerivedData();
  return eq([a.offensive, b.offensive], [true, false]);
});
check("Pierce never makes Resistance negative", () => eq(stressFor({ attack: 15, oppose: 10, cap: 10, resistance: 1, pierce: 4 }).stress, 5));
check("Vulnerable 2 adds 2", () => eq(stressFor({ attack: 15, oppose: 10, cap: 10, resistance: -2 }).stress, 7));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall model checks passed");
process.exit(fails ? 1 : 0);
