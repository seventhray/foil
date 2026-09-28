/**
 * tools/populate-packs.mjs
 * Catalogue seeder for the modular FOIL system (v0.2.0). Writes the authorable
 * VOCABULARY packs (instrument-types, qualities, effects) and the CONTENT packs
 * (instruments, techniques, feats, equipment, backgrounds, origins) in their new
 * referenced form: instruments carry Instrument Type slugs, techniques carry
 * composed effect entries (decomposed from the PHB Effect prose) plus an
 * authoritative xpOverride, equipment carries composed Quality entries.
 *
 * Run with Foundry CLOSED:
 *   cd /home/connor/foundryvtt
 *   node /home/connor/foundrydata/Data/systems/foil/tools/populate-packs.mjs
 *
 * The technique decomposition is self-checked: the pricing engine (src/pricing.js)
 * re-derives each technique's XP from its composed effects and asserts it matches
 * the catalogue value, printing any mismatch.
 */

import { ClassicLevel } from "/home/connor/foundryvtt/node_modules/classic-level/index.js";
import { priceTechnique } from "../src/pricing.js";
import { GUIDE } from "./guide-content.mjs";

const PACK_ROOT = "/home/connor/foundrydata/Data/systems/foil/packs";
const NOW = Date.now();
const STATS = {
  coreVersion: "14.361", systemId: "foil", systemVersion: "0.3.0",
  createdTime: NOW, modifiedTime: NOW, lastModifiedBy: null,
  compendiumSource: null, duplicateSource: null, exportSource: null
};

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function makeId() { let s = ""; for (let i = 0; i < 16; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]; return s; }

// ─── Vocabulary: Instrument Types (PHB §7.11.0) ─────────────────────────────
// [name, aptitude, harms, isTool, bonusStress]
// `harms` is "physical" (Might or Finesse), "mental" (Wit or Presence), or ""
// for support and Tools. The attacker picks which Attribute of the pair, and a
// target Opposes with any Aptitude built on the Attribute under attack, so
// neither a Target nor an Oppose column is stored any more (PHB §5.2.2).
// bonusStress is a flat rider on a landed hit; only Fired carries one.
const INSTRUMENT_TYPES = [
  ["Edged", "prowess", "physical", false],
  ["Pointed", "prowess", "physical", false],
  ["Blunt", "prowess", "physical", false],
  ["Grappling", "prowess", "physical", false],
  // Active use rolls Fortitude; the passive "+N Blocking Instrument" Item
  // Upgrade (PHB §7.4.0) still Bolsters Prowess on the Oppose side.
  ["Blocking", "fortitude", "", false],
  ["Parry", "prowess", "", false],
  ["Thrown", "acuity", "physical", false],
  ["Drawn", "acuity", "physical", false],
  ["Fired", "acuity", "physical", false, 2],
  ["Command", "command", "mental", false],
  ["Guile", "guile", "mental", false],
  ["Resonance", "resonance", "", false],
  ["Kinetic", "command / guile", "physical", false],
  ["Incorporeal", "guile / resonance", "mental", false],
  ["Fortifying", "command / resonance", "", false],
  ["Survival", "acuity", "", true],
  ["Alchemy", "acuity", "", true],
  ["Craft", "prowess", "", true],
  ["Performance", "resonance", "", true],
  ["Subterfuge", "guile", "", true],
  ["Athletics", "prowess", "", true]
];
const slug = name => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function instrumentTypeDoc([name, aptitude, harms, isTool, bonusStress]) {
  return { name, type: "instrumentType", img: "icons/svg/upgrade.svg",
    system: {
      key: slug(name), aptitude, harms, isTool,
      bonusStress: bonusStress ?? 0, description: ""
    } };
}

// ─── Vocabulary: Qualities ──────────────────────────────────────────────────
// [name, key, kind, scope, valueLabel]
const QUALITIES = [
  ["Resistance", "resistance", "resistance", "resistanceKind", "+N physical or mental"],
  ["Bolster", "bolster", "bolster", "aptitude", "+N to an Aptitude"],
  ["Aid", "aid", "aid", "free", "+N to a named task"],
  ["Blocking", "blocking", "blocking", "none", "a Blocking Instrument"]
];
function qualityDoc([name, key, kind, scope, valueLabel]) {
  return { name, type: "quality", img: "icons/svg/shield.svg",
    system: { key, kind, scope, valueLabel, description: "" } };
}

// ─── Vocabulary: Effects (GMG §5.1.0) ───────────────────────────────────────
// [name, key, pricingKind, params, {requires, exempt, setsFloor}]
// Rescaled 2026-07-28: base per-point rate 5 XP → 4 XP (all flat/per-point costs
// here are ×0.8 of their pre-rescale value). Pattern/Selective/Extend Range stay
// on their own band-based (1 XP/band) system and are unaffected.
const L = (base, perPoint = 0) => ({ base, perPoint });
const EFFECTS = [
  // Stress is a priced effect and counts toward the combination premium
  // (Fundamental Math, Techniques preamble: "A Technique's own listed price
  // already includes it").
  ["Stress", "stress", "linear", L(4, 0), {}],
  // The merged sign-keyed roll modifier. Positive adds to a named Skill; negative
  // on an Attribute applies Weakened (PHB 6.8.4), negative on an Oppose applies
  // Stunned (PHB 6.8.6). Replaces the retired Accuracy / Bolster / Impair split.
  ["\u00b1N [Skill, Attribute, or Oppose]", "mod", "linear", L(0, 6), {}],
  ["Pierce", "pierce", "linear", L(0, 4), {}],
  ["Resistance +N", "resistance", "linear", L(0, 4), {}],
  ["Hasten +N AP", "hasten", "linear", L(0, 4), {}],
  ["Mend Xd6", "mend", "linear", L(4, 4), { requires: ["fortifying", "resonance"] }],
  ["Lingering N", "lingering", "linear", L(0, 8), {}],
  ["Move", "move", "flat", L(4), {}],
  ["Drain", "drain", "flat", L(8), {}],
  ["Illusion", "illusion", "flat", L(8), {}],
  ["Evade", "evade", "flat", L(4), {}],
  ["Negate Failure", "negate", "flat", L(16), {}],
  ["Redirect", "redirect", "flat", L(8), {}],
  ["Counter", "counter", "flat", L(16), {}],
  ["Reaction", "reaction", "flat", L(8), {}],
  // Conditions, repriced 2026-09 (Fundamental Math, Condition [name] row).
  ["Grappled", "grappled", "flat", L(4), {}],
  ["Prone", "prone", "flat", L(8), {}],
  ["Restrained", "restrained", "flat", L(16), {}],
  ["Charmed", "charmed", "flat", L(8), {}],
  ["Frightened", "frightened", "flat", L(8), {}],
  ["Controlled", "controlled", "flat", L(24), {}],
  ["Intimidated", "intimidated", "flat", L(10), {}],
  ["Baited", "baited", "flat", L(8), {}],
  ["Angered", "angered", "flat", L(8), {}],
  ["Relaxed", "relaxed", "flat", L(8), {}],
  ["Impressed", "impressed", "flat", L(10), {}],
  ["Wary", "wary", "flat", L(8), {}],
  ["Enthralled", "enthralled", "flat", L(20), {}],
  ["Extend Range", "extendRange", "extendRange", { perBand: 1 }, {}],
  ["Pattern", "pattern", "pattern", {}, {}],
  ["Selective", "selective", "selective", {}, {}],
  ["Upkeep", "upkeep", "upkeep", { base: 4 }, { exempt: true }]
];
function effectDoc([name, key, pricingKind, params, opt]) {
  return { name, type: "effect", img: "icons/svg/aura.svg",
    system: {
      key, requires: opt.requires ?? [], pricingKind,
      pricingParams: { base: params.base ?? 0, perPoint: params.perPoint ?? 0, perBand: params.perBand ?? 1, floor: params.floor ?? 8 },
      exemptFromPremium: !!opt.exempt, setsFloor: !!opt.setsFloor, noStrain: false, description: ""
    } };
}
// A registry mirror for the self-check.
const EFFECT_REG = Object.fromEntries(EFFECTS.map(([name, key, pricingKind, params, opt]) => [key, {
  label: name, pricingKind, pricingParams: { base: params.base ?? 0, perPoint: params.perPoint ?? 0, perBand: params.perBand ?? 1, floor: params.floor ?? 8 },
  exemptFromPremium: !!opt.exempt
}]));

