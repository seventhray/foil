/**
 * Every creature note's Data block must render, in JS, to exactly the callout the note carries.
 * Not part of run.mjs, since it reads the vault: FOIL_BESTIARY=/path/to/Campaign/Creatures node tools/verify/verify-bestiary-block.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { CREATURES_DIR } from "../seed-bestiary.mjs";
import { readBlock, renderCallout } from "../creature-block.mjs";

let checked = 0, bad = 0, missing = 0;
for (const f of fs.readdirSync(CREATURES_DIR).filter(f => f.endsWith(".md") && f !== "Bestiary.md").sort()) {
  const s = fs.readFileSync(path.join(CREATURES_DIR, f), "utf8");
  if (!/^tier:\s*\d+/m.test(s) || /not yet built/.test(s)) continue;
  const d = readBlock(s);
  if (!d) { missing++; console.log(`no Data block: ${f}`); continue; }
  const { schema, ...rest } = d;
  const start = s.indexOf("> [!creature]");
  let end = start;
  for (const line of s.slice(start).split("\n")) { if (!line.startsWith(">")) break; end += line.length + 1; }
  const have = s.slice(start, end - 1);
  checked++;
  if (renderCallout(rest) !== have) { bad++; console.log(`callout differs from its Data block: ${f}`); }
}
console.log(`${checked} creatures checked, ${bad} differ, ${missing} without a block`);
process.exit(bad ? 1 : 0);
