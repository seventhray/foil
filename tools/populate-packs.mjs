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
 * src/pricing.js. Its printed XP stays authoritative (xpOverride); rows whose
 * Effects don't add up to the printed XP are listed at the end.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { priceTechnique, strainFor } from "../src/pricing.js";
import { GUIDE } from "./guide-content.mjs";
import {
  SYSTEM_ROOT, SYSTEM_VERSION, readPHB, readCatalog, tableAfter, sectionText, setting
} from "./books.mjs";
import { buildPacks } from "./build-packs.mjs";



const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const slug = name => String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const lc = s => String(s ?? "").trim().toLowerCase();
const num = s => Number(String(s ?? "").replace(/[^0-9.-]/g, "")) || 0;

const PHB = readPHB();
const CAT = readCatalog();
const warnings = [];

// ─── Vocabulary: Instrument Types (PHB 4.1.1) ───────────────────────────────
// [name, key, family, {stressPhysical, stressMental, pierce, flags...}, description]
const CRAFT_MATERIALS = ["Metal", "Wood", "Leather", "Gemstone", "Textile", "Reagent", "Stone"];
const INSTRUMENT_TYPES = [
  ["Quick", "quick", "other", { quick: true }, "Creatures only (GMG 4.6.0): this natural weapon's built-in Techniques may be used as a Quick Action. A Light Instrument already can (PHB 4.1.1)."],
  ["Edged", "edged", "melee", { stressPhysical: 3, doubleResistance: true }, "+3 Stress against a physical Attribute. Physical Resistance, after Pierce, counts double against it."],
  ["Pointed", "pointed", "melee", { stressPhysical: 1, pierce: 1 }, "Pierce 1 against physical Resistance. +1 Stress against a physical Attribute."],
  ["Blunt", "blunt", "melee", { pierce: 3 }, "Pierce 3 against physical Resistance."],
  ["Thrown", "thrown", "ranged", {}, "No type effect. No reload."],
  ["Drawn", "drawn", "ranged", { stressPhysical: 2, stressMental: 2, reload: "quick" }, "+2 Stress. Reload: Quick Action."],
  ["Fired", "fired", "ranged", { stressPhysical: 4, stressMental: 4, reload: "action" }, "+4 Stress. Reload: Action."],
  ["Kinetic", "kinetic", "arcane", { stressPhysical: 1, stressMental: -1 }, "+1 Stress against a physical Attribute. -1 against a mental Attribute."],
  ["Incorporeal", "incorporeal", "arcane", { stressPhysical: -1, stressMental: 1 }, "+1 Stress against a mental Attribute. -1 against a physical Attribute."],
  ["Sonic", "sonic", "sonic", { stressPhysical: -1, stressMental: 1 }, "+1 Stress against a mental Attribute. -1 against a physical Attribute."],
  ["Fortifying", "fortifying", "arcane", {}, "Support, aimed at an ally or the caster."],
  ["Grappling", "grappling", "melee", { dealsNoStress: true }, "Adds no Stress."],
  ["Parry", "parry", "melee", {}, "Spend the Quick Action reactively for physical Resistance +1 against a Melee or Ranged Technique (PHB 6.5.2)."],
  ["Blocking", "blocking", "other", { blocking: true }, "+N applies to Oppose rolls. Guard with the Quick Action (PHB 6.5.1)."],
  ["Immobile", "immobile", "other", { stressPhysical: 2, stressMental: 2 }, "+2 Stress. Fixed at a location; using it means being there."],
  ["Tool", "tool", "other", { isTool: true }, "A Trade roll against a Difficulty (PHB 4.2.6)."],
  ["Craft", "craft", "other", { isTool: true }, "A Trade roll for general work in no single Material."],
  ...CRAFT_MATERIALS.map(m => [`Craft [${m}]`, `craft-${slug(m)}`, "other", { isTool: true }, `A Craft Trade roll working ${m}.`])
];
const TYPE_KEYS = new Set(INSTRUMENT_TYPES.map(t => t[1]));
function instrumentTypeDoc([name, key, family, o, desc]) {
  return { name, type: "instrumentType", img: "icons/svg/upgrade.svg",
    system: {
      key, family,
      stressPhysical: o.stressPhysical ?? 0, stressMental: o.stressMental ?? 0, pierce: o.pierce ?? 0,
      doubleResistance: !!o.doubleResistance, dealsNoStress: !!o.dealsNoStress,
      quick: !!o.quick, blocking: !!o.blocking, reload: o.reload ?? "", isTool: !!o.isTool,
      description: `<p>${desc}</p>`
    } };
}

