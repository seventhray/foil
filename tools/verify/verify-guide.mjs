// The in-app guide restates printed numbers, so it silently rots whenever the
// books move. Check its markup, then check the figures it states against the
// Player's Handbook, the GM's Guide, and Fundamental Math directly.
import { GUIDE } from "../guide-content.mjs";
import { readPHB, readGMG, readFM, BOOK_VERSION } from "../books.mjs";
import { XP_COST, knowHowCost, trainingCost } from "../../src/constants.js";
const phb = readPHB(), gmg = readGMG(), fm = readFM();

let fails = 0;
const ok = (label, cond) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) fails++; };

const VOID = new Set(["br", "hr", "img", "input", "meta", "link"]);
let pages = 0;
for (const j of GUIDE) for (const pg of j.pages) {
  pages++;
  const stack = []; let bad = null;
  for (const m of pg.html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [full, tag, selfClose] = m;
    if (VOID.has(tag.toLowerCase()) || selfClose) continue;
    if (full.startsWith("</")) { if (stack.pop() !== tag) { bad = `mismatched </${tag}>`; break; } }
    else stack.push(tag);
  }
  if (!bad && stack.length) bad = `unclosed <${stack[stack.length - 1]}>`;
  if (bad) { console.log(`  FAIL  markup: ${j.name} / ${pg.name}: ${bad}`); fails++; }
  if (/§|→|—/.test(pg.html)) { console.log(`  FAIL  style: ${j.name} / ${pg.name} uses §, →, or an em-dash`); fails++; }
}
console.log(`  PASS  markup: ${pages} pages checked`);

const all = GUIDE.flatMap(j => j.pages.map(p => p.html)).join("\n");
console.log(`\nfigures cross-checked against the v${BOOK_VERSION} books:`);
// PHB 2.3.0's cost lookup: every Talent, Know-how, and Training cell matches the code's prices.
const costRows = [...phb.matchAll(/^\| (\d+) \| ([^|]*)\| ([^|]*)\| ([^|]*)\|$/gm)].map(m => m.slice(1).map(c => c.trim()));
const ladderOk = costRows.length >= 10 && costRows.every(([xp, talent, knowHow, training]) => {
  const t = talent.match(/^d(\d+) to d\d+$/), k = knowHow.match(/^(\d+)\w\w die$/), r = training.match(/^\+(\d+) to \+\d+$/);
  return (!talent || (t && XP_COST.talent[t[1]] === +xp)) && (!knowHow || (k && knowHowCost({ d4: +k[1] - 1 }) === +xp))
    && (!training || (r && trainingCost(+r[1]) === +xp));
});
ok("PHB 2.3.0 cost lookup matches Talent, Know-how, and Training prices", ladderOk && /Training by \+1 \(max: the dice in its two pools\)/.test(phb)
  && /costs 8 XP, plus 2 for each point the Skill already has/.test(all));
ok("d12 to d20 100 as a Transformation; guide prices",
  /\*\*Transformation\*\*: a lasting change that advances a d12 Attribute die to d20[^|]*\|\s*100 XP/.test(phb) && /### 2\.3\.1 Transformations/.test(phb) && /## 7\.12\.0 Transformations/.test(phb)
  && /8, 12, 16, or 20 XP by its size, d12 to d20 100 XP as a Transformation \(PHB 2\.3\.1\), a new 1d4 12 XP plus 4 per die already in the pool/.test(all));
