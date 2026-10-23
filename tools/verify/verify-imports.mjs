/**
 * Every relative import in src/ and rules/ must resolve to a file, and rules/ must stay pure:
 * it imports only itself, and uses no Foundry or browser globals. The src/ shims for the moved modules
 * must re-export exactly what rules/ exports.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.name === "packs" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []);
let bad = 0;
const fail = m => { bad++; console.log("  FAIL  " + m); };

const files = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "rules"))];
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const [, spec] of s.matchAll(/(?:from|import\()\s*["'](\.[^"']+)["']/g)) {
    if (!fs.existsSync(path.resolve(path.dirname(f), spec))) fail(`${path.relative(ROOT, f)} imports ${spec}, which does not exist`);
  }
}
console.log(`  ${files.length} files, every relative import resolves`);

const GLOBALS = /\b(game|ui|Hooks|CONFIG|foundry|canvas|ChatMessage|Roll|Actor|Item|Dialog|Application|ApplicationV2|Handlebars|CONST|fromUuid|TextEditor|Folder|Combat|renderTemplate|loadTemplates|document|window|localStorage|process|Math\.random|Date\.now|new Date)\b/;
const rules = walk(path.join(ROOT, "rules"));
for (const f of rules) {
  const s = fs.readFileSync(f, "utf8");
  const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
  const g = code.match(GLOBALS);
  if (g) fail(`rules/${path.basename(f)} uses ${g[1]}`);
  for (const [, spec] of s.matchAll(/from\s*["'](\.[^"']+)["']/g)) {
    if (!/^\.\/[\w-]+\.js$/.test(spec)) fail(`rules/${path.basename(f)} imports ${spec}; rules/ may import only its own files`);
  }
}
console.log(`  ${rules.length} rules modules use no Foundry, browser or nondeterministic globals`);

let shims = 0;
for (const f of rules) {
  const name = path.basename(f), shim = path.join(ROOT, "src", name);
  if (!fs.existsSync(shim) || !/^export \* from "\.\.\/rules\/[\w-]+\.js";\s*$/.test(fs.readFileSync(shim, "utf8"))) continue;   // a src/ file of the same name that is not a one-line re-export is its own module
  shims++;
  const a = Object.keys(await import(pathToFileURL(f))).sort().join(","), b = Object.keys(await import(pathToFileURL(shim))).sort().join(",");
  if (a !== b) fail(`src/${name} re-exports ${b} but rules/${name} exports ${a}`);
}
console.log(`  ${shims} src/ shims re-export exactly what their rules/ module exports`);
process.exit(bad ? 1 : 0);
