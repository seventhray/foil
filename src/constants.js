/**
 * src/constants.js
 * The fixed spine of the system, matching the Foilbound 0.6.0 rules. The
 * extensible vocabulary (Instrument Types, Qualities, Effects) lives in the
 * registry (src/registry.js), built from authorable definition documents.
 */

export const ATTRIBUTE_KEYS = ["might", "finesse", "wit", "presence"];

export const ATTR_LABEL = {
  might: "Might", finesse: "Finesse", wit: "Wit", presence: "Presence"
};

// Physical Attributes are Might and Finesse; mental are Wit and Presence (PHB 4.1.2).
export const ATTRIBUTE_KIND = { might: "physical", finesse: "physical", wit: "mental", presence: "mental" };

// Each Skill rolls the pair of Attributes that feed it (PHB 2.2.0).
export const SKILL_ATTRS = {
  prowess:       ["might", "finesse"],
  discipline:    ["might", "wit"],
  assertiveness: ["might", "presence"],
  acuity:        ["finesse", "wit"],
  guile:         ["finesse", "presence"],
  resonance:     ["wit", "presence"]
};

export const SKILL_KEYS = Object.keys(SKILL_ATTRS);

export const SKILL_LABEL = {
  prowess: "Prowess", discipline: "Discipline", assertiveness: "Assertiveness",
  acuity: "Acuity", guile: "Guile", resonance: "Resonance"
};

export const SKILL_ABBR = {
  prowess: "PW", discipline: "DI", assertiveness: "AS", acuity: "AC", guile: "GL", resonance: "RS"
};

// A Primary Attribute allows the three Skills built on it (PHB 4.1.0, 7.10.0).
export const PRIMARY_SKILLS = Object.fromEntries(ATTRIBUTE_KEYS.map(a =>
  [a, SKILL_KEYS.filter(s => SKILL_ATTRS[s].includes(a))]));

// Pre-0.6.0 worlds named two Skills differently and called them Aptitudes.
export const LEGACY_SKILL_KEY = { fortitude: "discipline", command: "assertiveness" };


// Weight class sets an Instrument's base price and carried weight only (PHB 5.2.2, 5.2.6).
// Weight class (PHB 4.1.2, 5.2.2): base price, carried weight, and the dice it adds to a
// Technique used against a target (never an Oppose, support, or Trade). Heavy takes both hands.
export const WEIGHT_CLASS = {
  light:  { label: "Light",  price: 15,  lbs: 2, dice: "", mult: 1 },
  medium: { label: "Medium", price: 30,  lbs: 4, dice: "", mult: 1.5 },  // margin x1.5, rounded down (PHB 4.1.2)
  heavy:  { label: "Heavy",  price: 45,  lbs: 8, dice: "", mult: 2 }    // margin x2; takes the Action and the Quick Action (PHB 4.1.2)
};
export const WEIGHT_KEYS = Object.keys(WEIGHT_CLASS);

// Range bands, in order; a range includes those under it (PHB 4.1.3).
export const RANGE_BANDS = ["touching", "close", "near", "short", "mid", "long", "sight"];
export const RANGE_LABEL = {
  touching: "Touching", close: "Close", near: "Near", short: "Short",
  mid: "Mid", long: "Long", sight: "Sight"
};
export const RANGE_FEET = {
  touching: "0-4 ft", close: "5-9 ft", near: "10-19 ft", short: "20-39 ft",
  mid: "40-99 ft", long: "100-299 ft", sight: "300 ft +"
};

/** The furthest band a free-text range names ("Touching to Close" -> close). */
export function rangeBandOf(text) {
  const words = String(text ?? "").toLowerCase().match(/[a-z]+/g) ?? [];
  let best = -1;
  for (const w of words) best = Math.max(best, RANGE_BANDS.indexOf(w));
  return best >= 0 ? RANGE_BANDS[best] : "";
}

// Instrument price surcharges by Instrument Type, and reach pricing (PHB 5.2.2).
export const TYPE_SURCHARGE = {
  edged: 5, blunt: 5, kinetic: 5, incorporeal: 5, fortifying: 5, pointed: 10, drawn: 25, fired: 50
};
export const REACH_PRICE_PER_BAND = 10;

