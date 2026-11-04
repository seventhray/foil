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
// PHB 2.3.0's cost table: the Talent, Know-how, and Training prices quoted in its rows match the code.
const talentRow = phb.match(/\(\*\*Talent\*\*\) \| The Attribute's Potential \|/);
const knowRow = phb.match(/\(\*\*Know-how\*\*\) \| 2 times the Attribute's Potential \|/);
const trainRow = phb.match(/8 plus 2 for each point it already has: (\d+) for \+1, (\d+) for \+2, up to (\d+) for \+10/);
const ladderOk = !!talentRow && XP_COST.talent === 1
  && knowRow && XP_COST.knowHow === 2 && knowHowCost({ d4: 2 }) === 16
  && trainRow && [trainingCost(0), trainingCost(1), trainingCost(9)].join() === [trainRow[1], trainRow[2], trainRow[3]].join();
ok("PHB 2.3.0 cost table matches Talent, Know-how, and Training prices", ladderOk && /Training by \+1 \(max: the dice in its two pools\)/.test(phb)
  && /costs 8 XP, plus 2 for each point the Skill already has/.test(all));
ok("d12 to d20 4 times the Potential as a Transformation; guide prices",
  XP_COST.transformation === 4 && /\*\*Transformation\*\*: a lasting change that advances a d12 Attribute die to d20[^|]*\|\s*4 times the Attribute's Potential \|/.test(phb) && /### 2\.3\.1 Transformations/.test(phb) && /## 7\.3\.0 Transformations/.test(phb)
  && /a die one size the Attribute's Potential, d12 to d20 4 times it as a Transformation \(PHB 2\.3\.1\), a new 1d4 2 times it/.test(all));
ok("every Attribute starts at 2d4", /Every Attribute starts at 2d4/.test(phb) && /Every Attribute starts at 2d4/.test(all));
ok("Training cap is the dice in the two pools", /Training can't exceed the total number of dice in its contributing Attribute pools \(/.test(phb) && /can't pass the number of dice in the Skill's two pools\./.test(all));
ok("+N Pierce is half the bonus", /Pierce equal to half its bonus, rounded down/.test(phb) && /Pierce equal to half the bonus, rounded down/.test(all));
ok("Strain is floor((XP - 24) / 8)", /\*\*Strain = floor\(\(XP - 24\) \/ 8\)\*\*/.test(fm) && /floor\(\(XP - 24\) \/ 8\)/.test(all));
ok("Strain lands on the Primary Attribute", /Strain applies to the Instrument's Primary Attribute/.test(phb) && /on the Instrument's Primary Attribute/.test(all));
ok("margin cap by weight: half Light, all Medium, all Heavy after doubling", /A Heavy Instrument doubles it\. Then cap the margin at the Potential of the Instrument's Primary Attribute: half of it, rounded down, for a Light Instrument, and all of it for Medium or Heavy\. Add the Technique's Effects/.test(phb) && /<strong>all<\/strong> for Medium/.test(all));
ok("four Instrument Types, each with what it harms, and none adds Stress", /\| Melee \| Might or Finesse \|/.test(phb) && /\| Sonic \| Wit or Presence \|/.test(phb)
  && /No Type or Property adds Stress/.test(all) && /<td>Melee<\/td><td>Might or Finesse<\/td>/.test(all) && /<td>Sonic<\/td><td>Wit or Presence\./.test(all));
ok("Drawn reloads with the Quick Action, Fired with the Action", /\| Drawn \| It is reloaded with the Quick Action\. \|/.test(phb) && /\| Fired \| It is reloaded with the Action\. \|/.test(phb)
  && /Reload with the Quick Action \/ the Action/.test(all));
ok("Guard: the Quick Action, +2 to Oppose for 1 round", /Spend your Quick Action to \*\*Guard\*\* with a Guarding Instrument/.test(phb) && /For 1 round, the guarded character gets \+2 to Oppose/.test(phb)
  && /For 1 round, the guarded character gets \+2 to Oppose/.test(all));
ok("a signature costs the Action, with Strain past 11 XP", /A signature costs the Action, whatever the Instrument's weight\. A signature priced over 11 XP costs Strain/.test(phb)
  && /A signature costs the Action at any weight\. A signature priced over 11 XP costs 1 Strain for each full 8 XP over\./.test(all));
ok("weight classes 15/30/45p, 2/4/8 lbs, Medium full cap, Heavy whole turn with the margin doubled", /Light 15p, Medium 30p, Heavy 45p/.test(phb) && /A Heavy Instrument \| 8 lbs/.test(phb) && /\(15p, 30p, 45p\)/.test(all) && /\(2, 4, 8 lbs\)/.test(all)
  && /A Medium Instrument's margin caps at the full Primary Potential/.test(phb) && /A Heavy Instrument's Stress Technique costs the Action and the Quick Action\. Its margin is doubled, then capped at the full Primary Potential\. It takes both hands/.test(phb)
  && /its margin doubles before the cap/.test(all));
ok("Incapacitation lifts at half Potential, rounded down", /down to half its Potential, rounded down/.test(phb) && /half its Potential or less, rounded down/.test(all));
ok("Foil Tokens: max four, halve one source, reroll one die", /at most \*\*four\*\* Foil Tokens/.test(phb) && /halves the Stress from one source/.test(phb) && /reroll any one die/.test(phb)
  && /at most four/.test(all) && /halve the Stress from one source, rounded down/.test(all));
ok("rest 1d4 per 2 hours, a ration at the start covers 8", /Every 2 hours of rest removes \*\*1d4 Stress\*\*/.test(phb) && /A rest uses one ration at its start\. The ration covers up to 8 hours/.test(phb) && /1d4 Stress every 2 hours/.test(all));
ok("carrying past 4x Might Potential", /Up to 4x Might Potential \| None/.test(phb) && /past 4x Might Potential/.test(all));
ok("combination premium 4 XP per Effect beyond the first", /plus 4 XP for each Effect past the first/.test(phb) && /4 XP for every Effect beyond the first/.test(all));
ok("Effect prices match PHB 4.2.1", /\*\*Stress\*\*\s*\|\s*4\s*\|/.test(phb) && /\*\*-N\*\* \[target Attribute\]\s*\|\s*6 x N, or 24 x N for 1 minute/.test(phb)
  && /\*\*Mend Xd4\*\*\s*\|\s*10 x X/.test(phb) && /\*\*Counter\*\*\s*\|\s*12/.test(phb) && /<td>6 x N, or 24 x N for 1 minute<\/td>/.test(all) && /<td>10 x X<\/td>/.test(all)
  && /\*\*Lingering N\*\*\s*\|\s*7 x N/.test(phb) && /\*\*Hasten \(Action\)\*\*\s*\|\s*14/.test(phb) && /\*\*Hasten \(Quick Action\)\*\*\s*\|\s*11/.test(phb) && /\*\*Quick\*\*\s*\|\s*3\s/.test(phb) && /<td>7 x N<\/td>/.test(all));
ok("bonus price ladder", /\| \+4\s*\| \+200p\s*\| \+400p\s*\| \+800p/.test(phb) && /<td>\+4<\/td><td>200p<\/td><td>400p<\/td><td>800p<\/td>/.test(all));
ok("Body and Voice kits", /\*\*Strike\*\* \(Prowess\)/.test(phb) && /\*\*Persuade\*\* \(Resonance\)/.test(phb) && /Strike and Grapple, and it backs Threaten/.test(all) && /Threaten, Deceive, and Persuade/.test(all));
ok("Mind kit", /\*\*Deduce\*\* \(Discipline\)/.test(phb) && /\*\*Intuit\*\* \(Resonance\)/.test(phb) && /Deduce, Analyze, Intuit/.test(all));
ok("Training price matches the code", all.includes(`+1 Training ${XP_COST.training} XP plus ${XP_COST.trainingStep} per point held`));

console.log(fails ? `\n${fails} guide check(s) failed` : "\nguide matches the books");
process.exit(fails ? 1 : 0);
