/**
 * tools/populate-packs.mjs
 * Seeds every FOIL compendium from the books (Foilbound 0.6.0). Content comes
 * from the vault's Catalog notes (Techniques, Feats, Instruments, Tools) and
 * the Player's Handbook tables (Equipment, Backgrounds, Origins, Focus
 * Gems, item sizes); the vocabulary (Instrument Types, Qualities, Effects)
 * mirrors PHB 4.1.1 and Fundamental Math's Effects table.
 *
 * Writes JSON source to src/packs/<pack>/ (committed), then compiles packs/
 * with tools/build-packs.mjs (git-ignored):
 *   npm run seed
 * Flags: --dry-run writes nothing; --habits-only writes src/habits.js and stops;
 * --no-build writes the source without compiling.
 * Env (or tools/local-paths.json): FOIL_BOOKS; optional FOIL_VERSION.
 *
 * Every catalog Technique is decomposed into priced Effects and re-priced by
 * src/pricing.js. Its price is computed from the Effects; rows whose
 * Effects don't add up to the printed XP are listed at the end (the computed price is used).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { rangeBandOf, rangeMinOf } from "../src/constants.js";
import { priceTechnique, strainFor, STRAIN_FREE_XP } from "../src/pricing.js";
import { GUIDE } from "./guide-content.mjs";
import {
  SYSTEM_ROOT, SYSTEM_VERSION, readPHB, readCatalog, tableAfter, sectionText, setting
} from "./books.mjs";
import { buildPacks } from "./build-packs.mjs";
import { buildGlossary } from "./build-glossary.mjs";
import { buildCreatureData } from "./build-creature-data.mjs";
import { bestiaryDocs } from "./seed-bestiary.mjs";
import { EQUIPMENT_CATEGORY_LABEL, MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL } from "../src/constants.js";



const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const slug = name => String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const lc = s => String(s ?? "").trim().toLowerCase();
const num = s => Number(String(s ?? "").replace(/[^0-9.-]/g, "")) || 0;

const PHB = readPHB();
const CAT = readCatalog();
const warnings = [];

// ─── Vocabulary: Instrument Types and Properties (PHB 4.1.1) ─────────────────
// [name, key, kind, family, {harms, quick, reload, isTool}, description]. No Type or Property adds Stress (PHB 4.1.1).
const CRAFT_MATERIALS = ["Metal", "Wood", "Leather", "Gemstone", "Textile", "Reagent", "Stone"];
const INSTRUMENT_TYPES = [
  ["Melee", "melee", "type", "melee", { harms: "physical" }, "Harms Might or Finesse: swords, axes, hammers, spears, shields, fists, and claws."],
  ["Ranged", "ranged", "type", "ranged", { harms: "physical" }, "Harms Might or Finesse: bows, crossbows, slings, and nets."],
  ["Arcane", "arcane", "type", "arcane", {}, "Harms Might or Finesse through Kinetic, Wit or Presence through Incorporeal: wands, staffs, and tomes."],
  ["Sonic", "sonic", "type", "sonic", { harms: "mental" }, "Harms Wit or Presence: voices, horns, drums, and strings. Its Conditions reach each creature its user chooses that can hear it within its Range, and its Stress lands only on its target."],
  ["Grappling", "grappling", "property", "other", {}, "It can hold a creature (PHB 6.8.3)."],
  ["Guarding", "guarding", "property", "other", {}, "It guards its user or an ally within its Range, covering the Attributes it harms (PHB 6.5.1, 6.5.2)."],
  ["Kinetic", "kinetic", "property", "arcane", { harms: "physical" }, "An Arcane Instrument with it harms Might or Finesse, with fire, cold, lightning, acid, or force."],
  ["Incorporeal", "incorporeal", "property", "arcane", { harms: "mental" }, "An Arcane Instrument with it harms Wit or Presence, with fear, curses, or drained life. It also carries life magic, such as Mend."],
  ["Thrown", "thrown", "property", "other", {}, "It can be thrown. A Melee Instrument with it is thrown at any target past its reach, out to Range 4, and counts as Ranged for that Technique."],
  ["Drawn", "drawn", "property", "other", { reload: "quick" }, "It is reloaded with the Quick Action."],
  ["Fired", "fired", "property", "other", { reload: "action" }, "It is reloaded with the Action."],
  ["Immobile", "immobile", "property", "other", {}, "It is fixed in place: using it means being there."],
  ["Tools", "tool", "property", "other", { isTool: true }, "Its rolls are Trades (PHB 4.2.6)."],
  ...CRAFT_MATERIALS.map(m => [`Tools [${m}]`, `craft-${slug(m)}`, "property", "other", { isTool: true }, `Its rolls are Trades, and it works ${m}.`]),
  ["Quick", "quick", "property", "other", { quick: true }, "Creatures only (GMG 9.6.0): this natural weapon's built-in Techniques may be used as a Quick Action. A Light Instrument already can (PHB 4.2.2)."]
];
const TYPE_KEYS = new Set(INSTRUMENT_TYPES.map(t => t[1]));
function instrumentTypeDoc([name, key, kind, family, o, desc]) {
  return { name, type: "instrumentType", img: "icons/svg/upgrade.svg",
    system: { key, kind, family, harms: o.harms ?? "", quick: !!o.quick, reload: o.reload ?? "", isTool: !!o.isTool, description: `<p>${desc}</p>` } };
}

// ─── Vocabulary: Qualities (PHB 7.9.1, GMG 10.0.0 for Aid, Fundamental Math Passive Properties) ─
const QUALITIES = [
  ["Resistance", "resistance", "resistance", "resistanceKind", "+N physical or mental", "Reduce the Stress of every Technique of that kind by N."],
  ["Skill Bonus", "skill-bonus", "skill", "skill", "+N to a Skill", "Add N to the named Skill's rolls."],
  ["Weakened", "weakened", "skill", "attribute", "-N to an Attribute", "The named Attribute takes Weakened, -N to its rolls."],
  ["Aid", "aid", "aid", "free", "+N to a named task", "Add N to a named task outside of conflict."]
];
function qualityDoc([name, key, kind, scope, valueLabel, desc]) {
  return { name, type: "quality", img: "icons/svg/shield.svg",
    system: { key, kind, scope, valueLabel, description: `<p>${desc}</p>` } };
}

// ─── Vocabulary: Effects (Fundamental Math, Technique Effects) ─────────────
const ATTACK = ["melee", "ranged", "arcane", "sonic"];
const SOCIAL = ["incorporeal", "sonic"];
// [name, key, pricingKind, {base, perPoint, perBand}, {requires, label, exempt, floor}, description]
const EFFECTS = [
  ["Stress", "stress", "flat", { base: 4 }, {}, "Deal the margin to an Attribute of the Target."],
  ["+1 Stress (hit-count rider)", "stress-rider", "flat", { base: 8 }, {}, "+1 Stress on a landed hit."],
  ["+N [Skill or Oppose]", "skill-mod", "perPoint", { perPoint: 3 }, { requires: ["sonic", "arcane", "guarding", "tool"], label: "+N", floor: true }, "+N to a named Skill's rolls for 1 round."],
  ["+N [Skill or Oppose] (1 minute)", "skill-mod-minute", "perPoint", { perPoint: 6 }, { requires: ["sonic", "arcane", "guarding", "tool"], label: "+N", floor: true }, "+N to a named Skill's rolls for 1 minute."],
  ["-N [Oppose]", "reeling", "perPoint", { perPoint: 4 }, { label: "-N Oppose" }, "Reeling: the target's Oppose rolls take -N for 1 round (PHB 6.8.6)."],
  ["-N [Oppose] (1 minute)", "reeling-minute", "perPoint", { perPoint: 16 }, { label: "-N Oppose" }, "Reeling: the target's Oppose rolls take -N for 1 minute (PHB 6.8.6)."],
  ["-N [target Attribute]", "weaken", "perPoint", { perPoint: 6 }, { label: "-N [target Attribute]" }, "Weakened: the named Attribute's rolls take -N for 1 round (PHB 6.8.4)."],
  ["-N [target Attribute] (1 minute)", "weaken-minute", "perPoint", { perPoint: 24 }, { label: "-N [target Attribute]" }, "Weakened: the named Attribute's rolls take -N for 1 minute (PHB 6.8.4)."],
  ["+N (this roll)", "roll-bonus", "perPoint", { perPoint: 2 }, { label: "+N" }, "+N to this Technique's own roll."],
  ["Pierce N", "pierce", "perPoint", { perPoint: 4 }, { requires: ["melee", "ranged", "kinetic"], label: "Pierce N" }, "Ignore N of the target's Resistance."],
  ["Resistance +N", "resistance", "perPoint", { perPoint: 4 }, { requires: ["guarding", "kinetic", "incorporeal"], label: "Resistance +N" }, "Physical or mental Resistance +N."],
  ["Mend Xd4", "mend", "perPoint", { perPoint: 10 }, { requires: SOCIAL, label: "Mend Nd4" }, "Remove Xd4 Stress from one of an ally's Attributes, with no Medicine and no roll. Medicine or Mend once every 2 hours per creature (PHB 6.10.0)."],
  ["Remove [Condition]", "remove-condition", "perPoint", { perPoint: 1 }, { requires: SOCIAL, label: "Remove [Condition]" }, "End the named Condition on an ally, priced as that Condition."],
  ["Lingering N", "lingering", "perPoint", { perPoint: 7 }, { requires: ["melee", "ranged", "kinetic", "incorporeal"], label: "Lingering N" }, "N more Stress at the start of the target's next turns."],
  ["Redirect", "redirect", "flat", { base: 8 }, { requires: ["guarding"] }, "Take an ally's incoming Stress instead."],
  ["Move", "move", "flat", { base: 4 }, { requires: ["grappling", "melee", "kinetic", "incorporeal"] }, "Move the target up to Range 2."],
  ["Disarm", "disarm", "flat", { base: 8 }, { requires: ["grappling", "kinetic", "melee"] }, "The target Opposes with a Skill built on Might. If it fails, it drops the Instrument it used last. Innate Instruments can't be dropped."],
  ["Evade", "evade", "flat", { base: 4 }, { requires: ["kinetic", "incorporeal"] }, "Move without provoking."],
  ["Illusion", "illusion", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "A false sight or sound."],
  ["Drain", "drain", "flat", { base: 8 }, { requires: ["incorporeal"] }, "Heal what the Technique deals."],
  ["Counter", "counter", "flat", { base: 12 }, {}, "Contest another Technique as it lands, minus its Strain. A countered upkeep ends the Technique."],
  ["Hasten (Action)", "hasten-action", "flat", { base: 14 }, { requires: ["incorporeal"] }, "Grant an ally an extra Action."],
  ["Hasten (Quick Action)", "hasten-quick", "flat", { base: 11 }, { requires: ["incorporeal"] }, "Grant an ally an extra Quick Action."],
  ["Extend Range", "extend-range", "extendRange", { perBand: 1 }, { requires: ["kinetic", "incorporeal"] }, "1 XP per band of extra reach."],
  ["Pattern", "pattern", "pattern", {}, { requires: ATTACK }, "Beam or Wall: 1 + 2 + ... per band. Cone 3x, Radius 12x the Beam cost. A Melee Pattern reaches no farther than its Instrument's Range."],
  ["Selective", "selective", "selective", {}, { requires: ["ranged", "sonic", "arcane"] }, "Creatures within R bands: range at 1 XP per band, plus an 8 XP premium; Strain is paid per target."],
  ["Upkeep", "upkeep", "upkeep", { base: 8 }, { requires: ["arcane"], exempt: true }, "Keep an Action Technique active by paying a Quick Action and its Strain at the start of each later turn."],
  ["Quick", "quick", "quick", { base: 3 }, { exempt: true, floor: true }, "3 XP, outside the combination premium. A stated trigger sets the 8 XP floor."],
  // Conditions (PHB 6.8.x), priced flat.
  ["Grappled", "grappled", "flat", { base: 4 }, { requires: ["grappling", "kinetic"] }, "PHB 6.8.3."],
  ["Prone", "prone", "flat", { base: 11 }, { requires: ["melee", "ranged", "kinetic"] }, "PHB 6.8.7."],
  ["Restrained", "restrained", "flat", { base: 16 }, { requires: ["grappling", "kinetic"] }, "PHB 6.8.5."],
  ["Charmed", "charmed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.8."],
  ["Frightened", "frightened", "flat", { base: 8 }, { requires: SOCIAL }, "PHB 6.8.9."],
  ["Controlled", "controlled", "flat", { base: 25 }, { requires: ["incorporeal"] }, "PHB 6.8.10."],
  ["Intimidated", "intimidated", "flat", { base: 10 }, { requires: SOCIAL }, "PHB 6.8.11."],
  ["Baited", "baited", "flat", { base: 8 }, { requires: SOCIAL }, "PHB 6.8.12."],
  ["Angered", "angered", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.13."],
  ["Relaxed", "relaxed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.14."],
  ["Impressed", "impressed", "flat", { base: 10 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.15."],
  ["Swayed", "swayed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.18."],
  ["Misled", "misled", "flat", { base: 10 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.19."],
  ["Wary", "wary", "flat", { base: 8 }, { requires: SOCIAL }, "PHB 6.8.16."],
  ["Enthralled", "enthralled", "flat", { base: 20 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.17."],
  ["Blinded", "blinded", "flat", { base: 16 }, { requires: ["melee", "ranged", "kinetic", "incorporeal"] }, "PHB 6.8.20."],
  ["Slowed", "slowed", "flat", { base: 4 }, { requires: ["melee", "ranged", "kinetic", "incorporeal"] }, "PHB 6.8.21."],
  ["Stunned", "stunned", "flat", { base: 24 }, { requires: ATTACK }, "PHB 6.8.22."],
  ["Invisible", "invisible", "flat", { base: 8 }, { requires: ["incorporeal"] }, "PHB 6.8.23."],
  ["Foil Exposed", "foil-exposed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.24."]
];
const effectSystem = ([, key, pricingKind, p, o, desc]) => ({
  key, requires: o.requires ?? [], pricingKind,
  pricingParams: { base: p.base ?? 0, perPoint: p.perPoint ?? 0, perBand: p.perBand ?? 1 },
  magnitudeLabel: o.label ?? "", exemptFromPremium: !!o.exempt, setsFloor: !!o.floor,
  description: `<p>${desc}</p>`
});
function effectDoc(row) {
  return { name: row[0], type: "effect", img: "icons/svg/aura.svg", system: effectSystem(row) };
}
const EFFECT_REG = Object.fromEntries(EFFECTS.map(r => [r[1], { label: r[0], ...effectSystem(r) }]));

// ─── Requirement text → Instrument Type and Property slugs (PHB 4.2.0) ───────
// "Melee", "Kinetic or Incorporeal", "Guarding and Melee" (both, stored "guarding+melee"). "Innate": it comes with the character.
// "Kinetic for physical, Incorporeal for mental" reads as either.
const REQUIRE_KEYS = { melee: "melee", ranged: "ranged", arcane: "arcane", "any arcane": "arcane", sonic: "sonic", kinetic: "kinetic",
  incorporeal: "incorporeal", grappling: "grappling", guarding: "guarding", thrown: "thrown", drawn: "drawn", fired: "fired", tools: "tool", tool: "tool" };
function parseRequires(text) {
  const t = lc(text).replace(/\bkinetic for physical, incorporeal for mental\b/, "kinetic or incorporeal");
  if (/\binnate\b/.test(t)) return { requires: [], innate: true };
  // "None": learned like any Technique, used with no Instrument (Evade (None)).
  if (t === "none" || !t) return { requires: [], innate: false };
  const out = new Set();
  for (const alt of t.split(/\s*(?:,|\bor\b)\s*/).filter(Boolean)) {
    const parts = alt.split(/\s+and\s+/).map(x => REQUIRE_KEYS[x.trim()]);
    if (parts.every(Boolean)) out.add(parts.join("+"));
    else warnings.push(`Requirement term not recognized: "${alt}" in "${text}"`);
  }
  return { requires: [...out], innate: false };
}