ok("every Attribute starts at 2d4", /Every Attribute starts at 2d4/.test(phb) && /Every Attribute starts at 2d4/.test(all));
ok("Training cap is the dice in the two pools", /Training can't exceed the number of dice in its two pools \(/.test(phb) && /can't pass the number of dice in the Skill's two pools\./.test(all));
ok("+N Pierce is half the bonus", /Pierce equal to half its bonus, rounded down/.test(phb) && /Pierce equal to half the bonus, rounded down/.test(all));
ok("Strain is floor((XP - 24) / 8)", /\*\*Strain = floor\(\(XP - 24\) \/ 8\)\*\*/.test(fm) && /floor\(\(XP - 24\) \/ 8\)/.test(all));
ok("Strain lands on the Primary Attribute", /Strain applies to the Instrument's Primary Attribute/.test(phb) && /on the Instrument's Primary Attribute/.test(all));
ok("margin cap by weight: half Light, all Medium, all Heavy after doubling", /A Heavy Instrument doubles it\. Then cap the margin at the Potential of the Instrument's Primary Attribute: half of it, rounded down, for a Light Instrument, and all of it for Medium or Heavy\. Add one/.test(phb) && /<strong>all<\/strong> for Medium/.test(all));
ok("Edged +3, physical Resistance counts double", /\| Edged \| \+3 Stress against a physical Attribute\. Physical Resistance, after Pierce, counts double against it/.test(phb) && /Physical Resistance counts double against Edged/.test(all));
ok("Blunt Pierce 3", /\| Blunt \| Pierce 3/.test(phb) && /Pierce 3 against physical Resistance/.test(all));
ok("Drawn +2, Fired +4", /\| Drawn \| \+2 Stress/.test(phb) && /\| Fired \| \+4 Stress/.test(phb) && /\+2 \/ \+4 Stress/.test(all));
ok("weight classes 15/30/45p, 2/4/8 lbs, Medium full cap, Heavy whole turn with the margin doubled", /Light 15p, Medium 30p, Heavy 45p/.test(phb) && /A Heavy Instrument \| 8 lbs/.test(phb) && /\(15p, 30p, 45p\)/.test(all) && /\(2, 4, 8 lbs\)/.test(all)
  && /\*\*Medium\*\*: its margin caps at the full Primary Potential/.test(phb) && /\*\*Heavy\*\*: any Technique through it, a Quick one included, costs the Action and the Quick Action\. Its margin is doubled, then capped at the full Primary Potential\. It takes both hands/.test(phb)
  && /doubles the margin before the cap/.test(all));
ok("Incapacitation lifts at half Potential, rounded down", /down to half its Potential, rounded down/.test(phb) && /half its Potential or less, rounded down/.test(all));
ok("Foil Tokens: max four, halve one source, reroll one die", /at most \*\*four\*\* Foil Tokens/.test(phb) && /halves the Stress from one source/.test(phb) && /reroll any one die/.test(phb)
  && /at most four/.test(all) && /halve the Stress from one source, rounded down/.test(all));
ok("rest 1d4 per 2 hours, one ration per 8", /Every 2 hours of rest removes \*\*1d4 Stress\*\*/.test(phb) && /Each 8 hours uses one ration/.test(phb) && /1d4 Stress every 2 hours/.test(all));
ok("carrying past 4x Might Potential", /Up to 4x Might Potential \| None/.test(phb) && /past 4x Might Potential/.test(all));
ok("combination premium 4 XP per Effect beyond the first", /plus 4 XP for each Effect past the first/.test(phb) && /4 XP for every Effect beyond the first/.test(all));
ok("Effect prices match Fundamental Math", /\*\*Stress\*\*\s*\|\s*4\s*\|/.test(fm) && /\*\*-N\*\* \[target Attribute\]\s*\|\s*18 x N/.test(fm)
  && /\*\*Mend Xd4\*\*\s*\|\s*10 x X/.test(fm) && /\*\*Counter\*\*\s*\|\s*12/.test(fm) && /<td>18 x N<\/td>/.test(all) && /<td>10 x X<\/td>/.test(all)
  && /\*\*Lingering N\*\*\s*\|\s*7 x N/.test(fm) && /\*\*Hasten \(Action\)\*\*\s*\|\s*14/.test(fm) && /\*\*Hasten \(Quick Action\)\*\*\s*\|\s*11/.test(fm) && /\*\*Quick\*\*\s*\|\s*3\s/.test(fm) && /<td>7 x N<\/td>/.test(all));
ok("bonus price ladder", /\| \+4\s*\| \+200p\s*\| \+400p\s*\| \+800p/.test(phb) && /<td>\+4<\/td><td>200p<\/td><td>400p<\/td><td>800p<\/td>/.test(all));
ok("Body and Voice kits", /\*\*Strike\*\* \(Prowess\)/.test(phb) && /\*\*Sway\*\* \(Resonance\)/.test(phb) && /Strike, Grapple, Menace/.test(all) && /Intimidate, Mislead, Sway/.test(all));
ok("Training price matches the code", all.includes(`+1 Training ${XP_COST.training} XP plus ${XP_COST.trainingStep} per point held`));

console.log(fails ? `\n${fails} guide check(s) failed` : "\nguide matches the books");
process.exit(fails ? 1 : 0);
