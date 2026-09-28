/**
 * src/constants.js
 * Shared constants: the fixed spine of the system (Attributes, Aptitude pairs,
 * Weight profiles). The *extensible* vocabulary — Instrument Types, Qualities,
 * Effects — is NOT here; it lives in the registry (src/registry.js), built from
 * authorable definition documents.
 */

export const ATTRIBUTE_KEYS = ["might", "finesse", "wit", "presence"];

export const ATTR_LABEL = {
  might: "Might", finesse: "Finesse", wit: "Wit", presence: "Presence"
};

// Each Aptitude is the pair of Attributes that feed it (rulebook 2.2.0).
export const APTITUDE_ATTRS = {
  prowess:   ["might", "finesse"],
  fortitude: ["might", "wit"],
  command:   ["might", "presence"],
  acuity:    ["finesse", "wit"],
  guile:     ["finesse", "presence"],
  resonance: ["wit", "presence"]
};

export const APT_LABEL = {
  prowess: "Prowess", fortitude: "Fortitude", command: "Command",
  acuity: "Acuity", guile: "Guile", resonance: "Resonance"
};

export const APTITUDE_KEYS = Object.keys(APTITUDE_ATTRS);

// Weight → how much of a landed Technique's margin becomes Stress, and the
// base AP a Technique costs through it (PHB §5.2.1). There is no Stress die
// and no minimum: Light takes half the margin rounding up, Medium the whole
// margin, Heavy the margin plus half again rounding down.
// `mult` is how Weight is written everywhere it appears as a label or a
// reference. The longhand ("the margin plus half again") belongs only where the
// rule is first taught, in PHB §5.2.1.
export const WEIGHT_PROFILE = {
  light:  { term: m => Math.ceil(m / 2),      label: "Light",  mult: "0.5x", baseAP: 1 },
  medium: { term: m => m,                     label: "Medium", mult: "1.0x", baseAP: 2 },
  heavy:  { term: m => m + Math.floor(m / 2), label: "Heavy",  mult: "1.5x", baseAP: 3 }
};

export const WEIGHT_KEYS = Object.keys(WEIGHT_PROFILE);

export const RANGE_BANDS = ["Touching", "Close", "Near", "Short Range", "Mid Range", "Long Range", "Sight"];

// Instrument Types that can target a creature offensively (PHB §7.4.0): an
// Instrument carrying one of these keeps the ordinary Accuracy/Pierce +N
// bonus even if it also carries Blocking (e.g. a Quarterstaff). Ranged split
// into Thrown/Drawn/Fired subtypes (PHB §7.11.1); all three replace it here.
export const ATTACK_TYPES = ["edged", "pointed", "blunt", "grappling", "thrown", "drawn", "fired"];

// The subset of ATTACK_TYPES whose +N also grants Pierce +N (PHB §7.4.0:
// "A Melee or Ranged Instrument also grants Pierce +N" — Grappling doesn't).
export const PIERCE_TYPES = ["edged", "pointed", "blunt", "thrown", "drawn", "fired"];

export const EQUIPMENT_CATEGORY_LABEL = {
  armor: "Armor", shield: "Shield", ward: "Ward", gear: "Gear",
  medicine: "Medicine", potion: "Potion"
};

// Materials (PHB §7.4.2, §5.4.1): six categories, Tier 0-5, Scarcity price
// multiplier. Category/Tier are the mechanical axes; the named material
// (Iron, Mithril, Ebony...) is fiction-only and not tracked here.
export const MATERIAL_CATEGORIES = ["metal", "wood", "gemstone", "cloth", "leather", "reagent"];

export const MATERIAL_CATEGORY_LABEL = {
  metal: "Metal", wood: "Wood", gemstone: "Gemstone",
  cloth: "Cloth", leather: "Leather", reagent: "Reagent"
};

export const MATERIAL_SCARCITY_KEYS = ["common", "uncommon", "rare", "exotic"];

export const MATERIAL_SCARCITY_LABEL = {
  common: "Common", uncommon: "Uncommon", rare: "Rare", exotic: "Exotic"
};

// Price multiplier by Scarcity (GMG §8.1.0).
export const MATERIAL_SCARCITY_MULT = {
  common: 1, uncommon: 1.5, rare: 2, exotic: 3
};

// Standard ladder price by Tier, index = tier (GMG §8.1.0 / PHB §5.4.1).
export const MATERIAL_TIER_PRICE = [0, 15, 45, 135, 400, 1200];

// Resistance is physical (Might + Finesse) or mental (Wit + Presence),
// one value each rather than one per Attribute (PHB §6.6.0).
export const RESISTANCE_KINDS = ["physical", "mental"];
export const RESISTANCE_LABEL = { physical: "Physical", mental: "Mental" };
export const ATTRIBUTE_KIND = { might: "physical", finesse: "physical", wit: "mental", presence: "mental" };

// What a creature does when an Attribute is Incapacitated (GMG §4.1.0). Declarative, never rolled.
export const BEHAVIOR_TRAITS = [
  "craven", "simpleminded", "disciplined", "packBound", "opportunist",
  "territorial", "venal", "zealous", "mindless", "bound", "emboldening"
];
export const BEHAVIOR_LABEL = {
  craven: "Craven", simpleminded: "Simpleminded", disciplined: "Disciplined [commander]",
  packBound: "Pack-Bound [pack]", opportunist: "Opportunist", territorial: "Territorial [place]",
  venal: "Venal", zealous: "Zealous", mindless: "Mindless", bound: "Bound [binding]",
  emboldening: "Emboldening"
};

export const cap = s => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "";
