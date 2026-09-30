/**
 * tools/populate-packs.mjs
 * Seeds every FOIL compendium from the books (Foilbound 0.6.0). Content comes
 * from the vault's Catalog notes (Techniques, Feats, Instruments, Tools) and
 * the Player's Handbook tables (Equipment, Backgrounds, Ancestries, Focus
 * Gems, item sizes); the vocabulary (Instrument Types, Qualities, Effects)
 * mirrors PHB 4.1.2 and Fundamental Math's Effects table.
 *
 * Run with Foundry STOPPED (LevelDB is single-writer):
 *   node tools/populate-packs.mjs
 * Flags: --dry-run writes nothing; --convictions-only writes src/convictions.js and stops.
 * Env (or tools/local-paths.json): FOUNDRY_APP, FOIL_BOOKS; optional FOIL_VERSION, FOIL_PACK_ROOT.
 *
 * Every catalog Technique is decomposed into priced Effects and re-priced by
 * src/pricing.js. Its printed XP stays authoritative (xpOverride); rows whose
 * Effects don't add up to the printed XP are listed at the end.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { priceTechnique, strainFor } from "../src/pricing.js";
import { GUIDE } from "./guide-content.mjs";
import {
  SYSTEM_ROOT, SYSTEM_VERSION, readPHB, readCatalog, tableAfter, sectionText, setting
} from "./books.mjs";

const FOUNDRY_APP = setting("FOUNDRY_APP");
const { ClassicLevel } = await import(pathToFileURL(path.join(FOUNDRY_APP, "node_modules/classic-level/index.js")).href);

const PACK_ROOT = process.env.FOIL_PACK_ROOT ?? path.join(SYSTEM_ROOT, "packs");
const NOW = Date.now();
const STATS = {
  coreVersion: "14.367", systemId: "foil", systemVersion: SYSTEM_VERSION,
  createdTime: NOW, modifiedTime: NOW, lastModifiedBy: null,
  compendiumSource: null, duplicateSource: null, exportSource: null
};

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function makeId() { let s = ""; for (let i = 0; i < 16; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]; return s; }
const slug = name => String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const lc = s => String(s ?? "").trim().toLowerCase();
const num = s => Number(String(s ?? "").replace(/[^0-9.-]/g, "")) || 0;

const PHB = readPHB();
const CAT = readCatalog();
const warnings = [];

// ─── Vocabulary: Instrument Types (PHB 4.1.2) ───────────────────────────────
// [name, key, family, {stressPhysical, stressMental, pierce, flags...}, description]
const CRAFT_MATERIALS = ["Metal", "Wood", "Leather", "Gemstone", "Textile", "Reagent", "Stone"];
const INSTRUMENT_TYPES = [
  ["Quick", "quick", "other", { quick: true }, "Its built-in Techniques may be used as a Quick Action, on top of the Action they can always be paid with."],
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
  ["±N [Skill or Oppose]", "skill-mod", "perPoint", { perPoint: 6 }, { label: "±N" }, "Positive: +N to a named Skill. Negative on an Oppose: Reeling (PHB 6.8.6)."],
  ["-N [target Attribute]", "weaken", "perPoint", { perPoint: 18 }, { requires: ["incorporeal", ...MELEE], label: "-N [target Attribute]" }, "Weakened: the named Attribute's rolls take -N (PHB 6.8.4)."],
  ["+N (this roll)", "roll-bonus", "perPoint", { perPoint: 6 }, { label: "+N" }, "+N to this Technique's own roll."],
  ["Pierce N", "pierce", "perPoint", { perPoint: 4 }, { requires: [...MELEE, ...RANGED, "kinetic"], label: "Pierce N" }, "Ignore N of the target's Resistance."],
  ["Resistance +N", "resistance", "perPoint", { perPoint: 4 }, { requires: ["parry", "blocking", "fortifying"], label: "Resistance +N" }, "Physical or mental Resistance +N."],
  ["Mend Xd4", "mend", "perPoint", { perPoint: 16 }, { requires: ["fortifying", "sonic", "tool"], label: "Mend Nd4" }, "Remove Xd4 Stress from an ally's Attribute. Takes ten minutes and a ration. Through a Tool: a Trade at Difficulty 12, no Strain."],
  ["Lingering N", "lingering", "perPoint", { perPoint: 8 }, { requires: ["kinetic", "incorporeal", "pointed", "edged"], label: "Lingering N" }, "N more Stress at the start of the target's next turns."],
  ["Redirect", "redirect", "flat", { base: 8 }, { requires: ["blocking"] }, "Take an ally's incoming Stress instead."],
  ["Move", "move", "flat", { base: 4 }, { requires: ["grappling", "blunt", "kinetic", "incorporeal"] }, "Move the target one band."],
  ["Disarm", "disarm", "flat", { base: 8 }, { requires: [...MELEE, "kinetic"] }, "The target drops the Instrument it used last. Innate Instruments can't be dropped."],
  ["Evade", "evade", "flat", { base: 4 }, { requires: ["kinetic", "incorporeal"] }, "Move without provoking."],
  ["Illusion", "illusion", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "A false sight or sound."],
  ["Drain", "drain", "flat", { base: 8 }, { requires: ["incorporeal"] }, "Heal what the Technique deals."],
  ["Counter", "counter", "flat", { base: 12 }, {}, "Contest another Technique as it lands, minus its Strain. A countered upkeep ends the Technique."],
  ["Hasten (Action)", "hasten-action", "flat", { base: 8 }, { requires: ["fortifying"] }, "Grant an ally an extra Action."],
  ["Hasten (Quick Action)", "hasten-quick", "flat", { base: 4 }, { requires: ["fortifying"] }, "Grant an ally an extra Quick Action."],
  ["Extend Range", "extend-range", "extendRange", { perBand: 1 }, { requires: ["kinetic", "incorporeal"] }, "1 XP per band of extra reach."],
  ["Pattern", "pattern", "pattern", {}, { requires: [...MELEE, ...RANGED, "sonic", ...ARCANE] }, "Beam or Wall: 1 + 2 + ... per band. Cone 3x, Radius 12x the Beam cost. A Melee Pattern reaches no farther than its Instrument's Range."],
  ["Selective", "selective", "selective", {}, { requires: [...RANGED, "sonic", ...ARCANE] }, "N creatures within R bands: N + (R x N)."],
  ["Upkeep", "upkeep", "upkeep", { base: 4 }, { requires: ARCANE, exempt: true }, "Keep the Technique active by paying its Action and Strain each turn."],
  ["Quick", "quick", "quick", {}, { exempt: true, floor: true }, "A free tag. A stated trigger sets the 8 XP floor."],
  // Conditions (PHB 6.8.x), priced flat.
  ["Grappled", "grappled", "flat", { base: 4 }, { requires: ["grappling", "kinetic"] }, "PHB 6.8.3."],
  ["Prone", "prone", "flat", { base: 8 }, { requires: [...MELEE, ...RANGED, "kinetic"] }, "PHB 6.8.7."],
  ["Restrained", "restrained", "flat", { base: 16 }, { requires: ["grappling", "kinetic"] }, "PHB 6.8.5."],
  ["Charmed", "charmed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.8."],
  ["Frightened", "frightened", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.9."],
  ["Controlled", "controlled", "flat", { base: 24 }, { requires: ["incorporeal"] }, "PHB 6.8.10."],
  ["Intimidated", "intimidated", "flat", { base: 10 }, { requires: ["incorporeal", "sonic", ...MELEE] }, "PHB 6.8.11."],
  ["Baited", "baited", "flat", { base: 8 }, { requires: ["incorporeal", "sonic", ...MELEE, ...RANGED] }, "PHB 6.8.12."],
  ["Angered", "angered", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.13."],
  ["Relaxed", "relaxed", "flat", { base: 8 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.14."],
  ["Impressed", "impressed", "flat", { base: 10 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.15."],
  ["Wary", "wary", "flat", { base: 8 }, { requires: ["sonic", "fortifying"] }, "PHB 6.8.16."],
  ["Enthralled", "enthralled", "flat", { base: 20 }, { requires: ["incorporeal", "sonic"] }, "PHB 6.8.17."],
  ["Blinded", "blinded", "flat", { base: 16 }, { requires: [...MELEE, ...RANGED, "kinetic", "incorporeal"] }, "PHB 6.8.20."],
  ["Slowed", "slowed", "flat", { base: 4 }, { requires: [...MELEE, ...RANGED, "kinetic", "incorporeal"] }, "PHB 6.8.21."]
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
  "baited", "angered", "relaxed", "impressed", "wary", "enthralled", "blinded", "slowed"];
const e = (key, extra = {}) => ({ key, magnitude: 1, pattern: "single", bands: 0, placement: 0, selectiveN: 0, selectiveR: 0, ...extra });

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
  let src = String(text ?? "").replace(/\.$/, "").replace(/\.\s*Strain \d+$/i, "");
  const trig = src.match(/^Quick \(trigger:[^)]*\):\s*(.*)$/i);
  if (trig) { quick = true; src = trig[1]; }
  if (/\+1 Stress\b/.test(src)) rider = true;
  // "+1 and Resistance +1" is two Effects sharing one target clause.
  const clauses = splitTop(src).flatMap(c => /^\+\d+ and Resistance/i.test(c) ? c.split(/ and /) : [c]);
  for (const raw of clauses) {
    let c = raw.replace(/\.$/, "").trim();
    const sel = c.match(/(?:to )?up to (\d+) allies within (\w+) \(Selective\)/i);
    if (sel) {
      list.push(e("selective", { selectiveN: Number(sel[1]), selectiveR: BAND[lc(sel[2])] ?? 0 }));
      c = c.replace(sel[0], "").trim();
      if (!c) continue;
    }
    let m;
    if (/^Strain \d+$/i.test(c)) continue;
    if (/^(deal Stress to that attacker|\+1 Stress|physical or mental|self or ally|reduced by your physical Resistance)$/i.test(c)) continue;
    if (/^Stress$/i.test(c)) { stress = true; continue; }
    if (/^Upkeep$/i.test(c)) { list.push(e("upkeep")); continue; }
    if ((m = c.match(/^Pierce (\d+)$/i))) { list.push(e("pierce", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^-(\d+) \[target Attribute\]$/i))) { list.push(e("weaken", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^-(\d+) Oppose$/i))) { list.push(e("skill-mod", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^\+(\d+)$/))) { list.push(e("roll-bonus", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^(?:Gain )?\+(\d+)\b/i))) { list.push(e("skill-mod", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^(?:Gain )?Resistance \+(\d+)/i))) { list.push(e("resistance", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^Mend (\d+)d4/i))) { list.push(e("mend", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^Lingering (\d+)$/i))) { list.push(e("lingering", { magnitude: +m[1] })); continue; }
    if ((m = c.match(/^(Beam|Cone|Radius|Wall) \((\w+)\)$/i))) { list.push(e("pattern", { pattern: lc(m[1]), bands: BAND[lc(m[2])] ?? 0 })); continue; }
    if (/^Extend Range$/i.test(c)) { list.push(e("extend-range", { bands: 1 })); continue; }
    if (/^Move (the|each) target 1 band$/i.test(c)) { list.push(e("move")); continue; }
    if (/^Hasten \(Action\)/i.test(c)) { list.push(e("hasten-action")); if (/\band \+1$/.test(c)) list.push(e("skill-mod")); continue; }
    if (/^Hasten \(Quick Action\)/i.test(c)) { list.push(e("hasten-quick")); continue; }
    if ((m = c.match(/^(Evade|Illusion|Drain|Counter|Redirect|Disarm)\b/i))) { list.push(e(lc(m[1]))); continue; }
    if ((m = c.match(/^(\w+)(?: \(.*\))?$/)) && CONDITION_KEYS.includes(lc(m[1]))) { list.push(e(lc(m[1]))); continue; }
    if (/^Redirect that Stress/i.test(c)) { list.push(e("redirect")); continue; }
    if (/^use a Melee Technique against that attacker/i.test(c)) continue;
    unparsed.push(c);
  }
  if (rider) list.push(e("stress-rider"));
  if (quick) list.push(e("quick"));
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
  const xp = Number(n.xp) || 0;
  // GMG 12.1.0 step 4: Fortifying, a ward or bonus until the caster's next turn, or a stated trigger.
  const floor = requires.includes("fortifying") || /until your next turn|Quick \(trigger/i.test(n.effect ?? "");
  const price = effects => priceTechnique(effects, EFFECT_REG, { floor }).xp;

  // A Technique deals Stress only when its line says so (PHB 7.6.0).
  let effects;
  if (MOVEMENT_TRAITS.has(n.name)) { effects = []; unparsed.length = 0; }
  else if (HAND_EFFECTS[n.name]) { effects = HAND_EFFECTS[n.name](); unparsed.length = 0; }
  else effects = stress ? [e("stress"), ...list] : list;

  const computed = price(effects);
  if (effects.length && (computed !== xp || unparsed.length)) {
    priceFails.push(`${n.name}: printed ${xp}, Effects price ${computed}  [${n.effect}]${unparsed.length ? `  unparsed: ${unparsed.join(" | ")}` : ""}`);
  }
  if (n.strain !== undefined && n.strain !== null && Number(n.strain) !== strainFor(xp)) {
    warnings.push(`${n.name}: printed Strain ${n.strain}, floor(${xp}/8) = ${strainFor(xp)}`);
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
      ancestryGrant: n.ancestry_grant ?? "",
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
    materials: o.materials ?? materialsOf[lc(name)] ?? "", equipped: false, qualities: o.qualities ?? [],
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
  const ward = sectionText(PHB, /^### 7\.5\.4 Wards and charms/);
  const wardTables = ward.split(/\n(?=\| Item)/).filter(s => s.startsWith("| Item"));
  const wardRows = tableAfter("#### x\n" + wardTables[0], /^#### x/);
  for (const r of wardRows) {
    out.push(equip(r.Item, "ward", num(r.Price), { qualities: [q("resistance", num(r.Resistance), "mental")], notes: r.Notes ?? "", size: "small", materials: "Metal" }));
  }
  const charmRows = tableAfter("#### x\n" + wardTables[1], /^#### x/);
  for (const r of charmRows) {
    out.push(equip(r.Item, "charm", num(r.Price), { qualities: [q("skill-bonus", 1, lc(r.Skill))], notes: r.Notes ?? "", size: "small", materials: "Metal" }));
  }
  for (const r of tableAfter(PHB, /^### 7\.5\.5 Adventuring Gear/)) {
    out.push(equip(r.Item, "gear", num(r.Price), { effect: r["Helps with"], size: "small", materials: "" }));
  }
  for (const r of tableAfter(PHB, /^### 7\.5\.6 Medicine/)) {
    out.push(equip(r.Item, "medicine", num(r.Price), { effect: r.Effect, uses: r.Uses, size: "small", materials: "" }));
  }
  for (const r of tableAfter(PHB, /^### 7\.5\.7 Potions and Poisons/)) {
    out.push(equip(r.Item, "potion", num(r.Price), { effect: r.Effect, duration: r.Duration, uses: r.Uses, size: "small", materials: "Reagent" }));
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
const ANCESTRY_FULL = {};
function featDoc(n) {
  const type = lc(n.feat_type) === "ancestry" ? "ancestry" : lc(n.feat_type) === "trait" ? "trait" : "learned";
  const grants = String(n.grants_technique ?? "").replace(/^\[\[|\]\]$/g, "");
  const effect = n.effect ?? "";
  return {
    name: n.name, type: "feat", img: "icons/svg/upgrade.svg",
    system: {
      featType: type, xpCost: Number(n.xp) || 0, requirements: n.requires ?? "", effect,
      ancestry: ANCESTRY_FULL[n.ancestry] ?? n.ancestry ?? "", grantsTechnique: grants,
      modifiers: featModifiers(effect), description: ""
    }
  };
}

// ─── Ancestries (PHB 7.8.x) and Backgrounds (PHB 7.9.0) ────────────────────
function ancestryDocs() {
  const body = sectionText(PHB, /^## 7\.8\.0 Ancestries/);
  const out = [];
  for (const block of body.split(/\n(?=### 7\.8\.\d+ )/).slice(1)) {
    const head = block.match(/^### (7\.8\.\d+) (.+)$/m);
    const name = head[2].trim();
    const desc = (block.match(/^\*(.+)\*$/m) ?? [])[1] ?? "";
    const feats = [...block.matchAll(/^\*\*Feat:\*\* ([^.]+)\./gm)].map(m => m[1].trim());
    const talent = [...(block.match(/^\*\*Talent:\*\* (.+)$/m)?.[1] ?? "").matchAll(/(\w+) to d(\d+)/g)]
      .map(m => ({ attribute: lc(m[1]), die: +m[2] }));
    ANCESTRY_FULL[name.split(" ")[0]] = name;
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

// ─── Convictions (PHB 3.4.x) → src/convictions.js, read by the Create app ────
const AXES = { Faith: ["faith", "Trusting", "Mistrusting"], Order: ["order", "Ordered", "Disordered"],
  Individualism: ["individualism", "Individual", "Communal"], Levity: ["levity", "Light", "Grave"] };
function convictionsModule() {
  const out = {};
  for (const [label, [key, high, low]] of Object.entries(AXES)) {
    const rows = tableAfter(PHB, new RegExp(`^### 3\\.4\\.\\d+ ${label}\\s*$`));
    out[key] = rows.map(r => {
      const lean = r.Lean === high ? "high" : r.Lean === low ? "low" : "neutral";
      return { roll: Number(r["1d10"]), trait: r.Trait, lean };
    });
    if (out[key].length !== 10) warnings.push(`Convictions ${label}: ${out[key].length} rows, expected 10`);
  }
  return `/**\n * src/convictions.js\n * Generated by tools/populate-packs.mjs from PHB 3.4.1-3.4.4. Do not edit by hand.\n */\n\nexport const CONVICTIONS = ${JSON.stringify(out, null, 2)};\n`;
}

// ─── Writer ─────────────────────────────────────────────────────────────────
function finalize(doc, sort) {
  const _id = makeId();
  return [`!items!${_id}`, { _id, ...doc, effects: [], folder: null, sort, ownership: { default: 0 }, flags: {}, _stats: { ...STATS } }];
}

async function writeGuidePack(packName, journals) {
  const db = new ClassicLevel(path.join(PACK_ROOT, packName), { valueEncoding: "json" });
  await db.open();
  const old = [];
  for await (const key of db.keys()) if (key.startsWith("!journal")) old.push(key);
  if (old.length) await db.batch(old.map(key => ({ type: "del", key })));
  const ops = [];
  journals.forEach((j, ji) => {
    const jid = makeId();
    const pageIds = j.pages.map(() => makeId());
    ops.push({ type: "put", key: `!journal!${jid}`, value: {
      _id: jid, name: j.name, pages: pageIds, folder: null, sort: (ji + 1) * 100000,
      ownership: { default: 2 }, flags: {}, _stats: { ...STATS }
    }});
    j.pages.forEach((pg, pi) => {
      ops.push({ type: "put", key: `!journal.pages!${jid}.${pageIds[pi]}`, value: {
        _id: pageIds[pi], name: pg.name, type: "text",
        title: { show: true, level: 1 },
        text: { format: 1, content: pg.html.trim(), markdown: "" },
        image: {}, video: { controls: true, volume: 0.5 }, src: null,
        system: {}, sort: (pi + 1) * 100000, ownership: { default: -1 },
        flags: {}, _stats: { ...STATS }
      }});
    });
  });
  await db.batch(ops);
  await db.close();
  const pages = journals.reduce((n, j) => n + j.pages.length, 0);
  console.log(`  ${packName}: wrote ${journals.length} journals / ${pages} pages (cleared ${old.length} rows).`);
}

async function writePack(packName, docs) {
  const db = new ClassicLevel(path.join(PACK_ROOT, packName), { valueEncoding: "json" });
  await db.open();
  const oldKeys = [];
  for await (const key of db.keys()) if (key.startsWith("!items")) oldKeys.push(key);
  if (oldKeys.length) await db.batch(oldKeys.map(key => ({ type: "del", key })));
  const ops = docs.map((doc, i) => { const [key, value] = finalize(doc, (i + 1) * 100000); return { type: "put", key, value }; });
  await db.batch(ops);
  await db.close();
  console.log(`  ${packName}: wrote ${ops.length} items (cleared ${oldKeys.length}).`);
}

// ─── Build and check ────────────────────────────────────────────────────────
const byOrder = (a, b) => String(a.family ?? a.category ?? "").localeCompare(String(b.family ?? b.category ?? ""))
  || (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name));

const ancestries = ancestryDocs();
const techniques = [...CAT.techniques].sort(byOrder).map(techniqueDoc);
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
// Every Ancestry Feat named in 7.8.x should exist as a Feat.
const featNames = new Set(feats.map(f => f.name));
for (const a of ancestries) for (const f of a.system.feats) if (!featNames.has(f)) warnings.push(`${a.name}: Feat "${f}" not in the Catalog`);

const expect = { techniques: 106, feats: 51, instruments: 34, tools: 17 };
for (const [k, n] of Object.entries(expect)) {
  if (CAT[k].length !== n) warnings.push(`Catalog/${k}: ${CAT[k].length} notes, expected ${n}`);
}

console.log(`FOIL | Seeding packs from ${path.basename(process.env.FOIL_BOOKS ?? "the vault")} (system ${SYSTEM_VERSION})…`);
const convictions = convictionsModule();
if (!process.argv.includes("--dry-run")) fs.writeFileSync(path.join(SYSTEM_ROOT, "src", "convictions.js"), convictions);
if (process.argv.includes("--convictions-only")) { console.log("  wrote src/convictions.js"); process.exit(0); }
if (process.argv.includes("--dry-run")) {
  console.log(`  dry run: ${INSTRUMENT_TYPES.length} types, ${QUALITIES.length} qualities, ${EFFECTS.length} effects, `
    + `${instruments.length} instruments, ${techniques.length} techniques, ${feats.length} feats, ${equipment.length} equipment, `
    + `${backgrounds.length} backgrounds, ${ancestries.length} ancestries, ${GUIDE.length} guide journals`);
} else {
  await writePack("instrument-types", INSTRUMENT_TYPES.map(instrumentTypeDoc));
  await writePack("qualities", QUALITIES.map(qualityDoc));
  await writePack("effects", EFFECTS.map(effectDoc));
  await writePack("instruments", instruments);
  await writePack("techniques", techniques);
  await writePack("feats", feats);
  await writePack("equipment", equipment);
  await writePack("backgrounds", backgrounds);
  await writePack("origins", ancestries);
  await writeGuidePack("guide", GUIDE);
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