// The effect-prose parser was retired 2026-09: Fundamental Math's current syntax
// (sign-keyed ±N, inline Strain, implicit Stress) is not round-trippable from prose,
// so every Technique below ships an explicit composed effect list instead, still
// re-priced against its catalogue XP by the self-check at the bottom of this file.

// ─── Techniques (PHB §7.6.x + §2.5.3) ───────────────────────────────────────
// [name, xp, [requireSlugs], aptitude, target, oppose, effectProse, {desc, floorOverride, decompose:false}]
// `decompose:false` = keep xpOverride only (irregular prose the parser can't price); no assertion.
const M = ["edged", "pointed", "blunt"];
const RANGED = ["thrown", "drawn", "fired"];
// XP costs rescaled 2026-07-28 (4 XP/point base; see src/pricing.js docstring).
// [name, xp, [requireSlugs], effectProse, {effects, decompose, desc}]
// Regenerated from Design Docs/Fundamental Math.md (the source of truth; the PHB
// catalogue is a transclusion of it). Every row below carries an explicit composed
// effect list, re-priced by src/pricing.js against the catalogue XP.
const TECHNIQUES = [
  ["Sunder", 12, ["edged", "pointed"], "Pierce 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 1 }], desc: "A heavy blow that splits guard and armor." }],
  ["Rend", 16, ["edged", "pointed"], "Pierce 2, Strain 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 2 }], desc: "A tearing cut that splits armor wide." }],
  ["Concuss", 14, ["blunt"], "-1 Wit",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }], desc: "A blow to the head that leaves the world spinning." }],
  ["Hamstring", 14, ["edged"], "-1 Finesse",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }], desc: "A slash behind the knee that steals their footing." }],
  ["Break", 20, ["blunt"], "-2 [target Attribute], Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }], desc: "A brutal strike that cripples the target." }],
  ["Trip", 16, ["edged", "pointed", "blunt"], "Prone, Strain 1",
    { effects: [{ key: "stress" }, { key: "prone" }], desc: "A low sweep that drops them to the ground." }],
  ["Pommel Strike", 32, ["blunt"], "-4 Oppose, Strain 2",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 4 }], desc: "A crack to the skull that leaves them reeling." }],
  ["Gutting Blow", 22, ["edged", "pointed"], "Pierce 1, -1 [target Attribute], Strain 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 1 }, { key: "mod", magnitude: 1 }], desc: "A deep wound that bleeds away strength." }],
  ["Maiming Strike", 26, ["edged", "pointed"], "Pierce 2, -1 [target Attribute], Strain 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 2 }, { key: "mod", magnitude: 1 }], desc: "A crippling blow through armor and sinew." }],
  ["Piercing Shot", 12, ["thrown", "drawn", "fired"], "Pierce 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 1 }], desc: "A bolt driven clean through armor." }],
  ["Aim", 20, ["thrown", "drawn", "fired"], "+2, Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }], desc: "You steady your aim and strike true." }],
  ["Snipe", 26, ["thrown", "drawn", "fired"], "+3, Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 3 }], desc: "A patient shot that finds the gap." }],
  ["Called Shot", 28, ["thrown", "drawn", "fired"], "Pierce 1, +2, Strain 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 1 }, { key: "mod", magnitude: 2 }], desc: "A precise shot through the weak point." }],
  ["Crippling Shot", 14, ["thrown", "drawn", "fired"], "-1 [target Attribute]",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }], desc: "A shot to a joint that slows them." }],
  ["Pinning Shot", 20, ["thrown", "drawn", "fired"], "-2 [target Attribute], Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }], desc: "A shaft that nails them in place." }],
  ["Bola Shot", 16, ["thrown", "drawn", "fired"], "Prone, Strain 1",
    { effects: [{ key: "stress" }, { key: "prone" }], desc: "Whirling cords tangle their legs and drop them." }],
  ["Volley", 17, ["thrown", "drawn", "fired"], "Cone (Near), Strain 1",
    { effects: [{ key: "stress" }, { key: "pattern", pattern: "cone", bands: 2 }], desc: "A spray of shots that catches a whole group." }],
  ["Bind", 12, ["grappling", "kinetic"], "-2 [target Attribute], no Stress",
    { effects: [{ key: "mod", magnitude: 2 }], desc: "You tie up the target and sap their strength." }],
  ["Grapple", 12, ["grappling"], "Grappled",
    { effects: [{ key: "stress" }, { key: "grappled" }], desc: "You seize the target and hold them fast." }],
  ["Takedown", 16, ["grappling"], "Prone, Strain 1",
    { effects: [{ key: "stress" }, { key: "prone" }], desc: "A throw that puts them on the ground." }],
  ["Pin", 24, ["grappling"], "Restrained (break free as Grappled), Strain 1",
    { effects: [{ key: "stress" }, { key: "restrained" }], desc: "You bear the target down and hold them helpless." }],
  ["Suplex", 32, ["grappling"], "Prone, -2 [target Attribute], Strain 2",
    { effects: [{ key: "stress" }, { key: "prone" }, { key: "mod", magnitude: 2 }], desc: "A brutal slam that leaves them reeling on the ground." }],
  ["Hobble", 14, ["command"], "-1 [target Attribute]",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }], desc: "A barbed remark that leaves the target shaken." }],
  ["Dread Cry", 16, ["command"], "Frightened, Strain 1",
    { effects: [{ key: "stress" }, { key: "frightened" }], desc: "A cry that wounds and fills them with dread." }],
  ["Beguile", 8, ["guile"], "Charmed",
    { effects: [{ key: "charmed" }], desc: "Honeyed words that stay their hand." }],
  ["Ghost Sound", 8, ["guile"], "Illusion",
    { effects: [{ key: "illusion" }], desc: "A false sound thrown to draw eye and ear." }],
  ["Feint", 6, ["guile"], "+1 [Skill] (self, 1 round)",
    { effects: [{ key: "mod", magnitude: 1 }], desc: "A false opening, taken before they realize it isn't real." }],
  ["Retort", 8, ["command"], "Reaction (trigger: a Sonic Technique fails against you): Jeer against that attacker with +1 Stress.",
    { effects: [{ key: "reaction" }], desc: "You turn a failed insult back on its speaker." }],
  ["Harrow", 27, ["command"], "-1 [target Attribute], Cone (Near), Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }, { key: "pattern", pattern: "cone", bands: 2 }], desc: "Words that cut through a whole crowd at once." }],
  ["Steady", 8, ["resonance"], "Remove 1d6 Stress from an ally's Attribute",
    { effects: [{ key: "mend", magnitude: 1 }], desc: "A word held steady until they can hold themselves." }],
  ["Talk Down", 12, ["resonance"], "Remove 2d6 Stress from an ally's Attribute",
    { effects: [{ key: "mend", magnitude: 2 }], desc: "The long version, and it takes as long as it takes." }],
  ["Rally", 6, ["resonance"], "+1 to self or an ally",
    { effects: [{ key: "mod", magnitude: 1 }], desc: "A word timed exactly right, and someone stands a little taller." }],
  ["Riposte", 8, ["parry"], "Reaction (trigger: a Melee Technique fails against you): use a Melee Technique against that attacker through this Instrument.",
    { effects: [{ key: "reaction" }], desc: "You answer a failed attack with one of your own." }],
  ["Deflect", 24, ["parry"], "Counter, Strain 1",
    { effects: [{ key: "stress" }, { key: "counter" }], desc: "You read the blow or spell and turn it aside before it lands." }],
  ["Shielding Ward", 8, ["blocking"], "Gain Resistance +1 of the kind your block covers until your next turn.",
    { floorOverride: 8, effects: [{ key: "resistance", magnitude: 1 }], desc: "You brace your block and harden against a blow." }],
  ["Steady Nerve", 8, ["blocking"], "Gain +1 to your Opposes until your next turn.",
    { floorOverride: 8, effects: [{ key: "mod", magnitude: 1 }], desc: "You settle your nerves against the arcane." }],
  ["Intercept", 16, ["blocking"], "Reaction (trigger: an ally within reach takes Might or Finesse Stress from a physical Technique your block covers): Redirect that Stress onto your Might, reduced by your physical Resistance.",
    { effects: [{ key: "stress" }, { key: "reaction" }], desc: "You throw yourself in the way for an ally." }],
  ["Perfect Guard", 24, ["blocking"], "Negate Failure, Strain 1",
    { effects: [{ key: "stress" }, { key: "negate" }], desc: "Your block turns a failed defense into a clean one." }],
  ["Gale Shove", 4, ["kinetic"], "Move the target 1 band, no Stress",
    { effects: [{ key: "move" }], desc: "A wall of wind hurls the target back a band." }],
  ["Blink", 4, ["kinetic"], "Evade",
    { effects: [{ key: "evade" }], desc: "A flick of force carries you a band away untouched." }],
  ["Rending Lance", 12, ["kinetic"], "Pierce 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 1 }], desc: "A spear of force punches through armor and guard." }],
  ["Guided Bolt", 20, ["kinetic"], "+2, Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }], desc: "A homing dart of force that rarely misses." }],
  ["Annihilating Beam", 16, ["kinetic"], "Pierce 2, Strain 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 2 }], desc: "A searing ray shears through armor and flesh together." }],
  ["Telekinetic Grasp", 17, ["kinetic"], "Grappled, Extend Range, Strain 1",
    { effects: [{ key: "stress" }, { key: "grappled" }, { key: "extendRange", bands: 1 }], desc: "An unseen hand seizes a body at range and holds it." }],
  ["Crushing Grip", 12, ["kinetic"], "Grappled",
    { effects: [{ key: "stress" }, { key: "grappled" }], desc: "Unseen hands clamp down and pin the target fast." }],
  ["Thunderclap", 12, ["kinetic"], "Move the target 1 band",
    { effects: [{ key: "stress" }, { key: "move" }], desc: "The air cracks and the target staggers back a band." }],
  ["Shockwave", 16, ["kinetic"], "Prone, Strain 1",
    { effects: [{ key: "stress" }, { key: "prone" }], desc: "Force hammers them off their feet." }],
  ["Grasp of Dread", 24, ["kinetic"], "Restrained, Strain 1",
    { effects: [{ key: "stress" }, { key: "restrained" }], desc: "Force roots the target in place, unable to flee." }],
  ["Cage of Force", 29, ["kinetic"], "Restrained, Extend Range, Strain 1",
    { effects: [{ key: "stress" }, { key: "restrained" }, { key: "extendRange", bands: 1 }], desc: "Bars of hard light snap shut and lock the target in place." }],
  ["Searing Cinders", 16, ["kinetic"], "Lingering 1, Strain 1",
    { effects: [{ key: "stress" }, { key: "lingering", magnitude: 1 }], desc: "Clinging embers gnaw for two rounds and bite past Resistance." }],
  ["Wall of Flame", 15, ["kinetic"], "Wall (Near), Upkeep",
    { effects: [{ key: "stress" }, { key: "pattern", pattern: "wall", bands: 2 }, { key: "upkeep" }], desc: "A standing curtain of fire that burns any who linger." }],
  ["Ember Storm", 16, ["kinetic"], "Lingering 1, Strain 1",
    { effects: [{ key: "stress" }, { key: "lingering", magnitude: 1 }], desc: "A burst of fire that lands hard and keeps burning." }],
  ["Hammer of Force", 20, ["kinetic"], "Pierce 1, Move the target 1 band, Strain 1",
    { effects: [{ key: "stress" }, { key: "pierce", magnitude: 1 }, { key: "move" }], desc: "A driving blow that punches through and knocks back." }],
  ["Cataclysmic Wave", 25, ["kinetic"], "Cone (Near), Move each target 1 band, Strain 1",
    { effects: [{ key: "stress" }, { key: "pattern", pattern: "cone", bands: 2 }, { key: "move" }], desc: "A shockwave of fire that scatters and burns all it reaches." }],
  ["Roaring Fireball", 44, ["kinetic"], "Radius (Near), Strain 2",
    { effects: [{ key: "stress" }, { key: "pattern", pattern: "radius", bands: 2 }], desc: "A bloom of fire swallows every foe it reaches." }],
  ["Concussive Repulsion", 52, ["kinetic"], "Radius (Near), Move each target 1 band, Strain 3",
    { effects: [{ key: "stress" }, { key: "pattern", pattern: "radius", bands: 2 }, { key: "move" }], desc: "A ring of force throws everyone nearby back a band." }],
  ["Devastating Detonation", 52, ["kinetic"], "Radius (Near), Pierce 1, Strain 3",
    { effects: [{ key: "stress" }, { key: "pattern", pattern: "radius", bands: 2 }, { key: "pierce", magnitude: 1 }], desc: "A detonation that rips armor apart and flattens a field." }],
  ["Seismic Slam", 56, ["kinetic"], "Prone, Radius (Near), Strain 3",
    { effects: [{ key: "stress" }, { key: "prone" }, { key: "pattern", pattern: "radius", bands: 2 }], desc: "The ground erupts, flattening everyone near." }],
  ["Phantom Step", 4, ["incorporeal"], "Evade",
    { effects: [{ key: "evade" }], desc: "You slip through the unseen and reappear a band away." }],
  ["Seed of Doubt", 14, ["incorporeal"], "-1 [target Attribute]",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }], desc: "A flicker of doubt dulls one Attribute." }],
  ["Ray of Enfeeblement", 20, ["incorporeal"], "-2 [target Attribute], Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }], desc: "A gray ray saps strength with no wound to show." }],
  ["Mark of Misfortune", 14, ["incorporeal"], "-1 [target Attribute]",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }], desc: "A brand of ill luck that wounds and drags an Attribute down." }],
  ["Hexing Bolt", 20, ["incorporeal"], "+2, Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }], desc: "A curse-dart that seldom misses its mark." }],
  ["Grievous Curse", 20, ["incorporeal"], "-2 [target Attribute], Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }], desc: "A deep curse that cripples an Attribute." }],
  ["Withering Blight", 16, ["incorporeal"], "Lingering 1, Strain 1",
    { effects: [{ key: "stress" }, { key: "lingering", magnitude: 1 }], desc: "A rot of the spirit that wears at the mind for two rounds." }],
  ["Deathly Touch", 16, ["incorporeal"], "Lingering 1, Strain 1",
    { effects: [{ key: "stress" }, { key: "lingering", magnitude: 1 }], desc: "A touch of death that bites now and festers after." }],
  ["Soul Leech", 16, ["incorporeal"], "Drain, Strain 1",
    { effects: [{ key: "stress" }, { key: "drain" }], desc: "You draw their vitality into yourself." }],
  ["Vampiric Blight", 28, ["incorporeal"], "Drain, Lingering 1, Strain 1",
    { effects: [{ key: "stress" }, { key: "drain" }, { key: "lingering", magnitude: 1 }], desc: "A rot that feeds you as it wastes them." }],
  ["Soul Harvest", 56, ["incorporeal"], "Drain, Radius (Near), Strain 3",
    { effects: [{ key: "stress" }, { key: "drain" }, { key: "pattern", pattern: "radius", bands: 2 }], desc: "You reap vitality from all around into yourself." }],
  ["Mirror Image", 16, ["incorporeal"], "Illusion, Strain 1",
    { effects: [{ key: "stress" }, { key: "illusion" }], desc: "Phantom doubles confuse the eye." }],
  ["Charm", 16, ["incorporeal"], "Charmed, Strain 1",
    { effects: [{ key: "stress" }, { key: "charmed" }], desc: "A whisper that bends their will to friendship." }],
  ["Phantasmal Killer", 26, ["incorporeal"], "Illusion, -1 [target Attribute], Strain 1",
    { effects: [{ key: "stress" }, { key: "illusion" }, { key: "mod", magnitude: 1 }], desc: "A vision of death that guts the mind that believes it." }],
  ["Creeping Dread", 12, ["incorporeal"], "Move the target 1 band",
    { effects: [{ key: "stress" }, { key: "move" }], desc: "Cold fear wounds the target and drives them back." }],
  ["Iron Command", 37, ["incorporeal"], "-4 Oppose, Extend Range, Strain 2",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 4 }, { key: "extendRange", bands: 1 }], desc: "Your will clamps down and freezes the target rigid." }],
  ["Cause Fear", 16, ["incorporeal"], "Frightened, Strain 1",
    { effects: [{ key: "stress" }, { key: "frightened" }], desc: "Terror that wounds and drives them back." }],
  ["Dominate", 32, ["incorporeal"], "Controlled, Strain 2",
    { effects: [{ key: "stress" }, { key: "controlled" }], desc: "You seize command of their body." }],
  ["Phantasmal Terror", 22, ["incorporeal"], "-1 [target Attribute], Move the target 1 band, Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }, { key: "move" }], desc: "Terror that wounds, weakens, and scatters." }],
  ["Waking Nightmare", 28, ["incorporeal"], "-2 [target Attribute], Move the target 1 band, Strain 1",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 2 }, { key: "move" }], desc: "A vision of horror that guts the will and sends them fleeing." }],
  ["Counterspell", 24, ["incorporeal"], "Counter, Strain 1",
    { effects: [{ key: "stress" }, { key: "counter" }], desc: "You unravel a Technique as it forms." }],
  ["Fog of Madness", 54, ["incorporeal"], "-1 [target Attribute], Radius (Near), Strain 3",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }, { key: "pattern", pattern: "radius", bands: 2 }], desc: "A creeping fog muddles the minds of all it catches." }],
  ["Mass Malediction", 54, ["incorporeal"], "-1 [target Attribute], Radius (Near), Strain 3",
    { effects: [{ key: "stress" }, { key: "mod", magnitude: 1 }, { key: "pattern", pattern: "radius", bands: 2 }], desc: "A curse that falls on a whole knot of foes at once." }],
  ["Force Ward", 8, ["fortifying"], "Resistance +1, physical or mental, self or ally",
    { floorOverride: 8, effects: [{ key: "resistance", magnitude: 1 }], desc: "A skin of force that turns aside a blow." }],
  ["Warding Stance", 8, ["fortifying"], "+1 to Prowess and Discipline opposes until your next turn",
    { floorOverride: 8, effects: [{ key: "mod", magnitude: 1 }], desc: "You steel your body against the physical world." }],
  ["Guiding Light", 8, ["fortifying"], "+1 to one ally",
    { floorOverride: 8, effects: [{ key: "mod", magnitude: 1 }], desc: "A glimmer of guidance steadies an ally's hand." }],
  ["Healing Word", 8, ["fortifying"], "Remove 1d6 Stress from an ally's Attribute, take 1d6 Stress yourself",
    { effects: [{ key: "mend", magnitude: 1 }], desc: "A knitting warmth that closes what conflict opened." }],
  ["Restoring Light", 12, ["fortifying"], "Remove 2d6 Stress from an ally's Attribute, take 2d6 Stress yourself",
    { effects: [{ key: "mend", magnitude: 2 }], desc: "A deep light that pulls an ally back from the edge." }],
  ["Quickening", 8, ["fortifying"], "Hasten +2 AP to an ally",
    { effects: [{ key: "hasten", magnitude: 2 }], desc: "Time bends to give an ally room to act." }],
  ["Rousing Haste", 18, ["fortifying"], "Hasten +2 AP to an ally and +1, Strain 1",
    { effects: [{ key: "hasten", magnitude: 2 }, { key: "mod", magnitude: 1 }], desc: "Speed and courage fill an ally at once." }],
  ["Rite of Blessing", 22, ["fortifying"], "+1 to up to 4 allies within Near (Selective), Strain 1",
    { effects: [{ key: "selective", selectiveN: 4, selectiveR: 2 }, { key: "mod", magnitude: 1 }], desc: "A wave of favor lifts every ally near." }],
  ["Hallowed Circle", 24, ["fortifying"], "Resistance +1 to up to 4 allies within Near (Selective), Upkeep, Strain 1",
    { effects: [{ key: "resistance", magnitude: 1 }, { key: "selective", selectiveN: 4, selectiveR: 2 }, { key: "upkeep" }],
      desc: "A ring of calm that shields allies who hold it." }],
  ["Aegis of Force", 20, ["fortifying"], "Resistance +1 to up to 4 allies within Near (Selective), Strain 1",
    { effects: [{ key: "selective", selectiveN: 4, selectiveR: 2 }, { key: "resistance", magnitude: 1 }], desc: "A dome of force hardens all beneath it." }],
  ["Renewing Tide", 24, ["fortifying"], "Remove 1d6 Stress from up to 4 allies within Near (Selective), take the summed Stress yourself, Strain 1",
    { effects: [{ key: "selective", selectiveN: 4, selectiveR: 2 }, { key: "mend", magnitude: 1 }], desc: "A tide of life eases the wounds of the whole line." }],
  ["Bulwark of Iron", 24, ["fortifying"], "Resistance +2 to up to 4 allies within Near (Selective), Strain 1",
    { effects: [{ key: "selective", selectiveN: 4, selectiveR: 2 }, { key: "resistance", magnitude: 2 }], desc: "A fortress of force hardens the allies deeply." }],
  ["Vanguard's Blessing", 30, ["fortifying"], "+1 and Resistance +1 to up to 4 allies within Near (Selective), Strain 1",
    { effects: [{ key: "mod", magnitude: 1 }, { key: "selective", selectiveN: 4, selectiveR: 2 }, { key: "resistance", magnitude: 1 }], desc: "Favor and force settle over the whole line at once." }],
  ["Fated Ward", 24, ["fortifying"], "Negate Failure, Strain 1",
    { effects: [{ key: "stress" }, { key: "negate" }], desc: "You will a failed Oppose into a success." }]
];

