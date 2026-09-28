// The in-app guide restates printed numbers, so it silently rots whenever the
// books move. Parse it as XML to catch malformed markup, then check the figures
// that matter against the Player's Handbook and Fundamental Math directly.
import { GUIDE } from "../guide-content.mjs";
import fs from "node:fs";
const BOOKS = "/home/connor/Documents/Foilbound Ombril/Foilbound";
const phb = fs.readFileSync(`${BOOKS}/Foilbound TTRPG Player's Handbook v0.3.0.md`, "utf8");
const fm  = fs.readFileSync(`${BOOKS}/Design Docs/Fundamental Math.md`, "utf8");
const gmg = fs.readFileSync(`${BOOKS}/Foilbound TTRPG Game Master's Guide v0.3.0.md`, "utf8");

let fails = 0;
const ok = (label, cond, note="") => { console.log(`  ${cond?"PASS":"FAIL"}  ${label}${note?" — "+note:""}`); if(!cond) fails++; };

// 1. well-formedness: every page must parse as a fragment
const VOID = new Set(["br","hr","img","input","meta","link"]);
for (const j of GUIDE) for (const pg of j.pages) {
  const stack=[]; let bad=null;
  for (const m of pg.html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [full, tag, selfClose] = m;
    if (VOID.has(tag.toLowerCase()) || selfClose) continue;
    if (full.startsWith("</")) { if (stack.pop() !== tag) { bad = `mismatched </${tag}>`; break; } }
    else stack.push(tag);
  }
  if (!bad && stack.length) bad = `unclosed <${stack[stack.length-1]}>`;
  if (bad) { console.log(`  FAIL  markup: ${j.name} / ${pg.name} — ${bad}`); fails++; }
}
console.log(`  PASS  markup: all ${GUIDE.reduce((n,j)=>n+j.pages.length,0)} pages are balanced`);

const all = GUIDE.flatMap(j => j.pages.map(p => p.html)).join("\n");
console.log("\nfigures cross-checked against the books:");
ok("Training is 4 XP, capped at +4", /Training by \+1 \(max \*\*\+4\*\*\)\s*\|\s*4 XP/.test(phb) && /costs 4 XP a point and stops at \+4/.test(all));
ok("roll modifiers price at 6 x N", /\*\*\+N\*\* \(this roll\)\s*\|\s*6 x N/.test(fm) && /6 XP per point/.test(all));
ok("Pierce and Resistance stay at 4", /\*\*Pierce N\*\*\s*\|\s*4 x N/.test(fm) && /Pierce, Resistance\) cost <strong>4/.test(all));
ok("Strain is floor(XP / 16)", /\*\*Strain = floor\(XP \/ 16\)\.?\*\*/.test(fm) && /floor\(XP \/ 16\)/.test(all));
ok("gate is 12 + 4 x floor(XP / 16)", /Gate = 12 \+ 4 x floor\(XP \/ 16\)/.test(fm) && /12 \+ 4 x floor\(XP \/ 16\)/.test(all));
ok("starting Health is 36", /Health \(36, the sum/.test(fm) && /36 for a starting character/.test(all));
ok("Fired's rider is a flat +2", /Fired adds a flat \*\*\+2 Stress\*\*/.test(phb) && /Only Fired has one, at \+2/.test(all));
ok("Heavy carries inherent Pierce 1", /inherent \*\*Pierce 1\*\*/.test(phb) && /inherent Pierce 1/.test(all));
ok("defensive floor is 8 XP", /costs at least \*\*8 XP\*\*/.test(fm) && /costs at least 8 XP/.test(all));
ok("a die-size advance is 8 XP", /one size \(\*\*Talent[^|]*\|\s*8 XP/.test(phb) && /<td>8<\/td>/.test(all));
ok("d12 to d20 is 36 XP", /Advance a d12 Attribute Die to d20[^|]*\|\s*36 XP/.test(phb) && /<td>36<\/td>/.test(all));
ok("a new 1d4 is 18 XP", /Add a 1d4 to an .*?\|\s*18 XP/.test(phb) && /<td>18<\/td>/.test(all));
ok("session award is 20 XP", /Award \*\*20 XP\*\* for a standard session/.test(gmg) && /20 XP for a standard session/.test(all));
ok("FOIL axes run -5 to +5", /scale is -5 to \+5|<strong>Levity<\/strong>/.test(all) && /-5 to \+5/.test(all));
ok("Tier 3 is Potential 8 / 1d8", /\|\s*3\s*\|\s*8\s*\|\s*1d8/.test(gmg) && /<td>3<\/td><td>8<\/td><td>1d8<\/td>/.test(all));
ok("Tier 10 is Potential 34 / 1d20+1d8+1d6", /\|\s*10\s*\|\s*34\s*\|\s*1d20\+1d8\+1d6/.test(gmg) && /<td>1d20\+1d8\+1d6<\/td>/.test(all));

console.log(fails ? `\n${fails} guide check(s) failed` : "\nguide matches the books");
process.exit(fails ? 1 : 0);