// ─── Vocabulary: Qualities (PHB 7.5.1, Fundamental Math Passive Properties) ─
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
const MELEE = ["edged", "pointed", "blunt", "grappling", "parry"];
const RANGED = ["thrown", "drawn", "fired"];
const ARCANE = ["kinetic", "incorporeal", "fortifying"];
// [name, key, pricingKind, {base, perPoint, perBand}, {requires, label, exempt, floor}, description]
const EFFECTS = [
  ["Stress", "stress", "flat", { base: 4 }, {}, "Deal the margin to an Attribute of the Target."],
  ["+1 Stress (hit-count rider)", "stress-rider", "flat", { base: 8 }, {}, "+1 Stress on a landed hit."],
  ["+N [Skill or Oppose]", "skill-mod", "perPoint", { perPoint: 3 }, { label: "+N", floor: true }, "+N to a named Skill's rolls for 1 round."],
  ["+N [Skill or Oppose] (1 minute)", "skill-mod-minute", "perPoint", { perPoint: 6 }, { label: "+N", floor: true }, "+N to a named Skill's rolls for 1 minute."],
  ["-N [Oppose]", "reeling", "perPoint", { perPoint: 4 }, { label: "-N Oppose" }, "Reeling: the target's Oppose rolls take -N for 1 round (PHB 6.8.6)."],
  ["-N [Oppose] (1 minute)", "reeling-minute", "perPoint", { perPoint: 16 }, { label: "-N Oppose" }, "Reeling: the target's Oppose rolls take -N for 1 minute (PHB 6.8.6)."],
  ["-N [target Attribute]", "weaken", "perPoint", { perPoint: 6 }, { requires: ["incorporeal", "sonic", "kinetic", ...MELEE, ...RANGED], label: "-N [target Attribute]" }, "Weakened: the named Attribute's rolls take -N for 1 round (PHB 6.8.4)."],
  ["-N [target Attribute] (1 minute)", "weaken-minute", "perPoint", { perPoint: 24 }, { requires: ["incorporeal", "sonic", "kinetic", ...MELEE, ...RANGED], label: "-N [target Attribute]" }, "Weakened: the named Attribute's rolls take -N for 1 minute (PHB 6.8.4)."],
  ["+N (this roll)", "roll-bonus", "perPoint", { perPoint: 2 }, { label: "+N" }, "+N to this Technique's own roll."],
  ["Pierce N", "pierce", "perPoint", { perPoint: 4 }, { requires: [...MELEE, ...RANGED, "kinetic"], label: "Pierce N" }, "Ignore N of the target's Resistance."],
  ["Resistance +N", "resistance", "perPoint", { perPoint: 4 }, { requires: ["parry", "blocking", "fortifying"], label: "Resistance +N" }, "Physical or mental Resistance +N."],
  ["Mend Xd4", "mend", "perPoint", { perPoint: 10 }, { requires: ["fortifying", "sonic"], label: "Mend Nd4" }, "Remove Xd4 Stress from one of an ally's Attributes in ten minutes, with no Medicine and no roll. Medicine or Mend once every 4 hours per creature (PHB 6.10.0)."],
  ["Lingering N", "lingering", "perPoint", { perPoint: 7 }, { requires: ["kinetic", "incorporeal", "pointed", "edged"], label: "Lingering N" }, "N more Stress at the start of the target's next turns."],
  ["Redirect", "redirect", "flat", { base: 8 }, { requires: ["blocking"] }, "Take an ally's incoming Stress instead."],
  ["Move", "move", "flat", { base: 4 }, { requires: ["grappling", "blunt", "kinetic", "incorporeal"] }, "Move the target one band."],
  ["Disarm", "disarm", "flat", { base: 8 }, { requires: [...MELEE, "kinetic"] }, "The target drops the Instrument it used last. Innate Instruments can't be dropped."],
  ["Evade", "evade", "flat", { base: 4 }, { requires: ["kinetic", "incorporeal"] }, "Move without provoking."],
  ["Illusion", "illusion", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "A false sight or sound."],
  ["Drain", "drain", "flat", { base: 8 }, { requires: ["incorporeal"] }, "Heal what the Technique deals."],
  ["Counter", "counter", "flat", { base: 12 }, {}, "Contest another Technique as it lands, minus its Strain. A countered upkeep ends the Technique."],
  ["Hasten (Action)", "hasten-action", "flat", { base: 14 }, { requires: ["fortifying"] }, "Grant an ally an extra Action."],
  ["Hasten (Quick Action)", "hasten-quick", "flat", { base: 11 }, { requires: ["fortifying"] }, "Grant an ally an extra Quick Action."],
  ["Extend Range", "extend-range", "extendRange", { perBand: 1 }, { requires: ["kinetic", "incorporeal"] }, "1 XP per band of extra reach."],
  ["Pattern", "pattern", "pattern", {}, { requires: [...MELEE, ...RANGED, "sonic", ...ARCANE] }, "Beam or Wall: 1 + 2 + ... per band. Cone 3x, Radius 12x the Beam cost. A Melee Pattern reaches no farther than its Instrument's Range."],
  ["Selective", "selective", "selective", {}, { requires: [...RANGED, "sonic", ...ARCANE] }, "Creatures within R bands: range at 1 XP per band, plus an 8 XP premium; Strain is paid per target."],
  ["Upkeep", "upkeep", "upkeep", { base: 4 }, { requires: ARCANE, exempt: true }, "Keep the Technique active by paying its Action and Strain each turn."],
  ["Quick", "quick", "quick", { base: 3 }, { exempt: true, floor: true }, "3 XP, outside the combination premium. A stated trigger sets the 8 XP floor."],
  // Conditions (PHB 6.8.x), priced flat.
  ["Grappled", "grappled", "flat", { base: 4 }, { requires: ["grappling", "kinetic"] }, "PHB 6.8.3."],
  ["Prone", "prone", "flat", { base: 11 }, { requires: [...MELEE, ...RANGED, "kinetic"] }, "PHB 6.8.7."],
  ["Restrained", "restrained", "flat", { base: 16 }, { requires: ["grappling", "kinetic"] }, "PHB 6.8.5."],
  ["Charmed", "charmed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.8."],
  ["Frightened", "frightened", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.9."],
  ["Controlled", "controlled", "flat", { base: 25 }, { requires: ["incorporeal"] }, "PHB 6.8.10."],
  ["Intimidated", "intimidated", "flat", { base: 10 }, { requires: ["incorporeal", "sonic", ...MELEE] }, "PHB 6.8.11."],
  ["Baited", "baited", "flat", { base: 8 }, { requires: ["incorporeal", "sonic", ...MELEE, ...RANGED] }, "PHB 6.8.12."],
  ["Angered", "angered", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.13."],
  ["Relaxed", "relaxed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.14."],
  ["Impressed", "impressed", "flat", { base: 10 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.15."],
  ["Wary", "wary", "flat", { base: 8 }, { requires: ["sonic", "fortifying"] }, "PHB 6.8.16."],
  ["Enthralled", "enthralled", "flat", { base: 20 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.17."],
  ["Blinded", "blinded", "flat", { base: 16 }, { requires: [...MELEE, ...RANGED, "kinetic", "incorporeal"] }, "PHB 6.8.20."],
  ["Slowed", "slowed", "flat", { base: 4 }, { requires: [...MELEE, ...RANGED, "kinetic", "incorporeal"] }, "PHB 6.8.21."],
  ["Stunned", "stunned", "flat", { base: 24 }, { requires: ["blunt", "kinetic", "incorporeal", "sonic"] }, "PHB 6.8.22."],
  ["Invisible", "invisible", "flat", { base: 8 }, { requires: ["incorporeal", "fortifying"] }, "PHB 6.8.23."]
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

// ─── Requires text → Instrument Type slugs ─────────────────────────────────
const FAMILY_TYPES = {
  melee: MELEE, ranged: RANGED, arcane: ARCANE, "any arcane": ARCANE,
  sonic: ["sonic"], kinetic: ["kinetic"], incorporeal: ["incorporeal"], fortifying: ["fortifying"],
  edged: ["edged"], pointed: ["pointed"], blunt: ["blunt"], grappling: ["grappling"],
  parry: ["parry"], blocking: ["blocking"], thrown: ["thrown"], drawn: ["drawn"], fired: ["fired"]
};
function parseRequires(text) {
  const t = lc(text);
  if (/\binnate\b/.test(t)) return { requires: [], innate: true };
  // "Blocking AND any Arcane": the first term is the Instrument the Technique rolls through.
  const first = t.split(/\s+and\s+/)[0];
  const out = new Set();
  for (const part of first.split(/\s*(?:,|\bor\b)\s*/).filter(Boolean)) {
    const types = FAMILY_TYPES[part.trim()];
    if (types) types.forEach(k => out.add(k));
    else warnings.push(`Requires term not recognized: "${part}" in "${text}"`);
  }
  return { requires: [...out], innate: false };
}

// ─── Effect text → composed Effects ────────────────────────────────────────
const BAND = { close: 1, near: 2, short: 3, mid: 4, long: 5 };
const CONDITION_KEYS = ["grappled", "prone", "restrained", "charmed", "frightened", "controlled", "intimidated",
  "baited", "angered", "relaxed", "impressed", "wary", "enthralled", "blinded", "slowed", "stunned", "invisible"];
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
    const sel = c.match(/(?:to )?chosen allies within (\w+) \(Selective\)/i);
    if (sel) {
      list.push(e("selective", { selectiveR: BAND[lc(sel[1])] ?? 0 }));
      c = c.replace(sel[0], "").trim();
      if (!c) continue;
    }
    let m;
    if (/^Strain \d+( per target)?$/i.test(c)) continue;
    if (/^(deal Stress to that attacker|\+1 Stress|physical or mental|self or ally|reduced by your physical Resistance)$/i.test(c)) continue;
    if (/^Stress$/i.test(c)) { stress = true; continue; }
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
    if ((m = c.match(/^(Beam|Cone|Radius|Wall) \((\w+)\)$/i))) { list.push(e("pattern", { pattern: lc(m[1]), bands: BAND[lc(m[2])] ?? 0 })); continue; }
    if (/^Extend Range$/i.test(c)) { list.push(e("extend-range", { bands: 1 })); continue; }
    if (/^Move (the|each) target 1 band$/i.test(c)) { list.push(e("move")); continue; }
    if (/^Hasten \(Action\)/i.test(c)) { list.push(e("hasten-action")); if (/\band \+1( \[Skill\])?$/.test(c)) list.push(e("skill-mod")); continue; }
    if (/^Hasten \(Quick Action\)/i.test(c)) { list.push(e("hasten-quick")); continue; }
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

// New capabilities sustained by Upkeep (PHB 7.7.3). No Effect in the table
// prices the capability itself, so these carry their printed XP only.
const MOVEMENT_TRAITS = new Set(["Fly", "Swim", "Burrow", "Climb", "Incorporeal Movement"]);
// Quick-trigger rows where the 8 XP floor hides whether Stress is implied:
// composed by hand so Stress is never guessed.
const HAND_EFFECTS = {
  Riposte: () => [e("quick")],
  Intercept: () => [e("redirect"), e("quick")],
  Retort: () => [e("stress"), e("stress-rider"), e("quick")],
  "River Walk": () => [e("evade")]
};
const priceFails = [];

function techniqueDoc(n) {
  const { requires, innate } = parseRequires(n.requires);
  const { list, stress, unparsed } = parseEffects(n.effect);
  let xp = n.xp == null ? null : Number(n.xp) || 0;
  // PHB 4.2.1's floor: Fortifying, a ward or bonus for 1 round or longer, or a stated trigger.
  const floor = requires.includes("fortifying") || /for 1 round|\(self, 1 round\)|Quick \(trigger/i.test(n.effect ?? "");
  const price = effects => priceTechnique(effects, EFFECT_REG, { floor }).xp;
  const perTarget = list.some(x => x.key === "selective");

  // A Technique deals Stress only when its line says so (PHB 4.2.1).
  let effects;
  if (MOVEMENT_TRAITS.has(n.name)) { effects = []; unparsed.length = 0; }
  else if (HAND_EFFECTS[n.name]) { effects = HAND_EFFECTS[n.name](); unparsed.length = 0; }
  else effects = stress ? [e("stress"), ...list] : list;

  const computed = price(effects);
  if (xp === null) xp = computed;
  if (effects.length && (computed !== xp || unparsed.length)) {
    priceFails.push(`${n.name}: printed ${xp}, Effects price ${computed}  [${n.effect}]${unparsed.length ? `  unparsed: ${unparsed.join(" | ")}` : ""}`);
  }
  if (n.strain !== undefined && n.strain !== null && Number(n.strain) !== strainFor(xp - (perTarget ? 8 : 0))) {
    warnings.push(`${n.name}: printed Strain ${n.strain}, floor((${xp - (perTarget ? 8 : 0)}-24)/8) = ${strainFor(xp - (perTarget ? 8 : 0))}`);
  }
  const skillMatch = String(n.requires ?? "").match(/\b(Prowess|Discipline|Assertiveness|Acuity|Guile|Resonance)\b/);
  return {
    name: n.name, type: "technique", img: "icons/svg/aura.svg",
    system: {
      requires, requiresText: n.requires ?? "", innate,
      skill: skillMatch ? lc(skillMatch[1]) : "",
      family: n.family ?? "", subgroup: n.subgroup ?? "",
      effects, floor,
      xpOverride: xp,
      effectText: n.effect ?? "",
      ancestryGrant: n.origin_grant ?? "",
      description: n.description ? `<p>${n.description}</p>` : ""
    }
  };
}

// ─── Instruments (Catalog notes, PHB 7.2.x, 7.3.0, 2.5.3) ──────────────────
const SIZE_TABLE = tableAfter(PHB, /^### 5\.3\.2 Crafting/);
const sizeOf = {}, materialsOf = {};
for (const row of SIZE_TABLE) {
  for (const item of row.Items.split(",").map(s => s.trim())) {
    sizeOf[lc(item)] = lc(row.Size);
    materialsOf[lc(item)] = row.Materials;
  }
}
const WEIGHT_WORDS = { light: "light", medium: "medium", heavy: "heavy" };
function typeSlug(t) {
  const craft = t.match(/^Craft \[(\w+)\]$/i);
  if (craft) return `craft-${slug(craft[1])}`;
  return slug(t);
}

function instrumentDoc(n) {
  const words = (n.types ?? []).map(String);
  const weight = words.map(lc).find(w => WEIGHT_WORDS[w]) ?? "light";
  let types = words.filter(w => !WEIGHT_WORDS[lc(w)]).map(typeSlug);
  // A Wand holds one channel, picked when made; the seeded one is Kinetic.
  if (n.name === "Wand") types = ["quick", "kinetic"];
  for (const t of types) if (!TYPE_KEYS.has(t)) warnings.push(`${n.name}: unknown Instrument Type "${t}"`);
  const kit = [1, 2, 3].map(i => ({
    name: n[`kit_${i}_name`] ?? "", skill: lc(n[`kit_${i}_skill`] ?? "prowess"), effect: n[`kit_${i}_effect`] ?? ""
  })).filter(k => k.name);
  const key = lc(n.name);
  return {
    name: n.name, type: "instrument", img: "icons/svg/sword.svg",
    system: {
      category: lc(n.category ?? "melee"), weight, primaryAttribute: lc(n.primary_attribute),
      range: n.range ?? "Close", types, typesDisplay: n.name === "Wand" ? "" : (n.types_display ?? ""),
      price: Number(n.price) || 0, rider: n.rider ?? "", kit,
      innate: false, bonus: 0, size: sizeOf[key] ?? "medium", materials: materialsOf[key] ?? "",
      description: ""
    }
  };
}

function toolDoc(n) {
  const types = String(n.instrument_type ?? "Tool").split(",").map(s => typeSlug(s.trim()));
  const key = lc(n.name);
  const craft = String(n.instrument_type ?? "").match(/Craft \[(\w+)\]/);
  return {
    name: n.name, type: "instrument", img: "icons/svg/pick.svg",
    system: {
      category: "tool", weight: "light", primaryAttribute: lc(n.primary_attribute), range: "Touching",
      types, typesDisplay: n.instrument_type ?? "", price: Number(n.price) || 0, rider: "", kit: [],
      innate: false, bonus: 0, size: key === "smithing tools" ? "large" : "medium",
      materials: craft ? craft[1] : "Metal", description: ""
    }
  };
}

// Body and Voice (PHB 2.5.3), the two innate Instruments every character starts with.
const INNATE_INSTRUMENTS = [
  { name: "Body", primaryAttribute: "might", types: ["quick", "blunt", "grappling"], range: "Close",
    kit: [
      { name: "Strike", skill: "prowess", effect: "Deals Stress to Might or Finesse." },
      { name: "Grapple", skill: "discipline", effect: "Applies Grappled." },
      { name: "Menace", skill: "assertiveness", effect: "Deals Stress to Presence or Wit." }
    ] },
  { name: "Voice", primaryAttribute: "presence", types: ["quick", "sonic"], range: "Mid Range",
    kit: [
      { name: "Intimidate", skill: "assertiveness", effect: "Applies Intimidated." },
      { name: "Mislead", skill: "guile", effect: "Applies Misled." },
      { name: "Sway", skill: "resonance", effect: "Applies Swayed." }
    ] }
];
function innateDoc(i) {
  return {
    name: i.name, type: "instrument", img: i.name === "Body" ? "icons/svg/combat.svg" : "icons/svg/sound.svg",
    system: {
      category: "innate", weight: "light", primaryAttribute: i.primaryAttribute, range: i.range,
      types: i.types, typesDisplay: "", price: 0, rider: "Innate: every character has it, free (PHB 2.5.3).",
      kit: i.kit, innate: true, bonus: 0, size: "medium", materials: "", description: ""
    }
  };
}

// ─── Equipment (PHB 7.5.x, 7.4.4) ───────────────────────────────────────────
const q = (key, value = 0, param = "") => ({ key, value, param });
const SKILLS = ["prowess", "discipline", "assertiveness", "acuity", "guile", "resonance"];
const EQUIP_IMG = { armor: "icons/svg/shield.svg", shield: "icons/svg/shield.svg", ward: "icons/svg/holy-shield.svg",
  charm: "icons/svg/holy-shield.svg", gear: "icons/svg/item-bag.svg", medicine: "icons/svg/heal.svg",
  potion: "icons/svg/pill.svg", gem: "icons/svg/ice-aura.svg" };
const equip = (name, category, price, o = {}) => ({
  name, type: "equipment", img: EQUIP_IMG[category] ?? "icons/svg/item-bag.svg",
  system: {
    category, price, weight: o.weight ?? 0, weightClass: o.weightClass ?? "", size: o.size ?? sizeOf[lc(name)] ?? "small",
    materials: o.materials ?? materialsOf[lc(name)] ?? "", location: "carried", qualities: o.qualities ?? [],
    uses: o.uses ?? "", duration: o.duration ?? "", effect: o.effect ?? "",
    gemType: o.gemType ?? "", tier: o.tier ?? 1, notes: o.notes ?? "", description: ""
  }
});

function equipmentDocs() {
  const out = [];
  for (const r of tableAfter(PHB, /^### 7\.5\.2 Armor/)) {
    out.push(equip(r.Armor, "armor", num(r.Price), {
      weight: num(r.Weight), size: "large", qualities: [q("resistance", num(r.Resistance), "physical")], notes: r.Notes ?? ""
    }));
  }
  for (const r of tableAfter(PHB, /^### 7\.5\.3 Shields/)) {
    const quals = [];
    const res = r.Properties.match(/physical Resistance \+(\d)/i);
    if (res) quals.push(q("resistance", +res[1], "physical"));
    const sk = r.Properties.match(/\+(\d) (\w+)/);
    if (sk && SKILLS.includes(lc(sk[2]))) quals.push(q("skill-bonus", +sk[1], lc(sk[2])));
    out.push(equip(r.Shield, "shield", num(r.Price), {
      weightClass: lc(r.Weight), qualities: quals, effect: "Blocking", notes: r.Notes ?? ""
    }));
  }
  // Wards and charms (PHB 5.2.4): one row per kind, a price per bonus. A Mental Ward covers
  // Wit and Presence; a Wit or Presence Ward covers that Attribute alone.
  // A charm leaves its Skill blank for the player to choose.
  for (const r of tableAfter(PHB, /^### 5\.2\.4 Armor, Shields, and Wards/)) {
    for (const n of [1, 2, 3, 4]) {
      const price = num(r[`+${n}`]);
      if (!price) continue;
      const base = { size: "small", materials: "Metal", notes: r.Gives };
      if (r.Item === "Mental Ward") out.push(equip(`Mental Ward +${n}`, "ward", price, { ...base, qualities: [q("resistance", n, "mental")] }));
      else if (/ Ward$/.test(r.Item)) for (const a of r.Item.replace(/ Ward$/, "").split(/,? or |, /))
        out.push(equip(`${a} Ward +${n}`, "ward", price, { ...base, qualities: [q("resistance", n, lc(a))] }));
      else if (r.Item === "Charm") out.push(equip("Charm", "charm", price, { ...base, qualities: [q("skill-bonus", n, "")] }));
      else warnings.push(`5.2.4: unknown row "${r.Item}"`);
    }
  }
  for (const r of tableAfter(PHB, /^### 7\.5\.4 Adventuring Gear/)) {
    out.push(equip(r.Item, "gear", num(r.Price), { effect: r["Helps with"], size: "small", materials: "" }));
  }
  // Consumables (PHB 7.5.5): poisons and throwables are Reagent; medicine heals; the rest is gear.
  for (const r of tableAfter(PHB, /^### 7\.5\.5 Consumables/)) {
    const category = /thrown|coats a weapon/.test(r.Effect) ? "potion"
                   : /Stress|poison or sickness/.test(r.Effect) ? "medicine" : "gear";
    out.push(equip(r.Item, category, num(r.Price), {
      effect: r.Effect, duration: r.Duration, uses: r.Uses, size: "small", materials: category === "potion" ? "Reagent" : ""
    }));
  }
  for (const r of tableAfter(PHB, /^### 7\.4\.4 Focus Gems/)) {
    out.push(equip(`${r.Gem} (Tier 1)`, "gem", num(r["Price per Tier"]), {
      gemType: lc(r.Gem), tier: 1, size: "small", materials: "Gemstone",
      effect: `${r["Damage Type"] === "None" ? "" : r["Damage Type"] + "; "}${r["Adds, per Tier"]} per Tier`
    }));
  }
  return out;
}

// ─── Feats (Catalog notes, PHB 7.7.x, 7.8.x) ───────────────────────────────
// Flat, always-on grants become sheet modifiers; conditional Feats stay prose.
function featModifiers(effect) {
  const mods = [];
  let m;
  if ((m = effect.match(/^(?:Gain )?(Physical|Mental) Resistance \+(\d)/i))) mods.push({ type: "resistance", key: lc(m[1]), value: +m[2] });
  if ((m = effect.match(/^\+(\d) Training in (\w+)/i))) mods.push({ type: "training", key: lc(m[2]), value: +m[1] });
  return mods;
}
function featDoc(n) {
  const type = lc(n.feat_type) === "origin" ? "ancestry" : lc(n.feat_type) === "trait" ? "trait" : "learned";
  const grants = String(n.grants_technique ?? "").replace(/^\[\[|\]\]$/g, "");
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

// ─── Origins (PHB 7.8.x) and Backgrounds (PHB 7.9.0) ────────────────────
function ancestryDocs() {
  const body = sectionText(PHB, /^## 7\.8\.0 Origins/);
  const out = [];
  for (const block of body.split(/\n(?=### 7\.8\.\d+ )/).slice(1)) {
    const head = block.match(/^### (7\.8\.\d+) (.+)$/m);
    const name = head[2].trim();
    const desc = (block.match(/^\*(.+)\*$/m) ?? [])[1] ?? "";
    const feats = [...block.matchAll(/^\*\*Feat:\*\* ([^.]+)\./gm)].map(m => m[1].trim());
    const talent = [...(block.match(/^\*\*Talent:\*\* (.+)$/m)?.[1] ?? "").matchAll(/(?:one )?(\w+)(?: die)? to d(\d+)/g)]
      .map(m => ({ attribute: lc(m[1]), die: +m[2] }));
    out.push({ name, type: "origin", img: "icons/svg/village.svg",
      system: { talent, feats, feat: feats[0] ?? "", section: head[1], description: desc ? `<p>${desc}</p>` : "" } });
  }
  return out;
}

function backgroundDocs() {
  return tableAfter(PHB, /^## 7\.9\.0 Backgrounds/).map(r => {
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
const AXES = { Faith: ["faith", "Trusting", "Mistrusting"], Order: ["order", "Ordered", "Disordered"],
  Individualism: ["individualism", "Individual", "Communal"], Levity: ["levity", "Light", "Grave"] };
function habitsModule() {
  const out = {};
  for (const [label, [key, high, low]] of Object.entries(AXES)) {
    const rows = tableAfter(PHB, new RegExp(`^### 3\\.4\\.\\d+ ${label}\\s*$`));
    out[key] = rows.map(r => {
      const lean = r.Lean === high ? "high" : r.Lean === low ? "low" : "neutral";
      return { roll: Number(r["1d10"]), habit: r.Habit, lean };
    });
    if (out[key].length !== 10) warnings.push(`Habit Table ${label}: ${out[key].length} rows, expected 10`);
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

function writePack(packName, docs) {
  const out = docs.map((doc, i) => {
    const _id = stableId(packName, doc.type, doc.name, doc.system?.ancestry ?? "");
    return { _id, ...doc, effects: [], folder: null, sort: (i + 1) * 100000, ownership: { default: 0 }, flags: {}, _key: `!items!${_id}` };
  });
  writeSource(packName, out);
  console.log(`  ${packName}: ${out.length} items.`);
}

// ─── Build and check ────────────────────────────────────────────────────────
const byOrder = (a, b) => String(a.family ?? a.category ?? "").localeCompare(String(b.family ?? b.category ?? ""))
  || (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name));

const ancestries = ancestryDocs();
// A Technique only an Origin Feat grants is defined by that Feat's text and has no Catalog note.
const grantedTechniques = CAT.feats.flatMap(f => {
  const name = String(f.grants_technique ?? "").replace(/^\[\[|\]\]$/g, "");
  if (!name || CAT.techniques.some(t => t.name === name)) return [];
  const m = String(f.effect).match(/^You learn the (.+?) Technique(?: \((\w+)\)[.:]|: (\w+),) ?(.*)$/);
  if (!m) { warnings.push(`${f.name}: cannot read the Technique it grants from "${f.effect}"`); return []; }
  return [{ name, requires: m[2] ?? m[3], effect: m[4], origin_grant: f.origin, xp: null }];
});
const techniques = [...[...CAT.techniques].sort(byOrder), ...grantedTechniques].map(techniqueDoc);
const instruments = [
  ...INNATE_INSTRUMENTS.map(innateDoc),
  ...[...CAT.instruments].sort(byOrder).map(instrumentDoc),
  ...[...CAT.tools].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(toolDoc)
];
const feats = [...CAT.feats].sort((a, b) =>
  String(a.feat_type).localeCompare(String(b.feat_type)) || String(a.ancestry ?? "").localeCompare(String(b.ancestry ?? ""))
  || (a.order ?? 0) - (b.order ?? 0)).map(featDoc);
const equipment = equipmentDocs();
const backgrounds = backgroundDocs();

// Every Background kit item should resolve to something in the packs.
const known = new Set([...instruments, ...equipment].map(d => lc(d.name)));
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

const expect = { techniques: 91, feats: 57, instruments: 34, tools: 17 };
for (const [k, n] of Object.entries(expect)) {
  if (CAT[k].length !== n) warnings.push(`Catalog/${k}: ${CAT[k].length} notes, expected ${n}`);
}

console.log(`FOIL | Seeding packs from ${path.basename(process.env.FOIL_BOOKS ?? "the vault")} (system ${SYSTEM_VERSION})…`);
const habits = habitsModule();
if (!process.argv.includes("--dry-run")) fs.writeFileSync(path.join(SYSTEM_ROOT, "src", "habits.js"), habits);
if (process.argv.includes("--habits-only")) { console.log("  wrote src/habits.js"); process.exit(0); }
if (process.argv.includes("--dry-run")) {
  console.log(`  dry run: ${INSTRUMENT_TYPES.length} types, ${QUALITIES.length} qualities, ${EFFECTS.length} effects, `
    + `${instruments.length} instruments, ${techniques.length} techniques, ${feats.length} feats, ${equipment.length} equipment, `
    + `${backgrounds.length} backgrounds, ${ancestries.length} origins, ${GUIDE.length} guide journals`);
} else {
  writePack("instrument-types", INSTRUMENT_TYPES.map(instrumentTypeDoc));
  writePack("qualities", QUALITIES.map(qualityDoc));
  writePack("effects", EFFECTS.map(effectDoc));
  writePack("instruments", instruments);
  writePack("techniques", techniques);
  writePack("feats", feats);
  writePack("equipment", equipment);
  writePack("backgrounds", backgrounds);
  writePack("ancestries", ancestries);
  writeGuidePack("guide", GUIDE);
  if (!process.argv.includes("--no-build")) await buildPacks();
}

if (priceFails.length) {
  console.log(`\nPRINTED XP THAT THE EFFECTS DON'T REPRODUCE (${priceFails.length}/${techniques.length}; printed XP kept):`);
  for (const m of priceFails) console.log("  " + m);
} else {
  console.log(`\nPricing: all ${techniques.length} Techniques reproduce their printed XP.`);
}
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log("  " + w);
}
console.log("FOIL | Done.");