const priceFails = [];
function techniqueDoc([name, xp, requires, prose, opt]) {
  const decompose = opt.decompose !== false;
  // `opt.effects`: a hand-composed effect list for prose the auto-parser can't
  // read (e.g. "Reaction: Redirect an ally's Stress onto your Might" doesn't
  // match any regex below), still re-priced against the catalogue XP like an
  // auto-decomposed one — verified by hand, checked by the same self-check.
  const effects = opt.effects ?? [];
  const floorOverride = opt.floorOverride ?? 0;
  // `decompose: false` opts a row out of the self-check: it ships a composed effect
  // list for the sheet, but its catalogue XP is authoritative and is not re-derived.
  if (decompose) {
    const { xp: computed } = priceTechnique(effects, EFFECT_REG, { floorOverride });
    if (computed !== xp) priceFails.push(`${name}: catalogue ${xp}, computed ${computed}  [${prose}]`);
  }
  // aptitude/target/oppose are intentionally NOT written: the DataModel derives
  // them from the required Instrument Type(s) at prepare time (PHB §5.2.1).
  return {
    name, type: "technique", img: "icons/svg/aura.svg",
    system: {
      requires,
      effects: effects.map(e => ({
        key: e.key, magnitude: e.magnitude ?? 1, pattern: e.pattern ?? "single",
        bands: e.bands ?? 0, placement: e.placement ?? 0,
        selectiveN: e.selectiveN ?? 0, selectiveR: e.selectiveR ?? 0
      })),
      floorOverride,
      xpOverride: xp,          // authoritative catalogue value
      effectText: prose,
      description: opt.desc ?? ""
    }
  };
}

