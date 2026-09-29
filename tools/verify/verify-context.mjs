// Every bare (non-system.) root key a template reads must be provided by the
// _prepareContext that renders it. This is the class of bug that renders blank
// instead of erroring, so nothing else catches it.
import fs from "node:fs"; import path from "node:path";
import { SYSTEM_ROOT as ROOT } from "../books.mjs";
const src = f => fs.readFileSync(path.join(ROOT,f),"utf8");

const ctxKeys = (file, marker, count) => {
  const s = src(file); const out = new Set(); let idx = 0;
  for (let i=0;i<count;i++) {
    idx = s.indexOf(marker, idx); if (idx<0) break;
    const seg = s.slice(idx, s.indexOf("\n  }", idx));
    for (const m of seg.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/gm)) out.add(m[1]);
    idx += marker.length;
  }
  return out;
};
const actorCtx = new Set([...ctxKeys("src/actor/actor-sheet.js", "async _prepareContext(options) {", 2),
                          ...ctxKeys("src/actor/actor-sheet.js", "_commonContext() {", 1)]);
// Keys spread inline: "return { ...this._commonContext(), health: ... }".
for (const m of src("src/actor/actor-sheet.js").matchAll(/_commonContext\(\),\s*([A-Za-z]+):/g)) actorCtx.add(m[1]);
const itemCtx  = ctxKeys("src/item/item-sheet.js",  "async _prepareContext(", 3);
const appCtx   = new Set([...ctxKeys("src/apps/advancement.js", "async _prepareContext(", 2),
                          ...ctxKeys("src/apps/chargen.js",     "async _prepareContext(", 2)]);
// keys the item sheet adds conditionally, plus block-scoped locals
const EXTRA = new Set(["qualityRows","effectRows","enchantEffectRows","kitRows","modifierRows","talentRows",
  "featRows","knowHowRows","trainingRows",
  "this","else","idx","key","label","value","checked","cfg","editor","tab","fields","source","document","item","buttons"]);
const BLOCK = new Set(["if","unless","each","with","log","lookup","foil-eq","foil-signed","foil-capitalize"]);

const files=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
  if(e.isDirectory())walk(p); else if(e.name.endsWith(".hbs"))files.push(p);}})(path.join(ROOT,"templates"));

let bad = 0;
for (const file of files) {
  const rel = path.relative(ROOT,file); const s = fs.readFileSync(file,"utf8");
  // only whole-sheet templates have their own context; partials inherit
  if (rel.includes("partials/")) continue;
  const provided = rel.includes("/apps/") ? appCtx : (rel.includes("/actor/") ? actorCtx : itemCtx);
  const roots = new Set();
  for (const m of s.matchAll(/\{\{\{?[#\/]?\s*([A-Za-z][A-Za-z0-9_-]*)/g)) roots.add(m[1]);
  for (const r of roots) {
    if (BLOCK.has(r) || EXTRA.has(r) || provided.has(r) || r === "system" || r === "actor") continue;
    console.log(`  NOT IN CONTEXT  ${r}   <- ${rel}`); bad++;
  }
}
console.log(bad ? `\n${bad} template key(s) with no context entry` : "every bare template key is provided by its sheet's context");