/** The usual Range for an Instrument's kind; reach past it adds 10p a band (PHB 5.2.2). */
export function usualRange(category, weight, types = []) {
  if (category === "melee") return "close";
  if (types.includes("fired")) return "long";
  if (types.includes("drawn")) return "mid";
  if (category === "ranged") return "short";
  if (category === "sonic") return "mid";
  return weight === "light" ? "short" : "mid";
}

// Item size sets crafting batches (PHB 5.3.2) and the +N bonus price (PHB 5.2.2).
// A Large item crafts from 3 batches but its bonus price stays at 4 batches' worth.
export const SIZE = {
  small:  { label: "Small",  batches: 1 },
  medium: { label: "Medium", batches: 2 },
  large:  { label: "Large",  batches: 3 }
};
export const SIZE_KEYS = Object.keys(SIZE);
export const BONUS_PRICE = {
  small:  [0, 8, 23, 68, 200, 600],
  medium: [0, 15, 45, 135, 400, 1200],
  large:  [0, 30, 90, 270, 800, 2400]
};

// Materials (PHB 5.3.1, 7.4.2): Tier price by Scarcity. The named material is description.
export const MATERIAL_CATEGORIES = ["metal", "gemstone", "wood", "textile", "leather", "reagent", "stone"];
export const MATERIAL_CATEGORY_LABEL = {
  metal: "Metal", gemstone: "Gemstone", wood: "Wood", textile: "Textile",
  leather: "Leather", reagent: "Reagent", stone: "Stone"
};
export const MATERIAL_TIER_PRICE = [2, 8, 23, 68, 200, 600];
export const MATERIAL_SCARCITY_KEYS = ["common", "uncommon", "rare", "exotic"];
export const MATERIAL_SCARCITY_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", exotic: "Exotic" };
export const MATERIAL_SCARCITY_MULT = { common: 1, uncommon: 1.5, rare: 2, exotic: 3 };

// Resistance is physical (Might + Finesse) or mental (Wit + Presence) (PHB 6.6.0).
export const RESISTANCE_KINDS = ["physical", "mental"];
export const RESISTANCE_LABEL = { physical: "Physical", mental: "Mental" };

// Damage types (PHB 4.1.2): what a creature can be Vulnerable or resistant to by name.
export const DAMAGE_TYPES = {
  edged: "physical", pointed: "physical", blunt: "physical",
  thermal: "physical", concussive: "physical", corrosive: "physical",
  spiritual: "mental", psychic: "mental", entropic: "mental"
};

// Focus Gems (PHB 5.2.3): Arcane Instruments only; each adds its Tier to one Effect.
export const FOCUS_GEMS = {
  ruby:      { label: "Ruby",      damageType: "thermal",    adds: "Lingering +1",                                 pricePerTier: 80 },
  carnelian: { label: "Carnelian", damageType: "concussive", adds: "Move goes 1 more band",                        pricePerTier: 40 },
  emerald:   { label: "Emerald",   damageType: "corrosive",  adds: "Pierce +1",                                    pricePerTier: 40 },
  sapphire:  { label: "Sapphire",  damageType: "psychic",    adds: "Illusion: -1 to the Oppose to see through it", pricePerTier: 60 },
  amethyst:  { label: "Amethyst",  damageType: "spiritual",  adds: "Condition: -1 to the Oppose against it",       pricePerTier: 60 },
  tanzanite: { label: "Tanzanite", damageType: "entropic",   adds: "Drain heals 1 more",                           pricePerTier: 60 },
  citrine:   { label: "Citrine",   damageType: "",           adds: "Mend removes 1 more Stress",                   pricePerTier: 60 },
  diamond:   { label: "Diamond",   damageType: "",           adds: "Resistance it grants +1",                      pricePerTier: 40 }
};

export const EQUIPMENT_CATEGORY_LABEL = {
  armor: "Armor", shield: "Shield", ward: "Ward", charm: "Charm", gear: "Gear",
  medicine: "Medicine", potion: "Poison or Throwable", gem: "Focus Gem"
};
export const EQUIPMENT_CATEGORIES = Object.keys(EQUIPMENT_CATEGORY_LABEL);