// ─── Instruments (PHB §7.2.x, §7.3.0, §2.5.3) ───────────────────────────────
const ARCANE = ["kinetic", "incorporeal", "fortifying"];
const SONIC = ["command", "guile", "resonance"];
const INSTRUMENTS = [
  ["Unarmed", "light", ["blunt", "grappling"], "Close", 0],
  ["Mouth", "light", SONIC, "Mid Range", 0],
  ["Dagger", "light", ["edged", "pointed", "parry"], "Close", 15],
  ["Hand Axe", "light", ["edged"], "Close", 10],
  ["Shortsword", "light", ["edged", "pointed", "parry"], "Close", 15],
  ["Sabre", "medium", ["edged", "parry"], "Close", 40],
  ["Quarterstaff", "medium", ["blunt", "blocking"], "Near", 15],
  ["Longsword", "medium", ["edged", "pointed", "parry"], "Close", 45],
  ["Spear", "medium", ["pointed", "parry"], "Near", 45],
  ["Mace", "medium", ["blunt"], "Close", 40],
  ["Battleaxe", "heavy", ["edged"], "Close", 130],
  ["Greatsword", "heavy", ["edged", "pointed"], "Close", 135],
  ["Maul", "heavy", ["blunt"], "Close", 130],
  ["Halberd", "heavy", ["edged", "pointed"], "Near", 140],
  ["Net", "light", ["grappling"], "Short Range", 15],
  // Ranged split into Thrown/Drawn/Fired by delivery method (PHB §7.11.1),
  // each with its own Bonus Attribute mix; Drawn and Fired both carry Reload.
  ["Throwing Knife", "light", ["pointed", "thrown"], "Short Range", 10],
  ["Sling", "light", ["thrown"], "Mid Range", 5],
  ["Shortbow", "medium", ["pointed", "drawn"], "Mid Range", 40, { reload: true }],
  ["Longbow", "medium", ["pointed", "drawn"], "Long Range", 50, { reload: true }],
  ["Crossbow", "medium", ["pointed", "fired"], "Long Range", 50, { reload: true }],
  ["Arbalest", "heavy", ["pointed", "fired"], "Long Range", 135, { reload: true }],
  ["Ward Focus", "light", ["blocking", "fortifying"], "Close", 15],
  // A Focus holds one channel (PHB §7.2.3); Wand ships Kinetic by default (the
  // catalogue's own "wand that casts Force Bolt" example, PHB §5.4.2) — edit
  // this Instrument's Types to Incorporeal or Fortifying for a different channel.
  ["Wand", "light", ["kinetic"], "Short Range", 15],
  ["Mending Focus", "light", ["fortifying"], "Short Range", 15],
  ["Magic Staff", "medium", ["kinetic", "incorporeal"], "Mid Range", 50],
  ["Holy Staff", "medium", ["fortifying"], "Mid Range", 45],
  ["Warstaff", "heavy", ["kinetic"], "Mid Range", 135],
  ["Grim Tome", "heavy", ["incorporeal"], "Mid Range", 135],
  ["Grand Staff", "heavy", ARCANE, "Long Range", 150],
  ["Lute", "light", ["performance", ...SONIC], "Mid Range", 14],
  ["Drum", "light", ["performance", ...SONIC], "Mid Range", 12],
  ["Flute", "light", ["performance", ...SONIC], "Mid Range", 10],
  ["Speaking Trumpet", "light", SONIC, "Long Range", 20],
  ["War Drum", "medium", ["performance", ...SONIC], "Long Range", 24],
  ["War Horn", "medium", SONIC, "Long Range", 50],
  ["Hunting Kit", "light", ["survival"], "Close", 10],
  ["Fishing Tackle", "light", ["survival"], "Close", 8],
  ["Trapper's Snares", "light", ["survival"], "Close", 10],
  ["Alchemist's Kit", "medium", ["alchemy"], "Close", 20],
  ["Herbalist's Satchel", "light", ["alchemy"], "Close", 12],
  ["Poisoner's Kit", "medium", ["alchemy"], "Close", 24],
  ["Smithing Tools", "medium", ["craft"], "Close", 20],
  ["Carpenter's Tools", "medium", ["craft"], "Close", 16],
  ["Leatherworker's Tools", "light", ["craft"], "Close", 14],
  ["Mason's Tools", "medium", ["craft"], "Close", 18],
  ["Jeweler's Tools", "light", ["craft"], "Close", 22],
  ["Tinkerer's Tools", "light", ["craft"], "Close", 14],
  ["Lockpicks", "light", ["subterfuge"], "Close", 10],
  ["Disguise Kit", "light", ["subterfuge"], "Close", 14],
  ["Writing Kit", "light", ["subterfuge"], "Close", 5],
  ["Climbing Kit", "light", ["athletics"], "Close", 10]
];
function instrumentDoc([name, weight, types, range, price, opt]) {
  return { name, type: "instrument", img: "icons/svg/sword.svg",
    system: { weight, range, price, types, reload: !!opt?.reload, description: "" } };
}

