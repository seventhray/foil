/**
 * Replays tools/verify/vectors/sheet.json (captured from the Foundry model before the derivation moved to
 * rules/sheet.js) against both the Foundry model and the pure rules/sheet.js, and requires identical results.
 */
import "./stub-foundry.mjs";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";

const { CharacterData, CreatureData } = await import(`${SYSTEM_ROOT}/src/data/actor-models.js`);
const { deriveCharacter, deriveCreature } = await import(`${SYSTEM_ROOT}/rules/sheet.js`);
const vectors = JSON.parse(fs.readFileSync(path.join(SYSTEM_ROOT, "tools", "verify", "vectors", "sheet.json"), "utf8"));
const plain = o => JSON.parse(JSON.stringify(o));
let bad = 0;
const diff = (a, b, p = "") => {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b ? null : `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = diff(a[k], b[k], `${p}/${k}`); if (d) return d; }
  return null;
};
for (const v of vectors) {
  const Model = v.kind === "creature" ? CreatureData : CharacterData;
  const m = new Model(v.input, { parent: { items: { contents: v.items } } });
  m.prepareDerivedData();
  const viaModel = diff(plain({ ...m }), v.output);
  const pure = plain(v.input);
  (v.kind === "creature" ? deriveCreature : deriveCharacter)(pure, plain(v.items));
  const viaPure = diff(pure, v.output);
  if (viaModel || viaPure) { bad++; console.log(`  FAIL  ${v.label}${viaModel ? "  model: " + viaModel : ""}${viaPure ? "  pure: " + viaPure : ""}`); }
}
console.log(`  ${vectors.length - bad} of ${vectors.length} sheet vectors match, through the Foundry model and through rules/sheet.js`);
process.exit(bad ? 1 : 0);
