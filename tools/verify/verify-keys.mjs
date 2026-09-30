import "./stub-foundry.mjs";
import { pathToFileURL } from "node:url";
import { SYSTEM_ROOT, setting } from "../books.mjs";
const FOUNDRY_APP = setting("FOUNDRY_APP");
const { default: Handlebars } = await import(pathToFileURL(`${FOUNDRY_APP}/node_modules/handlebars/lib/index.js`).href);
import fs from "node:fs"; import path from "node:path";
const ROOT=SYSTEM_ROOT; const R=ROOT+"/src";
const A = await import(`${R}/data/actor-models.js`);
const I = await import(`${R}/data/item-models.js`);
const D = await import(`${R}/data/definition-models.js`);

// Build one live instance of each model and record every key it actually exposes.
const parent = { items: { contents: [] } };
const inst = (C, src={}) => { const m = new C(src, { parent }); try { m.prepareDerivedData?.(); } catch {} return m; };
const MODELS = {
  character: inst(A.CharacterData, { attributes:{might:{dice:{d12:1}},finesse:{dice:{d10:1}},wit:{dice:{d8:1}},presence:{dice:{d6:1}}} }),
  creature:  inst(A.CreatureData,  { attributes:{might:{dice:{d8:1}},finesse:{dice:{d8:1}},wit:{dice:{d8:1}},presence:{dice:{d8:1}}} }),
  instrument: inst(I.InstrumentData, { weight:"medium", types:["edged"] }),
  technique: inst(I.TechniqueData), feat: inst(I.FeatData), equipment: inst(I.EquipmentData),
  instrumentType: inst(D.InstrumentTypeData), quality: inst(D.QualityData), effect: inst(D.EffectData),
  background: inst(I.BackgroundData), origin: inst(I.OriginData),
};
const keysOf = (o, pre="", out=new Set()) => {
  if (!o || typeof o !== "object") return out;
  for (const k of Object.keys(o)) { const p = pre?`${pre}.${k}`:k; out.add(p);
    if (o[k] && typeof o[k]==="object" && !Array.isArray(o[k])) keysOf(o[k], p, out); }
  return out;
};
const ALL = new Set(); for (const m of Object.values(MODELS)) for (const k of keysOf(m)) ALL.add(k);

// Every system.* path the templates reference.
const files=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
  if(e.isDirectory())walk(p); else if(e.name.endsWith(".hbs"))files.push(p);}})(ROOT+"/templates");
const refs = new Map();
for (const file of files) {
  const src = fs.readFileSync(file,"utf8");
  for (const m of src.matchAll(/\{\{[#\/]?[^}]*?\bsystem\.([A-Za-z0-9_.]+)/g)) {
    const p = m[1].replace(/\.$/,"");
    refs.set(p, (refs.get(p) ?? new Set()).add(path.relative(ROOT,file)));
  }
}
const missing=[...refs.keys()].filter(k=>!ALL.has(k) && !ALL.has(k.split(".")[0]));
console.log(`system.* paths referenced by templates: ${refs.size}`);
if (missing.length) { console.log("NOT PRESENT ON ANY MODEL:"); for(const k of missing) console.log(`  system.${k}   <- ${[...refs.get(k)].join(", ")}`); }
else console.log("every system.* path a template reads exists on a live model");
