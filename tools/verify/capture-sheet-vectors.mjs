/**
 * Writes tools/verify/vectors/sheet.json: sheet inputs (the hydrated actor data and its items) and the
 * derived values the Foundry model computes from them. verify-sheet-vectors.mjs replays them against the
 * model and against rules/sheet.js, so the two cannot drift. Run it only when the derivation is changed
 * on purpose:  node tools/verify/capture-sheet-vectors.mjs
 */
import "./stub-foundry.mjs";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";

const { CharacterData, CreatureData } = await import(`${SYSTEM_ROOT}/src/data/actor-models.js`);
const dir = path.join(SYSTEM_ROOT, "src", "packs", "bestiary");
const actors = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

const plain = o => JSON.parse(JSON.stringify(o));
const cases = [];
function add(label, Model, kind, system, items = []) {
  const pre = new Model(system, { parent: { items: { contents: items } } });
  const input = plain({ ...pre });                       // hydrated, before derivation
  const post = new Model(system, { parent: { items: { contents: items } } });
  post.prepareDerivedData();
  cases.push({ label, kind, input, items: plain(items), output: plain({ ...post }) });
}

actors.forEach((a, i) => {
  if (i % 4 !== 0) return;
  add(`${a.name} as creature`, CreatureData, "creature", a.system, a.items ?? []);
});
// Variants that reach the branches a healthy creature does not.
const base = actors.find(a => a.name === "Bandit Captain") ?? actors[0];
const mut = (fn) => { const s = plain(base.system); fn(s); return s; };
add("character from a creature's data", CharacterData, "character", base.system, (base.items ?? []));
add("one Attribute at zero Potential", CharacterData, "character", mut(s => { s.attributes.might.potential.current = 0; }), (base.items ?? []));
add("one Attribute flagged Incapacitated", CharacterData, "character", mut(s => { s.attributes.wit.incapacitated = true; }), (base.items ?? []));
add("every Attribute Incapacitated (Destroyed)", CharacterData, "character", mut(s => { for (const k of Object.keys(s.attributes)) s.attributes[k].incapacitated = true; }), (base.items ?? []));
add("rations and a heavy load", CharacterData, "character", mut(s => { s.rations = 40; }), (base.items ?? []).map(i => ({ ...plain(i), system: { ...plain(i).system, carriedWeight: 60 } })));
add("negative base Resistance", CharacterData, "character", mut(s => { s.resistance.physical = -2; s.resistance.mental = 3; }), (base.items ?? []));
add("Training past the dice cap", CharacterData, "character", mut(s => { s.skills.prowess = { training: 9 }; s.skills.acuity = { training: 5 }; }), (base.items ?? []));
add("no dice at all", CharacterData, "character", mut(s => { for (const k of Object.keys(s.attributes)) for (const d of Object.keys(s.attributes[k].dice)) s.attributes[k].dice[d] = 0; }), []);
add("no items", CharacterData, "character", base.system, []);
add("xp totals", CharacterData, "character", mut(s => { s.xp = { total: 120, spent: 87 }; }), []);

fs.writeFileSync(path.join(SYSTEM_ROOT, "tools", "verify", "vectors", "sheet.json"), JSON.stringify(cases));
console.log(`wrote ${cases.length} sheet vectors`);
