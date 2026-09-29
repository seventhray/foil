/**
 * tools/books.mjs
 * Where the rulebooks live, and small readers shared by the seeder and the
 * verify scripts. Set FOIL_BOOKS to point elsewhere; FOIL_VERSION picks the
 * book version (defaults to the system's own version).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
export const SYSTEM_ROOT = path.resolve(HERE, "..");
export const SYSTEM_VERSION = JSON.parse(fs.readFileSync(path.join(SYSTEM_ROOT, "system.json"), "utf8")).version;
export const BOOKS = process.env.FOIL_BOOKS ?? "/home/connor/Vaults/Foilbound Ombril/Foilbound";
export const BOOK_VERSION = process.env.FOIL_VERSION ?? SYSTEM_VERSION;

export const PHB_PATH = path.join(BOOKS, `Foilbound TTRPG Player's Handbook v${BOOK_VERSION}.md`);
export const GMG_PATH = path.join(BOOKS, `Foilbound TTRPG Game Master's Guide v${BOOK_VERSION}.md`);
export const FM_PATH = path.join(BOOKS, "Design Docs", "Fundamental Math.md");

export const readPHB = () => fs.readFileSync(PHB_PATH, "utf8");
export const readGMG = () => fs.readFileSync(GMG_PATH, "utf8");
export const readFM = () => fs.readFileSync(FM_PATH, "utf8");

/**
 * Every Catalog note's frontmatter, grouped by folder. The notes are YAML;
 * PyYAML reads them so this script needs no npm dependency.
 * @returns {{ techniques: object[], feats: object[], instruments: object[], tools: object[] }}
 */
export function readCatalog() {
  const py = `
import yaml, glob, json, os, sys
root = sys.argv[1]
out = {}
for folder in ["Techniques", "Feats", "Instruments", "Tools"]:
    rows = []
    for f in sorted(glob.glob(os.path.join(root, "Catalog", folder, "*.md"))):
        text = open(f, encoding="utf-8").read()
        parts = text.split("---")
        if len(parts) < 3: continue
        d = yaml.safe_load(parts[1]) or {}
        d["_file"] = os.path.basename(f)
        rows.append(d)
    out[folder.lower()] = rows
print(json.dumps(out, default=str))
`;
  const json = execFileSync("python3", ["-c", py, BOOKS], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(json);
}

/** Split one markdown table row into trimmed cells. */
export function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(c => c.trim());
}

/**
 * The first markdown table after a heading, as an array of row objects keyed
 * by the header cells.
 */
export function tableAfter(text, headingRe) {
  const lines = text.split("\n");
  const start = lines.findIndex(l => headingRe.test(l));
  if (start < 0) throw new Error(`heading not found: ${headingRe}`);
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) {
    if (/^#{1,4} /.test(lines[i])) throw new Error(`no table under ${headingRe}`);
    i++;
  }
  const header = cells(lines[i]);
  const rows = [];
  for (i += 2; i < lines.length && lines[i].trim().startsWith("|"); i++) {
    const c = cells(lines[i]);
    rows.push(Object.fromEntries(header.map((h, k) => [h, c[k] ?? ""])));
  }
  return rows;
}

/** The body of a heading's section, up to the next heading of the same or higher level. */
export function sectionText(text, headingRe) {
  const lines = text.split("\n");
  const start = lines.findIndex(l => headingRe.test(l));
  if (start < 0) throw new Error(`heading not found: ${headingRe}`);
  const level = lines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length && !(new RegExp(`^#{1,${level}} `).test(lines[end]))) end++;
  return lines.slice(start + 1, end).join("\n");
}
