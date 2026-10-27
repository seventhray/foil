/**
 * Writes tools/verify/vectors/items.json: item inputs (hydrated item data) with the derived values the
 * Foundry item models computed from them, plus the registry snapshot they were computed against.
 * verify-item-vectors.mjs replays them through the models and through rules/items.js.
 * Rerun only when a derivation rule is changed on purpose:  node tools/verify/capture-item-vectors.mjs
 */
import "./stub-foundry.mjs";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";

const M = await import(`${SYSTEM_ROOT}/src/data/item-models.js`);
const packDir = n => path.join(SYSTEM_ROOT, "src", "packs", n);
const docs = n => fs.readdirSync(packDir(n)).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(packDir(n), f), "utf8"))).filter(d => d.system);
const plain = o => JSON.parse(JSON.stringify(o));

// The registry exactly as src/registry.js builds it from the definition packs.
const slugify = name => String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const registryOf = list => { const m = {}; for (const d of list) { const key = (d.system?.key && String(d.system.key).trim()) || slugify(d.name); if (key) m[key] = { key, label: d.name, ...d.system }; } return m; };
const registry = { instrumentTypes: registryOf(docs("instrument-types")), effects: registryOf(docs("effects")) };
globalThis.CONFIG = { FOIL: registry };

const cases = [];
function add(label, Model, kind, system) {
  const input = plain({ ...new Model(system) });
  const m = new Model(system);
  m.prepareDerivedData();
  cases.push({ label, kind, input, output: plain({ ...m }) });
}
const instruments = docs("instruments"), techniques = docs("techniques");
for (const d of instruments) add(d.name, M.InstrumentData, "instrument", d.system);
for (const d of techniques) add(d.name, M.TechniqueData, "technique", d.system);
for (const d of docs("equipment")) add(d.name, M.EquipmentData, "equipment", d.system);
for (const d of docs("consumables")) add(d.name, M.ConsumableData, "consumable", d.system);
for (const d of docs("materials")) add(d.name, M.MaterialData, "material", d.system);
for (const d of docs("backgrounds")) add(d.name, M.BackgroundData, "background", d.system);
for (const d of docs("ancestries")) add(d.name, M.OriginData, "origin", d.system);

// Variants that reach branches the shipped content does not.
{ const steel = docs("materials").find(d => d.name === "Steel");
  add("material, 2.75 batches, Rare, stored", M.MaterialData, "material", { ...steel.system, batches: 2.75, scarcity: "rare", location: "stored", storedAt: "Old mill" });
  add("material, Mass set on the item", M.MaterialData, "material", { ...steel.system, batches: 3, weight: 10, scarcity: "uncommon" }); }
const longsword = instruments.find(d => d.system.weight === "medium" && !d.system.innate) ?? instruments[0];
const voice = instruments.find(d => d.system.innate) ?? instruments[0];
const arcane = instruments.find(d => (d.system.types ?? []).some(t => ["kinetic", "incorporeal", "fortifying"].includes(t))) ?? instruments[0];
const mut = (d, fn) => { const s = plain(d.system); fn(s); return s; };
const effectsOf = techniques.find(d => (d.system.effects ?? []).length > 1)?.system.effects ?? [];
add("bonus +2, large", M.InstrumentData, "instrument", mut(longsword, s => { s.bonus = 2; s.size = "large"; }));
add("bonus +3, small, carried", M.InstrumentData, "instrument", mut(longsword, s => { s.bonus = 3; s.size = "small"; s.location = "carried"; }));
add("heavy", M.InstrumentData, "instrument", mut(longsword, s => { s.weight = "heavy"; }));
add("price mismatch", M.InstrumentData, "instrument", mut(longsword, s => { s.price = 1; }));
add("innate in a bag", M.InstrumentData, "instrument", mut(voice, s => { s.location = "carried"; }));
add("no types", M.InstrumentData, "instrument", mut(longsword, s => { s.types = []; }));
add("unknown type", M.InstrumentData, "instrument", mut(longsword, s => { s.types = ["not-a-type"]; }));
for (const kind of ["skill", "roll", "pierce", "stress"]) for (const n of [1, 3])
  add(`enchanted bonus ${kind} +${n}`, M.InstrumentData, "instrument",
    mut(longsword, s => { s.enchantment = { ...(s.enchantment ?? {}), bonus: { kind, n, skill: "prowess" } }; }));
add("arcane Instrument", M.InstrumentData, "instrument", mut(arcane, s => { s.bonus = 2; }));
add("iron Instrument at +0, material Tier 1", M.InstrumentData, "instrument", mut(longsword, s => { s.tier = 1; }));
{ const ward = docs("equipment").find(d => d.system.category === "ward") ?? docs("equipment")[0];
  for (const [kind, param] of [["resistance", "mental"], ["skill", "discipline"]]) add(`equipment enchanted ${kind}`, M.EquipmentData, "equipment", mut(ward, s => { s.enchantment = { bonus: { kind, param, n: 3 } }; }));
  const fly = techniques.find(d => d.name === "Fly");
  if (fly) add("equipment holding a Technique", M.EquipmentData, "equipment", mut(ward, s => { s.enchantment = { enabled: true, effects: fly.system.effects, effectText: "Fly", bonus: { kind: "", param: "", n: 1 } }; })); }
add("bound Enchantment", M.InstrumentData, "instrument", mut(longsword, s => { s.enchantment = { ...(s.enchantment ?? {}), enabled: true, effects: effectsOf }; }));
add("bound Enchantment, empty", M.InstrumentData, "instrument", mut(longsword, s => { s.enchantment = { ...(s.enchantment ?? {}), enabled: true, effects: [] }; }));
const tech = techniques.find(d => (d.system.effects ?? []).length > 1) ?? techniques[0];
add("Technique requiring an unknown type", M.TechniqueData, "technique", mut(tech, s => { s.requires = ["nonsense"]; }));
add("Technique requiring Melee types", M.TechniqueData, "technique", mut(tech, s => { s.requires = ["edged", "pointed", "blunt", "grappling", "parry"]; }));
add("Technique requiring Ranged types", M.TechniqueData, "technique", mut(tech, s => { s.requires = ["thrown", "drawn", "fired"]; }));
add("Technique with a price floor", M.TechniqueData, "technique", mut(tech, s => { s.floor = true; }));
add("Technique requiring Fortifying", M.TechniqueData, "technique", mut(tech, s => { s.requires = ["fortifying"]; }));
add("Technique with no effects", M.TechniqueData, "technique", mut(tech, s => { s.effects = []; }));

fs.writeFileSync(path.join(SYSTEM_ROOT, "tools", "verify", "vectors", "items.json"), JSON.stringify({ registry, cases }));
const kinds = {}; for (const c of cases) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
console.log(`wrote ${cases.length} item vectors`, JSON.stringify(kinds));
