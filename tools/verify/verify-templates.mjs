import { pathToFileURL } from "node:url";
import { SYSTEM_ROOT, setting } from "../books.mjs";
const FOUNDRY_APP = setting("FOUNDRY_APP");
const { default: Handlebars } = await import(pathToFileURL(`${FOUNDRY_APP}/node_modules/handlebars/lib/index.js`).href);
import fs from "node:fs";
import path from "node:path";

const ROOT = SYSTEM_ROOT;
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (e.name.endsWith(".hbs")) files.push(p);
} })(path.join(ROOT, "templates"));

const REGISTERED = new Set(["foil-eq","foil-signed","foil-capitalize"]);
const BUILTIN = new Set(["if","unless","each","with","log","lookup","else","this","blockHelperMissing","helperMissing"]);

let syntaxFail = 0; const unknownHelpers = new Map(); const partials = new Set();
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  let ast;
  try { ast = Handlebars.parse(src); }
  catch (e) { console.log(`SYNTAX FAIL  ${path.relative(ROOT,file)}\n   ${e.message.split("\n")[0]}`); syntaxFail++; continue; }

  (function visit(node){
    if (!node || typeof node !== "object") return;
    if (node.type === "PartialStatement") partials.add(node.name?.original ?? node.name?.parts?.join("."));
    if ((node.type === "MustacheStatement" || node.type === "SubExpression" || node.type === "BlockStatement")) {
      const head = node.path?.parts?.[0];
      const isHelperCall = (node.params && node.params.length > 0) || node.type === "BlockStatement";
      if (head && isHelperCall && !BUILTIN.has(head) && !REGISTERED.has(head) && node.path?.original?.includes("-")) {
        unknownHelpers.set(node.path.original, (unknownHelpers.get(node.path.original) ?? []).concat(path.relative(ROOT,file)));
      }
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === "object") visit(v);
    }
  })(ast);
}
console.log(`templates parsed: ${files.length}, syntax failures: ${syntaxFail}`);
if (unknownHelpers.size) { console.log("UNREGISTERED HELPERS:"); for (const [h,fs_] of unknownHelpers) console.log(`  ${h}  in ${[...new Set(fs_)].join(", ")}`); }
else console.log("helpers: every dashed helper invoked is registered");

const missing = [...partials].filter(p => p && !fs.existsSync(p.replace("systems/foil", ROOT)));
console.log(missing.length ? `MISSING PARTIALS: ${missing.join(", ")}` : `partials: all ${partials.size} resolve`);