// ─── Effect text → composed Effects ────────────────────────────────────────
// Pattern, Selective and Extend Range count rungs of the Range ladder: Range 1 = 1, 2 = 2, 4 = 3, 8 = 4, 20 = 5.
const BAND = { 1: 1, 2: 2, 4: 3, 8: 4, 20: 5 };
const CONDITION_KEYS = ["grappled", "prone", "restrained", "charmed", "frightened", "controlled", "intimidated",
  "baited", "angered", "relaxed", "impressed", "wary", "enthralled", "blinded", "slowed", "stunned", "invisible", "foil-exposed"];
const e = (key, extra = {}) => ({ key, magnitude: 1, pattern: "single", bands: 0, placement: 0, selectiveR: 0, ...extra });

/** Split on top-level commas (not inside parentheses). */
function splitTop(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/**
 * Decompose a catalog Effect line. Returns the Effects other than Stress, plus
 * whether the line deals Stress ("Stress"). Unparsed clauses are
 * returned for the report.
 */
function parseEffects(text) {
  const list = [], unparsed = [];
  let stress = false, quick = false, rider = false;
  let src = String(text ?? "").replace(/\.$/, "").replace(/\.\s*Strain \d+( per target)?$/i, "");
  const trig = src.match(/^Quick \(trigger:[^)]*\):\s*(.*)$/i);
  if (trig) { quick = true; src = trig[1]; }
  const tag = !trig && src.match(/^Quick:\s*(.*)$/i);
  if (tag) { quick = true; src = tag[1]; }
  if (/\+1 Stress\b/.test(src)) rider = true;
  const forAllies = /\ball(y|ies)\b/i.test(src);
  // "+1 and Resistance +1" is two Effects sharing one target clause.
  const clauses = splitTop(src).flatMap(c => /^\+\d+( \[Skill\])? and Resistance/i.test(c) ? c.split(/ and /) : [c]);
  for (const raw of clauses) {
    let c = raw.replace(/\.$/, "").trim();
    const sel = c.match(/(?:to )?chosen allies within Range (\d+) \(Selective\)/i);
    if (sel) {
      list.push(e("selective", { selectiveR: BAND[sel[1]] ?? 0 }));
      c = c.replace(sel[0], "").trim();
      if (!c) continue;
    }
    let m;
    if (/^Strain \d+( per target)?$/i.test(c)) continue;
    if (/^(deal Stress to that attacker|\+1 Stress|physical or mental|self or ally|reduced by your physical Resistance)$/i.test(c)) continue;
    if (/^Stress( through it)?$/i.test(c)) { stress = true; continue; }
    if (/^Upkeep$/i.test(c)) { list.push(e("upkeep")); continue; }
    if ((m = c.match(/^Pierce (\d+)$/i))) { list.push(e("pierce", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^-(\d+) \[target Attribute\]( \(1 minute\))?$/i))) { list.push(e(m[2] ? "weaken-minute" : "weaken", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^-(\d+) Oppose( \(1 minute\))?$/i))) { list.push(e(m[2] ? "reeling-minute" : "reeling", { magnitude: +m[1] })); continue; }
    // An ally's +N lasts 1 round; +N (this roll) is only the user's own roll.
    if ((m = c.match(/^\+(\d+)$/))) { list.push(e(forAllies ? "skill-mod" : "roll-bonus", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^(?:Gain )?\+(\d+)\b/i))) { list.push(e(/\(1 minute\)/.test(c) ? "skill-mod-minute" : "skill-mod", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^(?:Gain )?Resistance \+(\d+)/i))) { list.push(e("resistance", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^Mend (\d+)d4/i))) { list.push(e("mend", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^Lingering (\d+)$/i))) { list.push(e("lingering", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^(Beam|Cone|Radius|Wall) \(Range (\d+)\)$/i))) { list.push(e("pattern", { pattern: lc(m[1]), bands: BAND[m[2]] ?? 0 })); continue; }
    if (/^Extend Range$/i.test(c)) { list.push(e("extend-range", { bands: 1 })); continue; }
    if (/^Move (the|each) target up to Range 2$/i.test(c)) { list.push(e("move")); continue; }
    if (/^Hasten \(Action\)/i.test(c)) { list.push(e("hasten-action")); if (/\band \+1( \[Skill\])?$/.test(c)) list.push(e("skill-mod")); continue; }
    if (/^Hasten \(Quick Action\)/i.test(c)) { list.push(e("hasten-quick")); continue; }
    if ((m = c.match(/^Remove (\w+)$/i)) && CONDITION_KEYS.includes(lc(m[1]))) { list.push(e("remove-condition", { magnitude: EFFECTS.find(x => x[1] === lc(m[1]))?.[3]?.base ?? 0 })); continue; }
    if ((m = c.match(/^(Evade|Illusion|Drain|Counter|Redirect|Disarm)\b/i))) { list.push(e(lc(m[1]))); continue; }
    if ((m = c.match(/^(\w+)(?: \(.*\))?$/)) && CONDITION_KEYS.includes(lc(m[1]))) { list.push(e(lc(m[1]))); continue; }
    if (/^Redirect that Stress/i.test(c)) { list.push(e("redirect")); continue; }
    if (/^use a Melee Technique against that attacker/i.test(c)) continue;
    unparsed.push(c);
  }
  if (rider) list.push(e("stress-rider"));
  if (quick) list.push(e("quick", tag ? { untriggered: true } : {}));
  return { list, stress, unparsed };
}

