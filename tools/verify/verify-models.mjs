import "./stub-foundry.mjs";
const R = "/home/connor/foundrydata/Data/systems/foil/src";
const { CharacterData, CreatureData } = await import(`${R}/data/actor-models.js`);
const { InstrumentTypeData } = await import(`${R}/data/definition-models.js`);
const { InstrumentData } = await import(`${R}/data/item-models.js`);

let fails = 0;
const check = (label, fn) => { try { const r = fn(); console.log(`  PASS  ${label}${r ? " — " + r : ""}`); } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fails++; } };

console.log("migrateData on a pre-v0.2.0 actor (Resistance stored per Attribute):");
check("character migrates Might+2/Finesse+0/Wit+1 -> physical 2, mental 1", () => {
  const legacy = { attributes: { might:{resistance:2}, finesse:{resistance:0}, wit:{resistance:1}, presence:{resistance:0} } };
  const out = CharacterData.migrateData(structuredClone(legacy));
  if (out.resistance?.physical !== 2 || out.resistance?.mental !== 1) throw new Error(JSON.stringify(out.resistance));
  if ("resistance" in (out.attributes.might ?? {})) throw new Error("legacy per-Attribute field not cleared");
  return `physical ${out.resistance.physical}, mental ${out.resistance.mental}`;
});
check("creature with Might+4/Finesse+4 collapses to physical 4 (not 8)", () => {
  const out = CreatureData.migrateData({ attributes:{ might:{resistance:4}, finesse:{resistance:4}, wit:{}, presence:{} } });
  if (out.resistance?.physical !== 4) throw new Error(JSON.stringify(out.resistance));
  return "physical 4";
});
check("already-migrated actor is left alone (idempotent)", () => {
  const cur = { attributes:{might:{},finesse:{},wit:{},presence:{}}, resistance:{physical:3,mental:0} };
  const out = CharacterData.migrateData(structuredClone(cur));
  if (out.resistance.physical !== 3) throw new Error("clobbered an existing value");
  return "unchanged";
});
check("actor with no attributes at all does not throw", () => { CharacterData.migrateData({}); return "no-op"; });

console.log("\nmigrateData on a pre-v0.2.0 Instrument Type:");
for (const [name, src, wantHarms, wantStress] of [
  ["Edged (targets FS)",   { targets:"FS", opposes:"PW" }, "physical", 0],
  ["Fired (MI + 1d4 die)", { targets:"MI", bonusDie:"1d4" }, "physical", 2],
  ["Guile (targets WI)",   { targets:"WI" }, "mental", 0],
  ["Command (targets PS)", { targets:"PS" }, "mental", 0],
  ["Fortifying (support)", { targets:"ally / self" }, "", 0],
]) check(`${name} -> harms "${wantHarms}", bonusStress ${wantStress}`, () => {
  const o = InstrumentTypeData.migrateData(structuredClone(src));
  if (o.harms !== wantHarms || o.bonusStress !== wantStress) throw new Error(JSON.stringify({harms:o.harms, bonusStress:o.bonusStress}));
});