// ─── Equipment (PHB §7.5.x) ─────────────────────────────────────────────────
const q = (key, value = 0, param = "") => ({ key, value, param });
// [name, category, price, {weight, impairFinesse, qualities, effect, uses}]
const EQUIPMENT = [
  ["Leather", "armor", 30, { qualities: [q("resistance", 1, "might")] }],
  ["Mail", "armor", 90, { impairFinesse: 1, qualities: [q("resistance", 2, "might")] }],
  ["Half Plate", "armor", 270, { impairFinesse: 2, qualities: [q("resistance", 3, "might")] }],
  ["Full Plate", "armor", 800, { impairFinesse: 3, qualities: [q("resistance", 4, "might")] }],
  ["Fitted Leathers", "armor", 30, { qualities: [q("resistance", 1, "finesse")] }],
  ["Duelist's Coat", "armor", 90, { qualities: [q("resistance", 2, "finesse")] }],
  ["Buckler", "shield", 30, { weight: "light", qualities: [q("blocking"), q("bolster", 1, "prowess")], effect: "Easy to carry." }],
  ["Round Shield", "shield", 30, { weight: "light", qualities: [q("blocking"), q("resistance", 1, "might")] }],
  ["Kite Shield", "shield", 45, { weight: "medium", qualities: [q("blocking"), q("resistance", 1, "might"), q("bolster", 1, "prowess")] }],
  ["Tower Shield", "shield", 45, { weight: "medium", qualities: [q("blocking"), q("resistance", 2, "might")], effect: "Full-body cover." }],
  ["Warding Charm", "ward", 15, { qualities: [q("resistance", 1, "wit")], effect: "Steadies the thoughts." }],
  ["Icon of Faith", "ward", 15, { qualities: [q("resistance", 1, "presence")], effect: "Anchors a conviction." }],
  ["Stoic's Token", "ward", 15, { qualities: [q("resistance", 1, "presence")] }],
  ["Traveler Pack", "gear", 5, { effect: "Bedroll, rations, flint, waterskin." }],
  ["Rope (50ft)", "gear", 2, { effect: "Climbing, binding, hauling." }],
  ["Torch", "gear", 1, { effect: "Light in the dark." }],
  ["Bandages", "medicine", 3, { effect: "During a rest, remove an extra 1d6 Stress from one Attribute of one character.", uses: "1 (consumed)" }],
  ["Herbal Poultice", "medicine", 4, { effect: "Out of conflict, remove 1d6 Stress from one Attribute at once.", uses: "1 (consumed)" }],
  ["Healer's Kit", "medicine", 20, { effect: "During a rest, grant one character +1d6 recovery to each Attribute that hour.", uses: "5" }],
  ["Antitoxin", "medicine", 6, { effect: "Out of conflict, end one poison or sickness effect.", uses: "1 (consumed)" }],
  ["Healing Draught", "potion", 10, { effect: "Mend 1d6 (instant).", uses: "1" }],
  ["Greater Healing Draught", "potion", 15, { effect: "Mend 2d6 (instant).", uses: "1" }],
  ["Draught of Vigor", "potion", 5, { effect: "Bolster +1 to one Aptitude (1 hour).", uses: "1" }],
  ["Oil of Warding", "potion", 5, { effect: "Resistance +1 to one Attribute (1 hour).", uses: "1" }],
  ["Alchemist's Fire", "potion", 5, { effect: "Stress (Light), thrown (instant).", uses: "1" }],
  ["Vial of Venom", "potion", 10, { effect: "Lingering 1, coats a weapon (instant).", uses: "1" }],
  ["Draught of Weakness", "potion", 10, { effect: "Impair [Attribute] 2 (1 hour).", uses: "1" }]
];
const EQUIP_IMG = { armor: "icons/svg/shield.svg", shield: "icons/svg/shield.svg", ward: "icons/svg/holy-shield.svg", gear: "icons/svg/item-bag.svg", medicine: "icons/svg/heal.svg", potion: "icons/svg/potion.svg" };
function equipmentDoc([name, category, price, opt]) {
  return { name, type: "equipment", img: EQUIP_IMG[category] ?? "icons/svg/item-bag.svg",
    system: { category, weight: opt.weight ?? "", price, impairFinesse: opt.impairFinesse ?? 0,
      qualities: opt.qualities ?? [], uses: opt.uses ?? "", effect: opt.effect ?? "", description: "" } };
}