// Movement a Transformation gives (PHB 7.3.0), sustained by Upkeep. No Effect in the table
// prices the capability itself, so Upkeep is their one Effect and their line is their text.
const MOVEMENT_TRAITS = new Set(["Fly", "Swim", "Burrow", "Climb"]);
// Quick-trigger rows where the 8 XP floor hides whether Stress is implied:
// composed by hand so Stress is never guessed.
/**
 * The Technique a Feat's grants_technique links to, by its note's name. A wikilink names the note's file, which keeps its old name
 * after a rename ([[Trip]] is Catalog/Techniques/Trip.md, named Toppling Strike), and a retired note leads to the one it merged into.
 * A link to no note is the name itself: a Technique only that Feat grants.
 */
function linkedTechnique(link) {
  const target = String(link ?? "").replace(/^\[\[|\]\]$/g, "").split("|")[0].trim();
  if (!target) return "";
  const note = CAT.techniques.find(t => String(t._file ?? "").replace(/\.md$/, "") === target);
  return note ? (note.retired && note.merged_into ? note.merged_into : note.name) : target;
}

// Each retired Technique note's name, under the note it merged into (merged_into), so the survivor lists it among its former names.
const MERGED_INTO = {};
for (const n of CAT.techniques) if (n.retired && n.merged_into) (MERGED_INTO[n.merged_into] ??= []).push(n.former_name ?? n.name);

