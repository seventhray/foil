/**
 * Replays tools/verify/vectors/items.json (captured from the Foundry item models before the derivation moved
 * to rules/items.js) against both the models and the pure rules/items.js, and requires identical results.
 */
import "./stub-foundry.mjs";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";

const M = await import(`${SYSTEM_ROOT}/src/data/item-models.js`);
const R = await import(`${SYSTEM_ROOT}/rules/items.js`);
const { registry, cases } = JSON.parse(fs.readFileSync(path.join(SYSTEM_ROOT, "tools", "verify", "vectors", "items.json"), "utf8"));
const models = { instrument: M.InstrumentData, technique: M.TechniqueData, equipment: M.EquipmentData, consumable: M.ConsumableData, material: M.MaterialData, background: M.BackgroundData, origin: M.OriginData };
const pure = { instrument: R.deriveInstrument, technique: R.deriveTechnique, equipment: R.deriveEquipment, consumable: R.deriveConsumable, material: R.deriveMaterial, background: R.deriveBackground, origin: R.deriveOrigin };
const plain = o => JSON.parse(JSON.stringify(o));
const diff = (a, b, p = "") => {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b ? null : `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], `${p}/${k}`); if (d) return d; }
  return null;
};
globalThis.CONFIG = { FOIL: registry };
let bad = 0;
for (const c of cases) {
  const m = new models[c.kind](c.input);
  m.prepareDerivedData();
  const viaModel = diff(plain({ ...m }), c.output);
  const sys = plain(c.input);
  pure[c.kind](sys, registry);
  const viaPure = diff(sys, c.output);
  if (viaModel || viaPure) { bad++; if (bad <= 8) console.log(`  FAIL  ${c.kind} ${c.label}${viaModel ? "  model: " + viaModel : ""}${viaPure ? "  pure: " + viaPure : ""}`); }
}
console.log(`  ${cases.length - bad} of ${cases.length} item vectors match, through the Foundry models and through rules/items.js`);

// The registry builder: explicit key, slugified name fallback, later documents win, no key skipped.
const { registryFromDocs, slugify } = await import(`${SYSTEM_ROOT}/rules/definitions.js`);
const got = registryFromDocs([
  { name: "Edged", system: { key: "edged", family: "melee" } },
  { name: "Foil Exposed!", system: {} },
  { name: "Edged", system: { key: "edged", family: "world override" } },
  { name: "", system: {} }
]);
const want = { edged: { key: "edged", label: "Edged", family: "world override" }, "foil-exposed": { key: "foil-exposed", label: "Foil Exposed!" } };
const regOk = JSON.stringify(got) === JSON.stringify(want) && slugify("  A  b--C ") === "a-b-c";
console.log(`  ${regOk ? "the registry builder reads keys, slugs, overrides and blanks as before" : "FAIL  the registry builder differs: " + JSON.stringify(got)}`);
// A batch's price by Tier and Scarcity, every cell of the PHB 5.3.1 table.
const { readPHB, tableAfter } = await import("../books.mjs");
const SCARCE = ["Common", "Uncommon", "Rare", "Exotic"];
// The Tier table follows the Scarcity table in 5.3.1, so it is read from that table's last row.
const priceRows = tableAfter(readPHB(), /^\| Exotic\s+\| x3/).filter(r => /^\d/.test(r.Tier ?? ""));
const priceBad = priceRows.flatMap(r => SCARCE.filter(k => R.materialBatchPrice(Number(r.Tier[0]), k.toLowerCase()) !== Number(String(r[k]).replace("p", "")))
  .map(k => `Tier ${r.Tier[0]} ${k}`));
const priceOk = priceRows.length === 6 && !priceBad.length;
console.log(`  ${priceOk ? "a material batch's price matches all 24 cells of PHB 5.3.1" : "FAIL  material prices differ: " + (priceBad.join(", ") || `${priceRows.length} rows read`)}`);
process.exit(bad || !regOk || !priceOk ? 1 : 0);