// ─── Feats, Backgrounds, Origins ────────────────────────────────────────────
// Two Feats per Ancestry (PHB 7.9.1-7.9.9). Names are the formal compound
// Ancestry titles. Gabrol Sandkin is the tenth Ancestry and has no Feats yet.
const ORIGIN_FEATS = [
  ["River Walk", "Keshwick Riverkin", "You learn the River Walk Technique. Evade (Acuity, no Instrument needed): move up to 20 feet without spending the normal Disengage AP and without provoking an Attack of Opportunity. If this repositions you to Close range of a foe, your next Technique against them this turn gains +2."],
  ["Bartering Culture", "Keshwick Riverkin", "+3 on Presence rolls. A people who grew up reading a stranger across a market stall read everyone else the same way."],
  ["Headbutt", "Guttabi Highlanders", "You learn the Headbutt Technique: Melee, Prone. Thick-skulled and low to the ground, a Guttabi headbutt drops most anyone."],
  ["Tough Hide", "Guttabi Highlanders", "Gain Physical Resistance +3 while you haven't moved since the start of your turn, stacking with Equipment Resistance."],
  ["Marked Prey", "Votwalder Woodlanders", "You learn the Marked Prey Technique: Ranged, +2, Pierce 1. A called shot from a hunter who never wastes an arrow."],
  ["Camouflaged Skin", "Votwalder Woodlanders", "+2 on Sneak rolls, and +2 on Techniques against any creature that has not yet acted this round. Mottled hide breaks your outline until the moment you choose to be seen."],
  ["Stonebreaker", "Tushmont Stonedwellers", "Your Blunt Techniques have +4 Pierce."],
  ["Tremor Sense", "Tushmont Stonedwellers", "+3 to Initiative rolls."],
  ["Cowing Rebuke", "Tuyakkar Frostlanders", "You learn the Cowing Rebuke Technique: Sonic, -3 Presence."],
  ["Dark Sight", "Tuyakkar Frostlanders", "+2 on Acuity rolls, and a further +3 on Acuity rolls made in darkness or poor light."],
  ["Fen Curse", "Maran Boglanders", "You learn the Fen Curse Technique: Ranged, Pierce 1, -2 [target Attribute]. A thrown dart tipped in bog-toxin."],
  ["Bog Sense", "Maran Boglanders", "+1 on Acuity rolls, and a further +3 to notice a trap or environmental hazard before it triggers."],
  ["Warding Chant", "Ngyenha Treedwellers", "You learn the Warding Chant Technique: Sonic, +1 to one Skill of your choice, for up to 3 allies within Near Range, until your next turn."],
  ["Wide Sight", "Ngyenha Treedwellers", "+3 on Acuity rolls, Initiative included. Nothing crosses the edge of a Ngyenha's vision unremarked."],
  ["Charge", "Tashtars Plainfolk", "When you move at least 20 feet and use a Melee Technique against a Target in the same turn, the target takes -4 to Oppose rolls for 1 round."],
  ["Relentless Blow", "Tashtars Plainfolk", "You learn the Relentless Blow Technique: Melee, Pierce 4. A strike with the weight of someone who's never once had to stop."],
  ["Salt-Toughened", "Shardani Islanders", "Gain Physical Resistance +1 while you have taken Stress this conflict, stacking with Equipment Resistance. Skin cured by salt and weather closes over a wound before it slows you."],
  ["Undertow", "Shardani Islanders", "You learn the Undertow Technique: Grappling, Prone, -1 [target Attribute]. A lifetime finding footing on rolling decks and shifting sand taught you how to take it out from under someone else."]
];
// XP costs rescaled 2026-07-28 (×0.8: 15→12, 30→24, 60→48). The Potential
// thresholds in "Requires" (12/16/18/20) are a separate axis, unaffected.
// A 5th tuple element, when present, is a hand-authored `modifiers` template
// (PHB §2.5.0 / src/modifiers.js aggregateModifiers()) for a Feat whose bonus
// is a flat, unconditional Training/Resistance grant. Every other Feat below
// is conditional prose (only applies in a stated circumstance) and correctly
// carries no modifiers — a flat entry would silently over-apply it everywhere.
const LEARNED_FEATS = [
  ["Tempered [Might]", 12, "12 Might", "Physical Resistance +1, stacking with Equipment Resistance. Calloused and heavy, unmoved by blows that would stagger someone lighter.",
    [{ type: "resistance", key: "might", value: 1 }]],
  ["Tempered [Finesse]", 12, "12 Finesse", "Physical Resistance +1, stacking with Equipment Resistance. Rarely hit square enough for a blow to matter.",
    [{ type: "resistance", key: "finesse", value: 1 }]],
  ["Tempered [Wit]", 12, "12 Wit", "Mental Resistance +1, stacking with Equipment Resistance. Doubt finds no purchase on a mind that's already reasoned its way past it.",
    [{ type: "resistance", key: "wit", value: 1 }]],
  ["Tempered [Presence]", 12, "12 Presence", "Mental Resistance +1, stacking with Equipment Resistance. Cruelty aimed at someone this certain of themselves lands soft.",
    [{ type: "resistance", key: "presence", value: 1 }]],
  ["Brawler", 12, "12 Might, 12 Finesse", "Your Techniques within Close range gain +1. You crowd a fight until there's nowhere left for a blow to miss."],
  ["Deadeye", 12, "12 Finesse, 12 Wit", "Your Techniques at Short Range or beyond gain +1. Every shot earns its aim before it earns its distance."],
  ["Silver Tongue", 12, "12 Wit, 12 Presence", "Your Techniques that target Wit or Presence gain +1. The right word finds the soft part of anyone's resolve."],
  ["Fleet", 12, "12 Finesse", "Closing all the way into Touching range costs no extra AP. Ground that slows everyone else barely touches your stride."],
  ["Vigilant", 12, "12 Finesse, 12 Wit", "Add +2 to your Acuity roll for Initiative. You're already moving before the moment asks you to."],
  ["Counterstrike", 12, "12 Might, 12 Finesse", "When you Oppose a melee Technique within Close range using Prowess and beat it, deal 1d4 Stress to the attacker's Might. Let them commit to the swing; that's when they're open."],
  ["Opportunist", 12, "12 Finesse, 12 Presence", "Enemies cannot Disengage from your Touching or Close reach; leaving it always provokes your Attack of Opportunity. Nobody leaves your reach on their own terms."],
  ["Lend Conviction", 48, "20 Presence", "Once per round, when an ally within Short Range fails a roll that includes Presence, add one of your Presence dice to their total; if the new total beats the opposition, their roll succeeds. Your certainty is loud enough to carry someone else's."],
  ["Overwhelm", 24, "16 Might, 16 Finesse, 16 Presence", "When you land a second Technique this round on an Attribute you already hit, that Technique gains Pierce 1. The first blow finds the gap. The second finds what's behind it."],
  ["Bodyguard", 12, "12 Might", "While you Guard an ally, once per round when a Technique lands on their Might or Finesse, redirect its Stress onto your Might, reduced by your physical Resistance. Whatever's coming for them goes through you first."],
  ["Bulwark", 24, "16 Might, 16 Wit", "When you Guard an ally, they gain +2 to their Opposes until the start of your next turn. Standing beside you is safer than standing alone."],
  ["Unbreakable", 48, "20 in all four", "When a Technique would bring an Attribute's Stress to its Potential, negate it; it deals 0 Stress. Once per conflict. Something in you refuses to go down on someone else's schedule."],
  ["Regeneration", 12, "12 in that Attribute", "At the start of each of your turns in conflict, recover 1d4 Stress from that Attribute, unless a GM-stated counter-condition (a damage type or Instrument fitting your story, fire for a troll, silver for some undead) applied that round."],
  ["Rejuvenation", 48, "20 in all four", "If you would be Destroyed, your Health instead returns to full after a GM-set span (typically 1d10 days) unless a stated counter-condition (a phylactery destroyed, a body burned and scattered, whatever anchors your return) is met first."],
  ["Hunter's Mark", 12, "12 Finesse, 12 Wit", "When using a Ranged Technique that deals Stress to the Target, deal +1 additional Stress. You don't miss twice, and the first shot was never really a miss."],
  ["Heavy Hand", 12, "12 Might, 12 Finesse", "When using a Melee Technique that deals Stress to the Target, deal +1 additional Stress. Every swing carries a little more than it needs to."],
  ["Focused Blast", 12, "12 Might, 12 Presence", "When using a Kinetic Technique that deals Stress to the Target, deal +1 additional Stress. You've learned exactly where force does the most damage."],
  ["Cutting Word", 12, "12 Finesse, 12 Presence", "When using a Sonic Technique that deals Stress to the Target, deal +1 additional Stress. Words aimed well don't need to be loud."],
  ["Cruel Whisper", 12, "12 Wit, 12 Presence", "When using an Incorporeal Technique that deals Stress to the Target, deal +1 additional Stress."],
  ["Slipstream", 12, "12 Might, 12 Finesse", "When using a Melee Technique, you may Move yourself one range (up to Short Range) for no AP cost."]
];
function originFeatDoc([name, origin, effect]) {
  return { name, type: "feat", img: "icons/svg/upgrade.svg", system: { featKind: "origin", xpCost: 0, origin, requirements: "", effect, description: "" } };
}
function learnedFeatDoc([name, xp, requirements, effect, modifiers]) {
  return { name, type: "feat", img: "icons/svg/upgrade.svg", system: { featKind: "learned", xpCost: xp, origin: "", requirements, effect, modifiers: modifiers ?? [], description: "" } };
}

