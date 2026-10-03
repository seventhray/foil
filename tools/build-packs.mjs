/**
 * tools/build-packs.mjs
 * Compiles each compendium's JSON source (src/packs/<pack>/) into the LevelDB
 * pack Foundry loads (packs/<pack>/, git-ignored), with the official Foundry CLI.
 * Packs not listed in system.json are removed from packs/.
 *   npm run build
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYSTEM = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));

// Fixed stamps keep compiled packs reproducible from the same source.
const STATS = {
  coreVersion: "14.367",
  systemId: SYSTEM.id, systemVersion: SYSTEM.version,
  createdTime: 0, modifiedTime: 0, lastModifiedBy: null,
  compendiumSource: null, duplicateSource: null, exportSource: null
};
const stamp = doc => { doc._stats = { ...STATS }; return doc; };

export async function buildPacks() {
  const listed = new Set();
  for (const pack of SYSTEM.packs) {
    const src = path.join(ROOT, "src", "packs", pack.name);
    const dest = path.join(ROOT, pack.path);
    listed.add(path.basename(dest));
    if (!fs.existsSync(src)) throw new Error(`No source for pack "${pack.name}" at ${src}`);
    fs.rmSync(dest, { recursive: true, force: true });
    await compilePack(src, dest, {
      transformEntry: async entry => { stamp(entry); entry.pages?.forEach(stamp); }
    });
    console.log(`  built ${pack.path} (${fs.readdirSync(src).filter(f => f.endsWith(".json")).length} documents)`);
  }
  const packsDir = path.join(ROOT, "packs");
  for (const dir of fs.existsSync(packsDir) ? fs.readdirSync(packsDir) : []) {
    if (!listed.has(dir)) { fs.rmSync(path.join(packsDir, dir), { recursive: true, force: true }); console.log(`  removed packs/${dir} (not in system.json)`); }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await buildPacks();