console.log("\nprepareDerivedData on a live character:");
check("Resistance totals and Attribute kinds derive", () => {
  const c = new CharacterData({
    attributes: { might:{dice:{d12:1},potential:{current:0}}, finesse:{dice:{d10:1},potential:{current:5}},
                  wit:{dice:{d8:1},potential:{current:8}}, presence:{dice:{d6:1},potential:{current:6}} },
    resistance: { physical: 2, mental: 1 }
  }, { parent: { items: { contents: [] } } });
  c.prepareDerivedData();
  // An Incapacitated Attribute (PHB §6.8.1) needs no named summary state on
  // top of itself, so guard against one creeping back in as a derived field.
  if ("isBroken" in c) throw new Error("no derived summary flag for Incapacitated Attributes");
  if (!c.attributes.might.incapacitated) throw new Error("Might at 0 current should be Incapacitated");
  if (c.resistance.physicalTotal !== 2) throw new Error("physicalTotal " + c.resistance.physicalTotal);
  if (c.attributes.might.kind !== "physical") throw new Error("kind not set");
  return `physical ${c.resistance.physicalTotal}, mental ${c.resistance.mentalTotal}`;
});
check("an untouched character has no Incapacitated Attribute", () => {
  const c = new CharacterData({ attributes:{ might:{dice:{d12:1},potential:{current:12}}, finesse:{dice:{d10:1},potential:{current:10}},
    wit:{dice:{d8:1},potential:{current:8}}, presence:{dice:{d6:1},potential:{current:6}} } }, { parent:{items:{contents:[]}} });
  c.prepareDerivedData();
  if (Object.values(c.attributes).some(a => a.incapacitated)) throw new Error("nothing should be Incapacitated");
  return "all four standing";
});
console.log("\nResistance sources (what granted it, not just how much):");
const { aggregateModifiers } = await import(`${R}/modifiers.js`);
const gear = [
  { name:"Leather",      type:"equipment", system:{ category:"armor",  equipped:true,  qualities:[{key:"resistance",param:"physical",value:1}] } },
  { name:"Tower Shield", type:"equipment", system:{ category:"shield", equipped:true,  qualities:[{key:"resistance",param:"physical",value:2}] } },
  { name:"Half Plate",   type:"equipment", system:{ category:"armor",  equipped:false, qualities:[{key:"resistance",param:"physical",value:3}] } },
  { name:"Warding Charm",type:"equipment", system:{ category:"ward",   equipped:true,  qualities:[{key:"resistance",param:"mental",  value:1}] } },
  { name:"Legacy Mail",  type:"equipment", system:{ category:"armor",  equipped:true,  qualities:[{key:"resistance",param:"might",   value:2}] } },
  { name:"Tempered",     type:"feat",      system:{ modifiers:[{type:"resistance",key:"physical",value:1}] } },
];
const mods = aggregateModifiers(gear);
check("sources are named and summed per kind", () => {
  if (mods.resistance.physical !== 6) throw new Error("physical " + mods.resistance.physical);
  if (mods.resistance.mental !== 1) throw new Error("mental " + mods.resistance.mental);
  return `physical 6 from ${mods.resistanceSources.physical.length} sources, mental 1 from 1`;
});
check("unequipped gear contributes nothing", () => {
  if (mods.resistanceSources.physical.some(e => e.name === "Half Plate")) throw new Error("Half Plate counted while stowed");
  return "Half Plate excluded";
});
check("a legacy Attribute param still maps onto a kind", () => {
  const legacy = mods.resistanceSources.physical.find(e => e.name === "Legacy Mail");
  if (!legacy || legacy.value !== 2) throw new Error("Legacy Mail (param 'might') did not map to physical");
  return "might -> physical";
});
check("biggest contributor sorts first", () => {
  const vals = mods.resistanceSources.physical.map(e => e.value);
  if (vals.join() !== [...vals].sort((a,b)=>b-a).join()) throw new Error(vals.join());
  return vals.join(" / ");
});

console.log("\nAptitude roll range (min / avg / max, Training included):");
const mk = incap => new CharacterData({
  attributes: { might:{dice:{d12:1},potential:{current: incap?0:12}}, finesse:{dice:{d10:1},potential:{current:10}},
                wit:{dice:{d8:1},potential:{current:8}}, presence:{dice:{d6:1},potential:{current:6}} },
  aptitudes: { prowess:{training:1} } }, { parent:{items:{contents:[]}} });
const rng = (c,k) => { const a=c.aptitudes[k]; return `${a.rollMin} / ${a.rollAvg} / ${a.rollMax}`; };
check("Prowess on 1d12 + 1d10 with Training +1 reads 3 / 13 / 23", () => {
  const c = mk(false); c.prepareDerivedData();
  // PHB §2.2.3 prints 1d10+1d12 at average 12.0; +1 Training is 13.
  if (rng(c,"prowess") !== "3 / 13 / 23") throw new Error(rng(c,"prowess"));
  return rng(c,"prowess");
});
check("max is the sum of faces, not just Training", () => {
  const c = mk(false); c.prepareDerivedData();
  if (c.aptitudes.fortitude.rollMax !== 20) throw new Error("Fortitude max " + c.aptitudes.fortitude.rollMax);
  return "Fortitude 2 / 11 / 20";
});
check("an Incapacitated Attribute drops out of every Aptitude it feeds", () => {
  const c = mk(true); c.prepareDerivedData();
  if (rng(c,"prowess") !== "2 / 6.5 / 11") throw new Error("Prowess " + rng(c,"prowess"));
  if (rng(c,"acuity") !== "2 / 10 / 18") throw new Error("Acuity should be untouched: " + rng(c,"acuity"));
  return "Prowess narrows, Acuity untouched";
});

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall model checks passed");
process.exit(fails ? 1 : 0);