const APT_KEYS = ["prowess", "fortitude", "command", "acuity", "guile", "resonance"];
const BACKGROUNDS = [
  ["Soldier", ["prowess", "fortitude", "command"], "Longsword, Leather armor, Traveler Pack.", "Veterans who rely on strict discipline and tactical coordination to survive mass combat."],
  ["Scout", ["prowess", "acuity", "guile"], "Shortbow, Fitted Leathers, Rope (50ft).", "Forward observers who map unfamiliar terrain and identify hidden threats."],
  ["Scholar", ["fortitude", "acuity", "resonance"], "Wand, Fitted Leathers, Writing Kit.", "Academic researchers leveraging deep reservoirs of historical and theoretical knowledge."],
  ["Courtier", ["command", "guile", "resonance"], "Dagger, Fitted Leathers, Lute.", "Political operators manipulating alliances and social influence within the halls of power."],
  ["Hunter", ["prowess", "fortitude", "acuity"], "Longbow, Fitted Leathers, Hunting Kit.", "Wilderness experts using acute survival instincts to pursue evasive quarry."],
  ["Duelist", ["prowess", "command", "guile"], "Sabre, Fitted Leathers, Traveler Pack.", "Specialized combatants resolving disputes through precise and ritualized single combat."],
  ["Zealot", ["fortitude", "command", "resonance"], "Mace, Leather armor, Icon of Faith.", "Driven fundamentalists projecting their unwavering dogma into every conflict."],
  ["Diplomat", ["acuity", "guile", "resonance"], "Dagger, Fitted Leathers, Traveler Pack.", "Official state representatives brokering treaties to manage fragile international relations."]
];
function backgroundDoc([name, apts, kit, desc]) {
  const training = {}; for (const k of APT_KEYS) training[k] = apts.includes(k) ? 1 : 0;
  return { name, type: "background", img: "icons/svg/book.svg", system: { training, equipmentKit: kit, description: desc } };
}
const ORIGINS = [
  ["Keshwick Riverkin", "River Walk", "Thriving along silty floodplains, these river merchants build prosperous networks connecting inland communities to the coast."],
  ["Guttabi Highlanders", "Headbutt", "Isolated by terraced highlands, independent pastoral clans drive their herds across steep and stony pastures."],
  ["Votwalder Woodlanders", "Marked Prey", "Dwelling in shadowed old-growth woodlands, these insular communities rely on ancestral hunting grounds and fortified earthworks."],
  ["Tushmont Stonedwellers", "Stonebreaker", "Carving monumental strongholds into the highest peaks, these alpine architects command vast mineral wealth and unyielding defenses."],
  ["Tuyakkar Frostlanders", "Cowing Rebuke", "Enduring a landscape of unforgiving permafrost, tight-knit bands pass down harsh traditions of collective survival."],
  ["Maran Boglanders", "Fen Curse", "Building stilt-villages over tidal bogs, these reclusive settlers cultivate rare marsh flora and preserve superstitious folklore."],
  ["Ngyenha Treedwellers", "Warding Chant", "Surrounded by impenetrable tropical canopies, elaborate societies thrive on wet-rice agriculture and intricate communal ceremonies."],
  ["Tashtars Plainfolk", "Charge", "Roaming the endless expanse of the grassy steppe, this mobile equestrian society moves in tandem with massive grazing herds."],
  ["Shardani Islanders", "Salt-Toughened", "Originating from windswept archipelagos, these maritime republics exert influence through naval supremacy and deep-water trade."]
];
function originDoc([name, feat, desc]) {
  return { name, type: "origin", img: "icons/svg/village.svg", system: { feat, description: desc } };
}