// FOIL axes and their poles (PHB 3.1.0). A Habit leans High, Low, or Neutral (PHB 3.4.0).
export const FOIL_AXES = [
  { key: "faith",         label: "Faith",         high: "Trusting",   low: "Mistrusting" },
  { key: "order",         label: "Order",         high: "Ordered",    low: "Disordered" },
  { key: "individualism", label: "Individualism", high: "Individual", low: "Communal" },
  { key: "levity",        label: "Levity",        high: "Light",      low: "Grave" }
];
export const FOIL_LEANS = ["", "low", "neutral", "high"];
export const FOIL_TOKEN_MAX = 4;

// Conditions (PHB 6.8.3-6.8.21), for the active-conditions tracker.
export const CONDITIONS = [
  "Grappled", "Weakened", "Restrained", "Reeling", "Prone", "Charmed", "Frightened",
  "Controlled", "Intimidated", "Baited", "Angered", "Relaxed", "Impressed", "Wary",
  "Enthralled", "Swayed", "Misled", "Blinded", "Slowed"
];
/** The two Skills that resist each Condition when a Technique deals no Stress (PHB 6.5.0, 6.8.x). */
export const CONDITION_OPPOSE = {
  Grappled: ["prowess", "discipline"], Restrained: ["prowess", "discipline"], Prone: ["prowess", "acuity"],
  Slowed: ["prowess", "discipline"], Blinded: ["acuity", "discipline"], Reeling: ["acuity", "discipline"],
  Swayed: ["acuity", "resonance"], Misled: ["acuity", "guile"], Frightened: ["discipline", "resonance"],
  Controlled: ["discipline", "resonance"], Baited: ["discipline", "acuity"], Intimidated: ["assertiveness", "resonance"],
  Impressed: ["assertiveness", "acuity"], Relaxed: ["guile", "discipline"], Charmed: ["resonance", "acuity"],
  Enthralled: ["resonance", "discipline"], Angered: ["resonance", "discipline"]
};

// Mass (PHB 5.2.6): past 4x Might Potential, -1 to rolls per multiple.
export const CARRY_FREE_MULTIPLE = 4;
export const RATION_LBS = 2;

// Rest (PHB 6.10.0): 1d4 per 2 hours, one ration per 8 hours.
export const REST_BLOCK_HOURS = 2;
export const REST_RATION_HOURS = 8;

// Advancement costs (PHB 2.3.0).
// Advancement (PHB 2.3.0). A Talent step costs by the die's current size; d12 to d20
// is a Transformation (PHB 2.3.1, 7.12.0). Training climbs 2 per point already held.
export const XP_COST = { talent: { 4: 8, 6: 12, 8: 16, 10: 20 }, d12ToD20: 100, knowHow: 20, training: 8, trainingStep: 2 };
export const DICE_BASE_LIMIT = 4;
/** Margin cap as a share of the Primary Attribute's Potential, by weight; a Quick Action attack caps at a quarter (PHB 6.7.0). */
export const MARGIN_CAP = { light: [1, 2, "half"], medium: [3, 4, "three quarters of"], heavy: [1, 1, "all of"], quick: [1, 4, "a quarter of"] };
export const marginCap = (potential, key) => {
  const [n, d] = MARGIN_CAP[key] ?? MARGIN_CAP.light;
  return Math.floor((Number(potential) || 0) * n / d);
};
export const trainingCost = held => XP_COST.training + XP_COST.trainingStep * Math.max(0, Number(held) || 0);
/** An Attribute holds at most 4 dice, plus 1 per die at d12 or larger (PHB 2.3.0). */
export function knowHowState(dice = {}) {
  const held = Object.values(dice).reduce((n, c) => n + (Number(c) || 0), 0);
  const limit = DICE_BASE_LIMIT + Number(dice.d12 ?? 0) + Number(dice.d20 ?? 0);
  return { held, limit, atLimit: held >= limit };
}

// Behavior Traits (GMG 4.8.0). Declarative, never rolled.
export const BEHAVIOR_TRAITS = [
  "Craven", "Simpleminded", "Disciplined [commander]", "Pack-Bound [pack]", "Opportunist",
  "Territorial [place]", "Venal", "Zealous", "Mindless", "Bound [binding]"
];

export const cap = s => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "";

// Where an item is (PHB 4.1.0, 5.2.6): equipped (worn, or in hand and ready), carried
// (on the character, not ready), or stored (left behind, no weight).
export const ITEM_LOCATIONS = ["equipped", "carried", "stored"];
export const LOCATION_LABEL = { equipped: "Equipped", carried: "Carried", stored: "Stored" };