// Keyed by the name the row had before the generic names (2026-11-02); a renamed note is found by its former_name.
const HAND_EFFECTS = {
  Riposte: () => [e("quick")],
  Intercept: () => [e("redirect"), e("quick")],
  Retort: () => [e("stress"), e("stress-rider"), e("quick")],
  Cleave: () => [e("stress"), e("quick")],
  "Warning Lash": () => [e("stress"), e("quick")],
  "River Walk": () => [e("evade")],
  Charge: () => [e("prone"), e("reeling", { magnitude: 2 })],
  "Quill Bristle": () => [e("stress"), e("quick")]
};
const TECH_RANGE = { Charge: { minRange: "short" } };
const priceFails = [];

function techniqueDoc(n) {
  const { requires, innate } = parseRequires(n.requires);
  const { list, stress, unparsed } = parseEffects(n.effect);
  let xp = n.xp == null ? null : Number(n.xp) || 0;
  // PHB 4.2.1's floor: aimed only at allies or its user, a ward or bonus for 1 round or longer, or a stated trigger.
  const floor = /\b(ally|allies|self)\b|for 1 round|\(self, 1 round\)|Quick \(trigger/i.test(n.effect ?? "");
  // A Sonic one with a Condition pays 8 XP for its reach, an Origin's excepted (PHB 4.2.4).
  const sonic = !n.origin_grant && requires.length > 0 && requires.every(r => r.split("+").includes("sonic"));
  const priced = effects => priceTechnique(effects, EFFECT_REG, { floor, sonic });
  const price = effects => priced(effects).xp;
  const perTarget = list.some(x => x.key === "selective");

  // A Technique deals Stress only when its line says so (PHB 4.2.1).
  let effects;
  if (MOVEMENT_TRAITS.has(n.name)) { effects = [e("upkeep")]; unparsed.length = 0; }
  else if (HAND_EFFECTS[n.name] ?? HAND_EFFECTS[n.former_name]) { effects = (HAND_EFFECTS[n.name] ?? HAND_EFFECTS[n.former_name])(); unparsed.length = 0; }
  else effects = stress ? [e("stress"), ...list] : list;

  // PHB 4.2.5: only an Action Technique can have Upkeep.
  if (/^Upkeep$/im.test(splitTop(n.effect ?? "").join("\n")) && /\bQuick\b/.test(n.effect ?? "")) priceFails.push(`${n.name}: Upkeep needs an Action Technique (PHB 4.2.5)`);
  const computed = price(effects);
  if (xp === null) xp = computed;
  if (effects.length && (computed !== xp || unparsed.length)) {
    priceFails.push(`${n.name}: printed ${xp}, Effects price ${computed}  [${n.effect}]${unparsed.length ? `  unparsed: ${unparsed.join(" | ")}` : ""}`);
  }
  // Strain comes from the XP less the Selective premium and the Sonic reach (PHB 4.2.3).
  const charges = (perTarget ? 8 : 0) + (effects.length && priced(effects).reach ? 8 : 0);
  if (n.strain !== undefined && n.strain !== null && Number(n.strain) !== strainFor(xp - charges)) {
    warnings.push(`${n.name}: printed Strain ${n.strain}, floor((${xp - charges}-${STRAIN_FREE_XP})/8) = ${strainFor(xp - charges)}`);
  }
  const skillMatch = String(n.requires ?? "").match(/\b(Prowess|Discipline|Assertiveness|Acuity|Guile|Resonance)\b/);
  return {
    name: n.name, type: "technique", img: "icons/svg/aura.svg",
    // A renamed Catalog note keeps the ID its former name hashed to, so links to it survive the rename (writePack).
    ...(n.former_name ? { idName: n.former_name } : {}),
    system: {
      requires, innate,
      skill: skillMatch ? lc(skillMatch[1]) : "",
      family: n.family ?? "", subgroup: n.subgroup ?? "",
      effects, floor, ...(TECH_RANGE[n.name] ?? {}),
      // The names it had before the generic names, and the retired notes merged into it (2026-11-02): a stored sheet's Technique
      // finds its new self by these, and both halves of a split name the one they came from.
      formerNames: [...new Set([n.former_name, ...(MERGED_INTO[n.name] ?? [])].filter(x => x && x !== n.name))],
      ancestryGrant: n.origin_grant ?? "",
      // The Transformation that gives it with its innate Instrument (PHB 7.3.0): it is not bought.
      grantedBy: n.granted_by ?? "",
      // The line as the PHB prints it, kept for the sheet (user, 2026-10-27).
      effectText: n.effect ?? "",
      description: n.description ? `<p>${n.description}</p>` : ""
    }
  };
}

// `--price "<Effect line>" [--requires "<Requirement>"]` prints what the Effects table charges for one line, then exits.
// Creature Techniques outside the Catalog are priced this way, never by hand.
if (process.argv.includes("--price")) {
  const arg = k => process.argv[process.argv.indexOf(k) + 1];
  for (const line of arg("--price").split("||")) {
    const effect = line.trim();
    const doc = techniqueDoc({ name: "(priced)", requires: process.argv.includes("--requires") ? arg("--requires") : "", effect, xp: null });
    const req = doc.system.requires;
    const priced = priceTechnique(doc.system.effects, EFFECT_REG, { floor: doc.system.floor, sonic: req.length > 0 && req.every(r => r.split("+").includes("sonic")) });
    const bad = priceFails.pop();
    console.log(`${priced.xp} XP, Strain ${priced.strain}  [${effect}]${bad && /unparsed/.test(bad) ? "  UNPARSED" + bad.split("unparsed")[1] : ""}`);
  }
  process.exit(0);
}

// ─── Instruments (Catalog notes, PHB 7.4.x, 7.7.0, 2.5.3) ──────────────────
const SIZE_TABLE = tableAfter(PHB, /^### 5\.3\.2 Crafting/);
const sizeOf = {}, materialsOf = {};
for (const row of SIZE_TABLE) {
  for (const item of row.Items.split(",").map(s => s.trim())) {
    sizeOf[lc(item)] = lc(row.Size);
    materialsOf[lc(item)] = row.Batches;
  }
}
const WEIGHT_WORDS = { light: "light", medium: "medium", heavy: "heavy" };
function typeSlug(t) {
  const craft = t.match(/^(?:Craft|Tools) \[(\w+)\]$/i);
  if (craft) return `craft-${slug(craft[1])}`;
  if (/^tools?$/i.test(t)) return "tool";
  return slug(t);
}

/** "**Strike** (Prowess): Deals Stress to Might or Finesse." segments, as built-in Techniques. */
function builtinsFrom(text) {
  return [...String(text).matchAll(/\*\*(.+?)\*\* \((\w+)\): (.+?)(?=(?:,? and )?\*\*|<br>|$)/g)]
    .map(m => {
      // Its effect is its sentences up to "Signature.", "X is its signature." or the backing, which are about the row as a whole.
      const parts = m[3].replace(/,\s*$/, "").trim().split(/(?<=\.)\s+/);
      const end = parts.findIndex(t => /^(Signature\.|\w+ is its signature\.|It backs\b|Backs\b)/i.test(t));
      const first = parts.slice(0, end < 0 ? parts.length : Math.max(1, end)).join(" ");
      return { name: m[1], skill: lc(m[2]), effect: /[.!?]$/.test(first) ? first : `${first}.`, signature: /\bSignature\./i.test(m[3]) };
    });
}

function instrumentDoc(n) {
  const weight = lc(n.weight ?? (n.types ?? []).map(String).find(w => WEIGHT_WORDS[lc(w)]) ?? "light");
  const type = lc(n.category ?? "melee");
  const types = [type, ...(n.properties ?? []).map(String).map(typeSlug)];
  for (const t of types) if (!TYPE_KEYS.has(t)) warnings.push(`${n.name}: unknown Instrument Type or Property "${t}"`);
  const kit = (n.builtins ?? []).map(b => ({ name: b.name, skill: lc(b.skill), effect: b.effect, signature: b.name === n.signature }));
  const key = lc(n.name);
  return {
    name: n.name, type: "instrument", img: "icons/svg/sword.svg",
    system: {
      category: type, weight, primaryAttribute: lc(n.primary_attribute),
      range: n.range ?? "Range 1", maxRange: rangeBandOf(n.range ?? "Range 1"), ...(rangeMinOf(n.range) ? { minRange: rangeMinOf(n.range) } : {}), types, typesDisplay: "",
      price: Number(n.price) || 0, rider: n.rider ?? "", family: n.family ?? "", backs: n.backs ?? "", kit,
      innate: false, bonus: 0, size: sizeOf[key] ?? "medium", materials: materialsOf[key] ?? "",
      description: ""
    }
  };
}

// Shields (PHB 7.9.3): Melee and Guarding Instruments with Might Primary and Range 1 (PHB 5.2.4). Their built-ins and backing are in
// the section's opening line, the signature marked "Signature." after it or named in "Push is its signature."; each row gives a weight,
// a bonus that applies while carried (PHB 5.2.4), and a price.
function shieldDocs() {
  const lines = PHB.split("\n");
  const at = lines.findIndex(l => /^### 7\.9\.3 Shields/.test(l));
  const intro = lines.slice(at + 1).find(l => /built-ins/i.test(l)) ?? "";
  const named = intro.match(/(\w+) is its signature/i)?.[1] ?? "";
  const kit = builtinsFrom(intro).map(k => ({ ...k, signature: k.signature || k.name === named }));
  if (!kit.some(k => k.signature)) warnings.push("7.9.3: no Shield signature found in the opening line");
  const backs = intro.match(/backs (\w+)/i)?.[1] ?? "";
  return tableAfter(PHB, /^### 7\.9\.3 Shields/).map(r => {
    const quals = [];
    const res = r.Bonus.match(/physical Resistance \+(\d)/i);
    if (res) quals.push(q("resistance", +res[1], "physical"));
    const sk = r.Bonus.match(/\+(\d) (\w+)/);
    if (sk && SKILLS.includes(lc(sk[2]))) quals.push(q("skill-bonus", +sk[1], lc(sk[2])));
    const weight = lc(r.Weight);
    return {
      name: r.Shield, type: "instrument", img: "icons/svg/shield.svg",
      system: {
        category: "shield", weight, primaryAttribute: "might", range: "Range 1", maxRange: "close", types: ["melee", "guarding"], typesDisplay: "",
        price: num(r.Price), rider: "", family: "Shields", backs, kit: kit.map(k => ({ ...k })), qualities: quals,
        innate: false, bonus: 0, size: weight === "medium" ? "large" : "medium", materials: materialsOf[lc(r.Shield)] ?? "", description: ""
      }
    };
  });
}

function toolDoc(n) {
  const types = String(n.instrument_type ?? "Tools").split(",").map(s => typeSlug(s.trim()));
  const key = lc(n.name);
  const craft = String(n.instrument_type ?? "").match(/(?:Craft|Tools) \[(\w+)\]/);
  return {
    name: n.name, type: "instrument", img: "icons/svg/pick.svg",
    system: {
      category: "tool", weight: "light", primaryAttribute: lc(n.primary_attribute), range: "Range 0",
      types, typesDisplay: n.instrument_type ?? "", price: Number(n.price) || 0, rider: "", kit: [],
      innate: false, bonus: 0, size: key === "smithing tools" ? "large" : "medium",
      materials: craft ? craft[1] : "Metal", description: ""
    }
  };
}

// Body, Voice, and Mind (PHB 2.5.3), the three innate Instruments every character starts with, read from the section's table. Voice's
// "Deals Stress to Wit or Presence, or applies Intimidated or Frightened." is three built-ins on one Skill, one for each choice.
function innateDocs() {
  return tableAfter(PHB, /^### 2\.5\.3 Innate Instruments/).map(r => {
    const words = r["Type and Properties"].split(",").map(w => w.trim()).filter(Boolean);
    const weight = lc(words.find(w => WEIGHT_WORDS[lc(w)]) ?? "light");
    const types = words.filter(w => !WEIGHT_WORDS[lc(w)]).map(typeSlug);
    for (const t of types) if (!TYPE_KEYS.has(t)) warnings.push(`${r.Instrument}: unknown Instrument Type or Property "${t}"`);
    const segs = r["Built-in Techniques"].split("<br>").map(x => x.trim()).filter(Boolean);
    const backs = segs.map(x => x.match(/^Backs Voice's (\w+)/i)?.[1]).find(Boolean) ?? "";
    const kit = builtinsFrom(segs.filter(x => x.startsWith("**")).join("<br>")).flatMap(({ name, skill, effect }) => {
      const m = effect.match(/^Deals Stress to ([^,]+), or applies (.+?) or (.+?)\.$/);
      return m ? [{ name, skill, effect: `Deals Stress to ${m[1]}.` }, { name, skill, effect: `Applies ${m[2]}.` }, { name, skill, effect: `Applies ${m[3]}.` }]
        : [{ name, skill, effect }];
    });
    return {
      name: r.Instrument, type: "instrument", img: { Body: "icons/svg/combat.svg", Voice: "icons/svg/sound.svg", Mind: "icons/svg/eye.svg" }[r.Instrument] ?? "icons/svg/combat.svg",
      system: {
        category: "innate", weight, primaryAttribute: lc(r.Primary), range: r.Range, maxRange: rangeBandOf(r.Range),
        types, typesDisplay: "", price: 0, rider: "Innate: every character has it, free (PHB 2.5.3).", family: "", backs,
        kit: kit.map(k => ({ ...k, signature: false })), innate: true, bonus: 0, size: "medium", materials: "", description: ""
      }
    };
  });
}

// ─── Equipment (PHB 7.9.x, 7.10.4) ───────────────────────────────────────────
const q = (key, value = 0, param = "") => ({ key, value, param });
const SKILLS = ["prowess", "discipline", "assertiveness", "acuity", "guile", "resonance"];
const EQUIP_IMG = { armor: "icons/svg/shield.svg", shield: "icons/svg/shield.svg", ward: "icons/svg/holy-shield.svg",
  charm: "icons/svg/holy-shield.svg", gear: "icons/svg/item-bag.svg" };
const equip = (name, category, price, o = {}) => ({
  name, type: "equipment", img: EQUIP_IMG[category] ?? "icons/svg/item-bag.svg",
  system: {
    category, price, weight: o.weight ?? 0, weightClass: o.weightClass ?? "", size: o.size ?? sizeOf[lc(name)] ?? "small",
    materials: o.materials ?? materialsOf[lc(name)] ?? "", location: "carried", qualities: o.qualities ?? [],
    effect: o.effect ?? "",
    tier: o.tier ?? 1, notes: o.notes ?? "", description: ""
  }
});

function equipmentDocs() {
  const out = [];
  for (const r of tableAfter(PHB, /^### 7\.9\.2 Armor/)) {
    out.push(equip(r.Armor, "armor", num(r.Price), {
      weight: num(r.Mass ?? r.Weight), size: "large", qualities: [q("resistance", num(r.Resistance), "physical")], notes: r.Notes ?? ""
    }));
  }
  // Wards and charms (PHB 5.2.4): one row per kind, a price per bonus. A Mental Ward covers
  // Wit and Presence; a Wit or Presence Ward covers that Attribute alone.
  // A charm leaves its Skill blank for the player to choose.
  for (const r of tableAfter(PHB, /^### 5\.2\.4 Armor, Shields, and Wards/)) {
    for (const n of [1, 2, 3, 4]) {
      const price = num(r[`+${n}`]);
      if (!price) continue;
      const base = { size: "small", materials: "Metal", notes: r.Gives, weight: num(r.Mass) };
      if (r.Item === "Mental Ward") out.push(equip(`Mental Ward +${n}`, "ward", price, { ...base, qualities: [q("resistance", n, "mental")] }));
      else if (/ Ward$/.test(r.Item)) for (const a of r.Item.replace(/ Ward$/, "").split(/,? or |, /))
        out.push(equip(`${a} Ward +${n}`, "ward", price, { ...base, qualities: [q("resistance", n, lc(a))] }));
      else if (r.Item === "Charm") out.push(equip("Charm", "charm", price, { ...base, qualities: [q("skill-bonus", n, "")] }));
      else warnings.push(`5.2.4: unknown row "${r.Item}"`);
    }
  }
  for (const r of tableAfter(PHB, /^### 7\.9\.4 Adventuring Gear/)) {
    out.push(equip(r.Item, "gear", num(r.Price), { effect: r["Helps with"], weight: num(r.Mass), size: "small", materials: "" }));
  }
  return out;
}

// ─── Consumables (PHB 7.9.5) ────────────────────────────────────────────────
// Their own item type (user, 2026-10-27). Poisons and throwables are Reagent; Medicine's Tier is in its name.
function consumableDocs() {
  return tableAfter(PHB, /^### 7\.9\.5 Consumables/).map(r => {
    const thrown = /thrown|coats a weapon/.test(r.Effect), heals = /Stress|poison or sickness/.test(r.Effect);
    const tier = Number(r.Item.match(/^Tier (\d) /)?.[1] ?? 0);
    return {
      name: r.Item, type: "consumable", img: thrown ? "icons/svg/pill.svg" : heals ? "icons/svg/heal.svg" : "icons/svg/item-bag.svg",
      system: { effect: r.Effect, duration: r.Duration, uses: r.Uses, quantity: 1, price: num(r.Price), weight: num(r.Mass), tier,
        materials: thrown ? "Reagent" : "", location: "carried", storedAt: "", notes: "", description: "" }
    };
  });
}

// ─── Materials (PHB 7.10.2) ─────────────────────────────────────────────────
// Their own item type (user, 2026-10-27): each example in the table is one Common batch of its category at its Tier.
const MATERIAL_IMG = {
  metal: "icons/commodities/metal/ingot-engraved-silver.webp", gemstone: "icons/commodities/gems/gem-faceted-asscher-blue.webp",
  stone: "icons/commodities/stone/masonry-block-cube-grey-teal.webp", wood: "icons/commodities/wood/log-cut-ash-brown.webp",
  textile: "icons/commodities/cloth/cloth-bolt-tan.webp", leather: "icons/commodities/leather/leather-bolt-brown.webp",
  reagent: "icons/commodities/flowers/buds-red-green.webp"
};
function materialDocs() {
  const rows = tableAfter(PHB, /^### 7\.10\.2 Example Materials/);
  return MATERIAL_CATEGORIES.flatMap(category => rows.map(r => ({
    name: r[MATERIAL_CATEGORY_LABEL[category]], type: "material", img: MATERIAL_IMG[category],
    system: { category, tier: Number(r.Tier), scarcity: "common", batches: 1, weight: 0, location: "carried", storedAt: "", notes: "", description: "" }
  })).filter(d => d.name));
}

// ─── Feats (Catalog notes, PHB 7.2.x, 7.5.x) ───────────────────────────────
// Flat, always-on grants become sheet modifiers; conditional Feats stay prose.
function featModifiers(effect) {
  const mods = [];
  let m;
  if ((m = effect.match(/^(?:Gain )?(Physical|Mental) Resistance \+(\d)/i))) mods.push({ type: "resistance", key: lc(m[1]), value: +m[2] });
  if ((m = effect.match(/^\+(\d) Training in (\w+)/i))) mods.push({ type: "training", key: lc(m[2]), value: +m[1] });
  if ((m = effect.match(/\+(\d+) to Initiative rolls/i)) || (m = effect.match(/^Add \+(\d+) to your Acuity roll for Initiative/i))) mods.push({ type: "initiative", key: "", value: +m[1] });
  if ((m = effect.match(/\+(\d+) on Stealth rolls/i))) mods.push({ type: "stealth", key: "", value: +m[1] });
  return mods;
}
function featDoc(n) {
  const type = lc(n.feat_type) === "origin" ? "ancestry" : lc(n.feat_type) === "trait" ? "trait" : "learned";
  const grants = linkedTechnique(n.grants_technique);
  const effect = n.effect ?? "";
  return {
    name: n.name, type: "feat", img: "icons/svg/upgrade.svg",
    system: {
      featType: type, xpCost: Number(n.xp) || 0, requirements: n.requires ?? "", effect,
      ancestry: n.origin ?? "", grantsTechnique: grants,
      modifiers: featModifiers(effect), description: ""
    }
  };
}

// ─── Origins (PHB 7.5.x) and Backgrounds (PHB 7.6.0) ────────────────────
function ancestryDocs() {
  const body = sectionText(PHB, /^## 7\.5\.0 Origins/);
  const out = [];
  for (const block of body.split(/\n(?=### 7\.5\.\d+ )/).slice(1)) {
    const head = block.match(/^### (7\.5\.\d+) (.+)$/m);
    const name = head[2].trim();
    const desc = (block.match(/^\*(.+)\*$/m) ?? [])[1] ?? "";
    const feats = [...block.matchAll(/^\*\*Feat:\*\* ([^.]+)\./gm)].map(m => m[1].trim());
    const featText = [...block.matchAll(/^\*\*Feat:\*\* ([^.]+)\.\s*(.*)$/gm)].map(m => ({ name: m[1].trim(), text: m[2].trim() }));
    const talentLine = (block.match(/^\*\*Talent:\*\* (.+)$/m)?.[1] ?? "").replace(/\.$/, "");
    const html = [desc ? `<p><em>${desc}</em></p>` : "",
      talentLine ? `<p><strong>Talent:</strong> ${talentLine}.</p>` : "",
      featText.length ? `<ul>${featText.map(f => `<li><strong>${f.name}.</strong> ${f.text}</li>`).join("")}</ul>` : ""].join("");
    const talent = [...(block.match(/^\*\*Talent:\*\* (.+)$/m)?.[1] ?? "").matchAll(/(?:one )?(\w+)(?: die)? to d(\d+)/g)]
      .map(m => ({ attribute: lc(m[1]), die: +m[2] }));
    out.push({ name, type: "origin", img: "icons/svg/village.svg",
      system: { talent, feats, feat: feats[0] ?? "", section: head[1], description: html } });
  }
  return out;
}

function backgroundDocs() {
  return tableAfter(PHB, /^## 7\.6\.0 Backgrounds/).map(r => {
    const training = Object.fromEntries(SKILLS.map(k => [k, 0]));
    for (const s of r.Skills.replace(/^\+1 Training in /, "").split(",").map(x => lc(x))) {
      if (s in training) training[s] = 1;
      else warnings.push(`${r.Background}: unknown Skill "${s}"`);
    }
    const knowHow = [];
    for (const m of r.Attribute.matchAll(/(\d)d4 (\w+)/g)) for (let i = 0; i < +m[1]; i++) knowHow.push(lc(m[2]));
    return { name: r.Background, type: "background", img: "icons/svg/book.svg",
      system: { training, knowHow, coin: r.Coin, equipmentKit: r.Equipment, description: `<p>${r.Description}</p>` } };
  });
}

// ─── Habit Tables (PHB 3.4.x) → src/habits.js, read by the Create app ────
const AXES = { Faith: ["faith", "Trusting", "Mistrusting"], Order: ["order", "Methodical", "Intuitive"],
  Individualism: ["individualism", "Individual", "Communal"], Levity: ["levity", "Light", "Grave"] };
function habitsModule() {
  const out = {};
  for (const [label, [key, high, low]] of Object.entries(AXES)) {
    const rows = tableAfter(PHB, new RegExp(`^### 3\\.4\\.\\d+ ${label}\\s*$`));
    out[key] = rows.map(r => {
      const lean = r.Lean === high ? "high" : r.Lean === low ? "low" : "neutral";
      return { roll: Number(r["1d8"]), habit: r.Habit, lean };
    });
    if (out[key].length !== 8) warnings.push(`Habit Table ${label}: ${out[key].length} rows, expected 8`);
  }
  return `/**\n * src/habits.js\n * Generated by tools/populate-packs.mjs from PHB 3.4.1-3.4.4. Do not edit by hand.\n */\n\nexport const HABIT_TABLES = ${JSON.stringify(out, null, 2)};\n`;
}

// ─── Writer ─────────────────────────────────────────────────────────────────
// Each pack's source is one JSON file per document under src/packs/<pack>/,
// in the shape the Foundry CLI extracts. IDs hash from the pack and the
// document's identity, so reseeding unchanged books changes no file.
// tools/build-packs.mjs compiles the source into packs/ (git-ignored).
const SRC_ROOT = path.join(SYSTEM_ROOT, "src", "packs");
const seen = new Map();
function stableId(...parts) {
  const base = crypto.createHash("sha256").update(parts.join("|")).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += ID_CHARS[base[i] % ID_CHARS.length];
  const n = (seen.get(id) ?? 0) + 1;
  seen.set(id, n);
  return n === 1 ? id : stableId(...parts, n);
}
const fileSlug = name => String(name).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

function writeSource(packName, docs) {
  const dir = path.join(SRC_ROOT, packName);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const doc of docs) fs.writeFileSync(path.join(dir, `${fileSlug(doc.name)}_${doc._id}.json`), JSON.stringify(doc, null, 2) + "\n");
}

function writeGuidePack(packName, journals) {
  const docs = journals.map((j, ji) => {
    const jid = stableId(packName, "journal", j.name);
    return {
      _id: jid, name: j.name, folder: null, sort: (ji + 1) * 100000,
      ownership: { default: 2 }, flags: {},
      pages: j.pages.map((pg, pi) => {
        const pid = stableId(packName, "page", j.name, pg.name);
        return {
          _id: pid, name: pg.name, type: "text", title: { show: true, level: 1 },
          text: { format: 1, content: pg.html.trim(), markdown: "" },
          image: {}, video: { controls: true, volume: 0.5 }, src: null,
          system: {}, sort: (pi + 1) * 100000, ownership: { default: -1 }, flags: {},
          _key: `!journal.pages!${jid}.${pid}`
        };
      }),
      _key: `!journal!${jid}`
    };
  });
  writeSource(packName, docs);
  console.log(`  ${packName}: ${docs.length} journals / ${docs.reduce((n, d) => n + d.pages.length, 0)} pages.`);
}

/** The Bestiary: creature actors with their items embedded, one folder per tier. */
function writeActorPack(packName, actors) {
  const folders = folderDocs(packName, actors.map(a => [`Tier ${a.tier}`]), "Actor");
  const out = actors.map(({ tier, items, ...doc }, i) => {
    const _id = stableId(packName, "actor", doc.name);
    return {
      _id, ...doc, folder: folders.get(`Tier ${tier}`)._id, sort: (i + 1) * 100000, ownership: { default: 0 }, flags: {}, effects: [],
      prototypeToken: { name: doc.name, actorLink: false, disposition: -1 },
      items: items.map((it, k) => {
        const iid = stableId(packName, "item", doc.name, it.type, it.name, k);
        return { _id: iid, ...it, effects: [], folder: null, sort: (k + 1) * 100000, ownership: { default: 0 }, flags: {}, _key: `!actors.items!${_id}.${iid}` };
      }),
      _key: `!actors!${_id}`
    };
  });
  writeSource(packName, [...folders.values(), ...out]);
  console.log(`  ${packName}: ${out.length} creatures in ${folders.size} folders.`);
}

/** Folder docs for a pack: one per distinct path in `paths`, nested by path segment. */
function folderDocs(packName, paths, type = "Item") {
  const folders = new Map();
  for (const segs of paths) {
    for (let i = 1; i <= segs.length; i++) {
      const key = segs.slice(0, i).join("/");
      if (folders.has(key)) continue;
      const _id = stableId(packName, "folder", key);
      const parent = i > 1 ? folders.get(segs.slice(0, i - 1).join("/"))._id : null;
      folders.set(key, { _id, name: segs[i - 1], type, folder: parent, sort: (folders.size + 1) * 100000,
        color: null, description: "", flags: {}, _key: `!folders!${_id}` });
    }
  }
  return folders;
}

function writePack(packName, docs, folderOf = null) {
  const paths = folderOf ? docs.map(d => folderOf(d).filter(Boolean)) : docs.map(() => []);
  const folders = folderDocs(packName, paths.filter(p => p.length));
  const out = docs.map(({ idName, ...doc }, i) => {
    const _id = stableId(packName, doc.type, idName ?? doc.name, doc.system?.ancestry ?? "");
    const folder = paths[i].length ? folders.get(paths[i].join("/"))._id : null;
    return { _id, ...doc, effects: [], folder, sort: (i + 1) * 100000, ownership: { default: 0 }, flags: {}, _key: `!items!${_id}` };
  });
  writeSource(packName, [...folders.values(), ...out]);
  console.log(`  ${packName}: ${out.length} items${folders.size ? ` in ${folders.size} folders` : ""}.`);
}

const capital = str => String(str ?? "").replace(/^./, c => c.toUpperCase());
const FOLDERS = {
  techniques: d => [d.system.family || (d.system.innate ? "Innate" : "Other"), d.system.subgroup],
  feats: d => d.system.featType === "ancestry" ? ["Origin", d.system.ancestry] : [capital(d.system.featType)],
  instruments: d => [d.system.innate ? "Innate" : d.system.category === "tool" ? "Tools" : d.system.category === "shield" ? "Shields" : capital(d.system.category)],
  equipment: d => [EQUIPMENT_CATEGORY_LABEL[d.system.category] ?? capital(d.system.category)],
  materials: d => [MATERIAL_CATEGORY_LABEL[d.system.category]]
};

// ─── Build and check ────────────────────────────────────────────────────────
const byOrder = (a, b) => String(a.family ?? a.category ?? "").localeCompare(String(b.family ?? b.category ?? ""))
  || (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name));

const ancestries = ancestryDocs();
// A Technique only an Origin Feat grants is defined by that Feat's text and has no Catalog note.
const grantedTechniques = CAT.feats.flatMap(f => {
  const name = linkedTechnique(f.grants_technique);
  if (!name || CAT.techniques.some(t => t.name === name)) return [];
  const m = String(f.effect).match(/^You learn the (.+?) Technique(?: \((\w+)\)[.:]|: (\w+),) ?(.*)$/);
  if (!m) { warnings.push(`${f.name}: cannot read the Technique it grants from "${f.effect}"`); return []; }
  const [effect, ...rest] = m[4].split(/\.\s+/);
  return [{ name, requires: m[2] ?? m[3], effect, description: rest.join(". ").replace(/\.$/, "") + (rest.length ? "." : ""), origin_grant: f.origin, xp: null }];
});
// A Technique only a Transformation gives is defined by its row (PHB 7.3.0) and has no Catalog note; its line is its text.
// One that comes with the row's new innate Instrument ("..., and the Lash Technique (Innate): Stress through it.") goes through that
// Instrument: it needs the Arcane Property the row gives it (Mind lash Incorporeal, Breath weapon Kinetic).
const transformationTechniques = tableAfter(PHB, /^## 7\.3\.0 Transformations/).flatMap(r => {
  const gives = String(r.Gives ?? "");
  const m = gives.match(/^The (.+?) Technique \(Innate\)\.\s*(.*)$/);
  if (m) return CAT.techniques.some(t => t.name === m[1]) ? [] : [{ name: m[1], requires: "Innate", effect: m[2].replace(/\.$/, ""), description: m[2].replace(/\.?$/, "."), xp: null }];
  const w = gives.match(/the (\w+) Technique \(Innate\): (.+?)\.?$/);
  if (!w || CAT.techniques.some(t => t.name === w[1])) return [];
  const through = ["Incorporeal", "Kinetic", "Sonic", "Melee", "Ranged"].find(k => new RegExp(`\\b${k}\\b`).test(gives.slice(0, w.index))) ?? "";
  return [{ name: w[1], requires: through, effect: w[2], description: `${w[2]}. It comes with the ${r.Transformation} Transformation (PHB 7.3.0).`, xp: null, granted_by: r.Transformation }];
});
// A retired Catalog note (merged into another, or dropped) seeds nothing (Instrument Model, 2026-11-02).
const live = list => list.filter(n => !n.retired);
const techniques = [...live([...CAT.techniques]).sort(byOrder), ...grantedTechniques, ...transformationTechniques].map(techniqueDoc);
const instruments = [
  ...innateDocs(),
  ...live([...CAT.instruments]).sort(byOrder).map(instrumentDoc),
  ...shieldDocs(),
  ...[...CAT.tools].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(toolDoc)
];
const feats = [...CAT.feats].sort((a, b) =>
  String(a.feat_type).localeCompare(String(b.feat_type)) || String(a.ancestry ?? "").localeCompare(String(b.ancestry ?? ""))
  || (a.order ?? 0) - (b.order ?? 0)).map(featDoc);
const equipment = equipmentDocs();
const consumables = consumableDocs();
const materials = materialDocs();
const backgrounds = backgroundDocs();

// Every Background kit item should resolve to something in the packs.
const known = new Set([...instruments, ...equipment, ...consumables].map(d => lc(d.name)));
for (const bg of backgrounds) {
  for (const raw of bg.system.equipmentKit.replace(/\.$/, "").split(",").map(s => s.trim())) {
    const name = lc(raw);
    const bare = name.replace(/^50ft of rope$/, "rope (50ft)").replace(/\s+armor$/, "");
    if (!known.has(name) && !known.has(bare)) warnings.push(`${bg.name}: kit item "${raw}" not in any pack`);
  }
}
// Every Origin Feat named in 7.8.x should exist as a Feat.
const featNames = new Set(feats.map(f => f.name));
for (const a of ancestries) for (const f of a.system.feats) if (!featNames.has(f)) warnings.push(`${a.name}: Feat "${f}" not in the Catalog`);

const expect = { techniques: 118, feats: 57, instruments: 43, tools: 17 };
for (const [k, n] of Object.entries(expect)) {
  if (CAT[k].length !== n) warnings.push(`Catalog/${k}: ${CAT[k].length} notes, expected ${n}`);
}

// --keep-bestiary leaves the bestiary pack and src/creature-data.js as they are, while the creature notes wait for their own pass.
const keepBestiary = process.argv.includes("--keep-bestiary");
const bestiary = keepBestiary ? { actors: [], notes: [] } : bestiaryDocs({ instruments, techniques, feats, techniqueDoc });
for (const n of bestiary.notes) warnings.push(n);
console.log(`FOIL | Seeding packs from ${path.basename(process.env.FOIL_BOOKS ?? "the vault")} (system ${SYSTEM_VERSION})…`);
const habits = habitsModule();
if (!process.argv.includes("--dry-run")) fs.writeFileSync(path.join(SYSTEM_ROOT, "src", "habits.js"), habits);
if (process.argv.includes("--habits-only")) { console.log("  wrote src/habits.js"); process.exit(0); }
if (process.argv.includes("--dry-run")) {
  console.log(`  dry run: ${INSTRUMENT_TYPES.length} types, ${QUALITIES.length} qualities, ${EFFECTS.length} effects, `
    + `${instruments.length} instruments, ${techniques.length} techniques, ${feats.length} feats, ${equipment.length} equipment, ${consumables.length} consumables, ${materials.length} materials, `
    + `${backgrounds.length} backgrounds, ${ancestries.length} origins, ${bestiary.actors.length} creatures, ${GUIDE.length} guide journals`);
} else {
  writePack("instrument-types", INSTRUMENT_TYPES.map(instrumentTypeDoc));
  writePack("qualities", QUALITIES.map(qualityDoc));
  writePack("effects", EFFECTS.map(effectDoc));
  writePack("instruments", instruments, FOLDERS.instruments);
  writePack("techniques", techniques, FOLDERS.techniques);
  writePack("feats", feats, FOLDERS.feats);
  writePack("equipment", equipment, FOLDERS.equipment);
  writePack("consumables", consumables);
  writePack("materials", materials, FOLDERS.materials);
  writePack("backgrounds", backgrounds);
  writePack("ancestries", ancestries);
  writeGuidePack("guide", GUIDE);
  if (!keepBestiary) writeActorPack("bestiary", bestiary.actors);
  console.log(`  glossary: ${buildGlossary()} terms.`);
  if (!keepBestiary) console.log("  creature data:", JSON.stringify(buildCreatureData()));
  if (!process.argv.includes("--no-build")) await buildPacks();
}

if (priceFails.length) {
  console.log(`\nPRINTED XP THAT THE EFFECTS DON'T REPRODUCE (${priceFails.length}/${techniques.length}; computed price used):`);
  for (const m of priceFails) console.log("  " + m);
} else {
  console.log(`\nPricing: all ${techniques.length} Techniques reproduce their printed XP.`);
}
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log("  " + w);
}
console.log("FOIL | Done.");
