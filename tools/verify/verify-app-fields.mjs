/**
 * tools/verify/verify-app-fields.mjs
 * An Application that assigns to one of ApplicationV2's read-only properties
 * (state, element, id, ...) throws in its constructor, so its window never
 * opens. Reads the getter-only names from Foundry's own source and fails on any
 * `this.<name> =` in src/.
 */
import fs from "node:fs";
import path from "node:path";
import { setting, SYSTEM_ROOT } from "../books.mjs";

const FOUNDRY_APP = setting("FOUNDRY_APP");
const API = path.join(FOUNDRY_APP, "client/applications/api");
const readOnly = new Set();
for (const f of ["application.mjs", "handlebars-application.mjs", "document-sheet.mjs"]) {
  const src = fs.readFileSync(path.join(API, f), "utf8");
  const getters = [...src.matchAll(/^\s+get (\w+)\(\)/gm)].map(m => m[1]);
  const setters = new Set([...src.matchAll(/^\s+set (\w+)\(/gm)].map(m => m[1]));
  for (const g of getters) if (!setters.has(g)) readOnly.add(g);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) files.push(p);
  }
})(path.join(SYSTEM_ROOT, "src"));

let bad = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\bthis\.(\w+)\s*=(?!=)/g)) {
      if (!readOnly.has(m[1])) continue;
      console.log(`  FAIL  ${path.relative(SYSTEM_ROOT, f)}:${i + 1} assigns read-only ApplicationV2 property "${m[1]}"`);
      bad++;
    }
  });
}
if (!readOnly.size) { console.log("  FAIL  no getters read from Foundry's source"); process.exit(1); }
console.log(bad ? `${bad} assignment(s) to read-only properties` : `no assignments to ${readOnly.size} read-only ApplicationV2 properties`);
process.exit(bad ? 1 : 0);