// ─── Writer ─────────────────────────────────────────────────────────────────
function finalize(doc, sort) {
  const _id = makeId();
  return [`!items!${_id}`, { _id, ...doc, effects: [], folder: null, sort, ownership: { default: 0 }, flags: {}, _stats: { ...STATS } }];
}
/**
 * JournalEntry packs store their pages as separate embedded documents, keyed
 * `!journal.pages!{journalId}.{pageId}`, so a journal is written as one entry
 * plus one row per page rather than a single nested document.
 */
async function writeGuidePack(packName, journals) {
  const db = new ClassicLevel(`${PACK_ROOT}/${packName}`, { valueEncoding: "json" });
  await db.open();
  const old = [];
  for await (const key of db.keys()) if (key.startsWith("!journal")) old.push(key);
  if (old.length) await db.batch(old.map(key => ({ type: "del", key })));

  const ops = [];
  journals.forEach((j, ji) => {
    const jid = makeId();
    const pageIds = j.pages.map(() => makeId());
    ops.push({ type: "put", key: `!journal!${jid}`, value: {
      _id: jid, name: j.name, pages: [], folder: null, sort: (ji + 1) * 100000,
      ownership: { default: 2 }, flags: {}, _stats: { ...STATS }
    }});
    j.pages.forEach((pg, pi) => {
      const pid = pageIds[pi];
      ops.push({ type: "put", key: `!journal.pages!${jid}.${pid}`, value: {
        _id: pid, name: pg.name, type: "text",
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
  const db = new ClassicLevel(`${PACK_ROOT}/${packName}`, { valueEncoding: "json" });
  await db.open();
  const oldKeys = [];
  for await (const key of db.keys({ gte: "!items!", lt: "!items!￿" })) oldKeys.push(key);
  if (oldKeys.length) await db.batch(oldKeys.map(key => ({ type: "del", key })));
  const ops = docs.map((doc, i) => { const [key, value] = finalize(doc, (i + 1) * 100000); return { type: "put", key, value }; });
  await db.batch(ops);
  await db.close();
  console.log(`  ${packName}: wrote ${ops.length} items (cleared ${oldKeys.length}).`);
}

console.log("FOIL | Seeding vocabulary + catalogue packs…");
await writePack("instrument-types", INSTRUMENT_TYPES.map(instrumentTypeDoc));
await writePack("qualities", QUALITIES.map(qualityDoc));
await writePack("effects", EFFECTS.map(effectDoc));
const techDocs = TECHNIQUES.map(techniqueDoc);
await writePack("instruments", INSTRUMENTS.map(instrumentDoc));
await writePack("techniques", techDocs);
await writePack("feats", [...ORIGIN_FEATS.map(originFeatDoc), ...LEARNED_FEATS.map(learnedFeatDoc)]);
await writePack("equipment", EQUIPMENT.map(equipmentDoc));
await writePack("backgrounds", BACKGROUNDS.map(backgroundDoc));
await writePack("origins", ORIGINS.map(originDoc));
await writeGuidePack("guide", GUIDE);

const decomposed = TECHNIQUES.filter(t => t[4].effects && t[4].decompose !== false).length;
if (priceFails.length) {
  console.log(`\nPRICING MISMATCHES (${priceFails.length}/${decomposed} decomposed techniques):`);
  for (const m of priceFails) console.log("  " + m);
} else {
  console.log(`\nPricing self-check: all ${decomposed} decomposed techniques match the catalogue XP.`);
}

// Aptitude/Target/Oppose are derived from the required Instrument Type(s). Verify
// every technique either names no Type (a Skill → "varies" prompt at roll) or
// names Types that all resolve, yielding a non-empty Aptitude set. This is what
// keeps rolls working now that aptitude is no longer stored per Technique.
const TYPE_APT = Object.fromEntries(INSTRUMENT_TYPES.map(t => [slug(t[0]), t[1]]));
const aptFails = [];
for (const [name, , requires] of TECHNIQUES) {
  if (!requires.length) continue;                 // Skill w/o Tool → prompts
  const bad = requires.filter(k => !(k in TYPE_APT));
  if (bad.length) aptFails.push(`${name}: unknown Instrument Type(s) ${bad.join(", ")}`);
  else if (!requires.some(k => TYPE_APT[k])) aptFails.push(`${name}: requires resolve to no Aptitude`);
}
if (aptFails.length) {
  console.log(`\nAPTITUDE-DERIVATION FAILURES (${aptFails.length}):`);
  for (const m of aptFails) console.log("  " + m);
} else {
  console.log(`Aptitude derivation: all ${TECHNIQUES.length} techniques resolve their required Instrument Type(s).`);
}
console.log("FOIL | Done.");
