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
const models = { instrument: M.InstrumentData, technique: M.TechniqueData, equipment: M.EquipmentData, background: M.BackgroundData, origin: M.OriginData };
const pure = { instrument: R.deriveInstrument, technique: R.deriveTechnique, equipment: R.deriveEquipment, background: R.deriveBackground, origin: R.deriveOrigin };
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
process.exit(bad || !regOk ? 1 : 0);
