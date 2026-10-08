/**
 * src/data/item-models.js
 * DataModels for the content items (Foilbound 0.6.0): instrument, technique,
 * equipment, feat, background, and origin (shown as Origin). Instruments and
 * Techniques reference the authorable vocabulary by slug through the registry;
 * registry-dependent values are derived when the registry is ready, and the
 * registry re-prepares these items once it finishes loading.
 */

import { f, slugField, slugArray, str, int, bool, html } from "./fields.js";
import {
  WEIGHT_CLASS, WEIGHT_KEYS, ATTRIBUTE_KEYS, SKILL_KEYS, PRIMARY_SKILLS, SIZE_KEYS, BONUS_PRICE,
  MATERIAL_TIER_PRICE, SIZE, TYPE_SURCHARGE, REACH_PRICE_PER_BAND, RANGE_BANDS, rangeBandOf, usualRange,
  FOCUS_GEMS, EQUIPMENT_CATEGORIES, LEGACY_SKILL_KEY, ITEM_LOCATIONS
} from "../constants.js";
import { priceTechnique, strainFor, SELECTIVE_PREMIUM } from "../pricing.js";
import { LEGACY_TYPE_KEY } from "./definition-models.js";

const INSTRUMENT_CATEGORIES = ["melee", "ranged", "arcane", "sonic", "tool", "innate"];
const ARCANE_TYPES = ["kinetic", "incorporeal", "fortifying"];
const GEM_KEYS = ["", ...Object.keys(FOCUS_GEMS)];

const mapTypes = arr => [...new Set((arr ?? []).map(t => LEGACY_TYPE_KEY[t] ?? t))];

/** Composed-effects schema, shared by a Technique and an Instrument's Enchantment. */
function effectsArraySchema() {
  return new f.ArrayField(new f.SchemaField({
    key: slugField(""),
    magnitude: int(1),
    pattern: str("single"),
    bands: int(0),
    placement: int(0),
    selectiveR: int(0),
    // How long a Condition Effect lasts; blank is the rulebook default (PHB 6.8.0).
    duration: str("")
  }));
}

function sizeField(initial = "medium") {
  return new f.StringField({ required: true, initial, choices: SIZE_KEYS });
}

/** The Instrument Types an item carries, resolved against the registry. */
function resolveTypes(types) {
  const reg = globalThis.CONFIG?.FOIL?.instrumentTypes ?? {};
  return { reg, defs: types.map(k => reg[k]).filter(Boolean), unknown: types.filter(k => !reg[k]) };
}

export class InstrumentData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    if (source?.types) source.types = mapTypes(source.types);
    if (source && "weight" in source && !WEIGHT_KEYS.includes(source.weight)) source.weight = "light";
    if (source?.location === "stored") source.location = "carried";
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      category: new f.StringField({ required: true, initial: "melee", choices: INSTRUMENT_CATEGORIES }),
      weight: new f.StringField({ required: true, initial: "light", choices: WEIGHT_KEYS }),
      primaryAttribute: new f.StringField({ required: true, initial: "might", choices: ATTRIBUTE_KEYS }),
      range: str("Close"),
      types: slugArray(),
      // Verbatim Types line when it isn't a plain list (a Wand's "or Fortifying (pick one)").
      typesDisplay: str(""),
      price: int(0),
      rider: str(""),
      // Three built-in Techniques, one per Skill its Primary Attribute reaches (PHB 7.2.0).
      kit: new f.ArrayField(new f.SchemaField({
        name: str(""),
        skill: new f.StringField({ required: true, initial: "prowess", choices: SKILL_KEYS }),
        effect: str("")
      })),
      // Body and Voice: every character knows them, free (PHB 2.5.3).
      innate: bool(false),
      // Equipped (ready) or carried (PHB 4.1.0, 5.2.6). Innate Instruments are always equipped.
      location: new f.StringField({ required: true, initial: "equipped", choices: ITEM_LOCATIONS }),
      bonus: new f.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 5 }),
      size: sizeField("medium"),
      materials: str(""),
      // One Focus Gem slot on an Arcane Instrument (PHB 5.2.3).
      gem: new f.SchemaField({
        type: new f.StringField({ required: true, blank: true, initial: "", choices: GEM_KEYS }),
        tier: new f.NumberField({ required: true, integer: true, initial: 1, min: 1, max: 5 })
      }),
      // A Technique effect bound to the item (PHB 5.3.4).
      enchantment: new f.SchemaField({
        enabled: bool(false),
        effects: effectsArraySchema(),
        effectText: str("")
      }),
      description: html("")
    };
  }

  prepareDerivedData() {
    const types = this.types ?? [];
    const { defs, unknown } = resolveTypes(types);
    const w = WEIGHT_CLASS[this.weight] ?? WEIGHT_CLASS.light;
    this.weightLabel = w.label;
    // Weight dice on offensive rolls; Heavy takes both hands (PHB 4.1.1).
    this.twoHanded = this.weight === "heavy";
    // Heavy: the Action and the Quick Action, margin doubled before the cap (PHB 4.1.1, 6.7.0).
    this.doublesMargin = !this.innate && this.weight === "heavy";
    this.marginMultiplier = this.innate ? 1 : (w.mult ?? 1);
    this.weightDice = this.innate ? "" : (w.dice ?? "");
    if (this.innate) this.location = "equipped";
    this.equipped = this.location === "equipped";
    this.carriedWeight = this.innate ? 0 : w.lbs;
    this.rangeBand = rangeBandOf(this.range);
    this.primarySkills = PRIMARY_SKILLS[this.primaryAttribute] ?? [];
    this.typesLabel = this.typesDisplay || types.map(k => defs.find(d => d.key === k)?.label ?? k).join(", ");

    // Price formula (PHB 5.2.2): weight class + Type surcharges + 10p per band past the usual Range.
    const channels = types.filter(t => ARCANE_TYPES.includes(t));
    const surcharge = types.reduce((n, t) => n + (TYPE_SURCHARGE[t] ?? 0), 0)
      - (this.typesDisplay && channels.length > 1 ? (channels.length - 1) * 5 : 0);
    const usual = usualRange(this.category, this.weight, types);
    const extra = Math.max(0, RANGE_BANDS.indexOf(this.rangeBand) - RANGE_BANDS.indexOf(usual));
    // Tools sit on their own cheap penny scale, outside the formula (Fundamental Math).
    const formulaApplies = !this.innate && this.category !== "tool";
    this.formulaPrice = formulaApplies ? w.price + surcharge + REACH_PRICE_PER_BAND * extra : this.price;
    this.priceMismatch = formulaApplies && this.price !== this.formulaPrice;
    this.bonusPrice = (BONUS_PRICE[this.size] ?? BONUS_PRICE.medium)[this.bonus] ?? 0;
    // Crafting (PHB 5.3.2): the size's batches at the item's Tier (its bonus).
    this.craftCost = (SIZE[this.size]?.batches ?? 2) * (MATERIAL_TIER_PRICE[this.bonus] ?? 0);

    // Type effects (PHB 4.1.1).
    // A Light Instrument's built-ins can use the Quick Action (PHB 4.1.1). The Quick Type
    // survives only for a creature's natural weapon chosen to work that way (GMG 4.6.0).
    this.quick = this.weight === "light" || defs.some(d => d.quick);
    this.reload = defs.find(d => d.reload)?.reload ?? "";
    this.blockingOnly = defs.some(d => d.blocking) && !defs.some(d => d.family === "melee" || d.family === "ranged");
    this.stressTypes = defs.filter(d => d.stressPhysical || d.stressMental || d.pierce || d.dealsNoStress || d.doubleResistance)
      .map(d => ({ key: d.key, family: d.family, label: d.label, physical: d.stressPhysical, mental: d.stressMental,
                   pierce: d.pierce, doubleResistance: d.doubleResistance, dealsNoStress: d.dealsNoStress }));

    // +N (PHB 5.2.1): +N to rolls, Pierce half of N (rounded down) for Melee or Ranged;
    // Blocking-only is Oppose-only.
    const meleeOrRanged = defs.some(d => d.family === "melee" || d.family === "ranged");
    this.isMelee = defs.some(d => d.family === "melee");
    this.bonusRoll   = this.blockingOnly ? 0 : this.bonus;
    this.bonusPierce = !this.blockingOnly && meleeOrRanged ? Math.floor(this.bonus / 2) : 0;
    this.bonusOppose = this.blockingOnly ? this.bonus : 0;

    // Focus Gem (PHB 5.2.3).
    this.isArcane = channels.length > 0;
    const gem = FOCUS_GEMS[this.gem?.type];
    this.gemActive = !!gem && this.isArcane;
    this.gemSummary = gem ? `${gem.label} (Tier ${this.gem.tier})${gem.damageType ? `, ${gem.damageType}` : ""}: `
      + gem.adds.replace(/(\+|-|)1\b/, (m, s) => `${s || ""}${this.gem.tier}`) : "";
    this.gemWarning = gem && !this.isArcane ? "A Focus Gem only works in an Arcane Instrument." : "";
    this.damageTypes = [...types.filter(t => ["edged", "pointed", "blunt"].includes(t)),
                        ...(this.gemActive && gem.damageType ? [gem.damageType] : [])];

    this.typeWarning = types.length === 0 && !this.innate
      ? "No Instrument Types set: this Instrument can't be used for anything."
      : unknown.length ? `Unresolved Instrument Type(s): ${unknown.join(", ")}.` : "";

    // Enchanting (PHB 5.3.4): priced like a custom Technique, sold at 10p per XP.
    const ench = this.enchantment ?? {};
    const registry = globalThis.CONFIG?.FOIL?.effects ?? null;
    const priced = registry && ench.enabled ? priceTechnique(ench.effects ?? [], registry) : { xp: 0, breakdown: [] };
    ench.xpCost = priced.xp;
    ench.strain = priced.strain ?? strainFor(priced.xp);
    ench.price  = priced.xp * 10;
    const x = priced.xp;
    ench.difficulty = !x ? 0 : x <= 8 ? 16 : x <= 16 ? 20 : x <= 24 ? 24 : 32;
    ench.materialTier = !x ? 0 : x <= 8 ? 1 : x <= 16 ? 2 : x <= 24 ? 3 : 4;
    const text = ench.effectText || (priced.breakdown ?? []).map(b => b.label).join(", ");
    ench.effectSummary = ench.strain ? (text ? `${text}, Strain ${ench.strain}` : `Strain ${ench.strain}`) : text;
  }
}

export class TechniqueData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    if (source?.requires) source.requires = mapTypes(source.requires);
    if (source && source.floorOverride !== undefined && source.floor === undefined) {
      source.floor = Number(source.floorOverride) > 0;
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      // Instrument Type slugs, any one of; empty with `innate` means no Instrument at all.
      requires: slugArray(),
      innate: bool(false),
      // Skills the Technique may roll when it names more than one (Read Habit rolls Acuity or Resonance).
      skillChoices: new f.ArrayField(new f.StringField({ required: true, choices: SKILL_KEYS }), { required: true, initial: [] }),
      // A Skill the Technique names outright (River Walk rolls Acuity).
      skill: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...SKILL_KEYS] }),
      family: str(""),
      subgroup: str(""),
      effects: effectsArraySchema(),
      // A stated defensive floor (PHB 4.2.1) the effects can't show on their own.
      floor: bool(false),
      ancestryGrant: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    const registry = globalThis.CONFIG?.FOIL?.effects ?? null;
    const types = this.requires ?? [];
    const { defs, unknown } = resolveTypes(types);
    const fortifying = types.includes("fortifying");
    const priced = registry ? priceTechnique(this.effects ?? [], registry, { floor: this.floor || fortifying })
                            : { xp: 0, breakdown: [] };
    this.xpCost = priced.xp;
    this.perTarget = (this.effects ?? []).some(e => e.key === "selective");
    this.strain = strainFor(this.xpCost - (this.perTarget ? SELECTIVE_PREMIUM : 0));
    this.pricingBreakdown = priced.breakdown;

    const has = key => (this.effects ?? []).filter(e => e.key === key);
    const sum = key => has(key).reduce((n, e) => n + Number(e.magnitude ?? 0), 0);
    this.quick      = has("quick").length > 0;
    this.upkeep     = has("upkeep").length > 0;
    this.dealsStress = has("stress").length > 0;
    this.rollBonus  = sum("roll-bonus");
    this.pierceTotal = sum("pierce");
    this.stressRider = has("stress-rider").length;
    // Used against a target (PHB 6.4.0): the weight dice apply only to these.
    const TARGETED = new Set(["stress", "stress-rider", "weaken", "weaken-minute", "reeling", "reeling-minute", "move", "drain", "lingering", "illusion", "counter",
      "grappled", "prone", "restrained", "charmed", "frightened", "controlled", "intimidated", "baited",
      "angered", "relaxed", "impressed", "wary", "enthralled", "blinded", "slowed", "stunned", "disarm", "foil-exposed"]);
    this.offensive = (this.effects ?? []).some(e => TARGETED.has(e.key) || (e.key.startsWith("skill-mod") && Number(e.magnitude) < 0));

    const sameSet = group => group.length === types.length && group.every(k => types.includes(k));
    this.requiresLabel = this.innate ? "Innate"
      : sameSet(["thrown", "drawn", "fired"]) ? "Ranged"
      : sameSet(["edged", "pointed", "blunt", "grappling", "parry"]) ? "Melee"
      : types.length ? types.map(k => defs.find(d => d.key === k)?.label ?? k).join(" or ") : "Any";
    this.typeWarning = unknown.length ? `Unresolved Instrument Type(s) in Requires: ${unknown.join(", ")}.` : "";

    const base = (priced.breakdown ?? []).map(b => b.label).join(", ");
    this.effectSummary = this.strain ? (base ? `${base}, Strain ${this.strain}${this.perTarget ? " per target" : ""}` : `Strain ${this.strain}`) : base;
  }
}

export class EquipmentData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    if (source?.location === "stored") source.location = "carried";
    if (source?.category === "ward" && (source.qualities ?? []).some(q => q.key === "bolster" || q.key === "skill-bonus")) {
      source.category = "charm";
    }
    for (const q of source?.qualities ?? []) {
      if (q.key === "bolster") q.key = "skill-bonus";
      if (q.param in LEGACY_SKILL_KEY) q.param = LEGACY_SKILL_KEY[q.param];
    }
    if (source && typeof source.weight === "string") {
      source.weightClass = source.weight;
      source.weight = 0;
    }
    if (source && typeof source.equipped === "boolean" && !source.location) {
      source.location = source.equipped ? "equipped" : "carried";
      delete source.equipped;
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      category: new f.StringField({ required: true, initial: "gear", choices: EQUIPMENT_CATEGORIES }),
      price: int(0),
      // Carried weight in pounds (PHB 5.2.4, 5.2.6).
      weight: new f.NumberField({ required: true, initial: 0, min: 0 }),
      // A Shield's weight class (PHB 7.5.3).
      weightClass: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...WEIGHT_KEYS] }),
      size: sizeField("medium"),
      materials: str(""),
      // Equipped (worn or in hand) or carried (PHB 5.2.6).
      location: new f.StringField({ required: true, initial: "carried", choices: ITEM_LOCATIONS }),
      qualities: new f.ArrayField(new f.SchemaField({
        key: slugField(""),
        value: int(0),
        param: str("")
      })),
      uses: str(""),
      duration: str(""),
      effect: str(""),
      // A Focus Gem's Type and Tier (PHB 5.2.3).
      gemType: new f.StringField({ required: true, blank: true, initial: "", choices: GEM_KEYS }),
      tier: new f.NumberField({ required: true, integer: true, initial: 1, min: 1, max: 5 }),
      notes: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    const wc = WEIGHT_CLASS[this.weightClass];
    this.equipped = this.location === "equipped";
    this.carriedWeight = Number(this.weight) || (wc ? wc.lbs : 0);
    this.weightClassLabel = wc?.label ?? "";
    const gem = FOCUS_GEMS[this.gemType];
    if (this.category === "gem" && gem) {
      this.gemPrice = gem.pricePerTier * this.tier;
      this.gemSummary = `${gem.damageType ? `${gem.damageType}; ` : ""}${gem.adds.replace(/(\+|-|)1\b/, (m, s) => `${s || ""}${this.tier}`)}`;
    } else {
      this.gemPrice = 0;
      this.gemSummary = "";
    }
    this.materialPrice = MATERIAL_TIER_PRICE[this.tier] ?? 0;
  }
}

export class FeatData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    if (source?.featKind === "origin") source.featType = "ancestry";
    else if (source?.featKind === "learned" && !source.featType) source.featType = "learned";
    for (const m of source?.modifiers ?? []) if (m.key in LEGACY_SKILL_KEY) m.key = LEGACY_SKILL_KEY[m.key];
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      featType: new f.StringField({ required: true, initial: "learned", choices: ["learned", "trait", "ancestry"] }),
      xpCost: int(0),
      requirements: str(""),
      effect: str(""),
      ancestry: str(""),
      grantsTechnique: str(""),
      modifiers: new f.ArrayField(new f.SchemaField({
        type: new f.StringField({ required: true, initial: "training", choices: ["training", "resistance"] }),
        key: slugField(""),
        value: int(0)
      })),
      description: html("")
    };
  }
}

export class BackgroundData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    const t = source?.training;
    if (t) for (const [old, neu] of Object.entries(LEGACY_SKILL_KEY)) {
      if (old in t) { t[neu] = Number(t[neu] ?? 0) + Number(t[old] ?? 0); delete t[old]; }
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    const training = {};
    for (const k of SKILL_KEYS) training[k] = int(0);
    return {
      training: new f.SchemaField(training),
      // The two d4s of Know-how, by the Attribute each one joins (PHB 2.5.2).
      knowHow: new f.ArrayField(new f.StringField({ required: true, choices: ATTRIBUTE_KEYS })),
      coin: str(""),
      equipmentKit: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    const t = this.training ?? {};
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    this.grantsSummary = SKILL_KEYS.filter(k => Number(t[k]) > 0).map(k => `+${t[k]} ${cap(k)}`).join(", ");
    const counts = {};
    for (const a of this.knowHow ?? []) counts[a] = (counts[a] ?? 0) + 1;
    this.knowHowSummary = Object.entries(counts).map(([a, n]) => `${n}d4 ${cap(a)}`).join(", ");
  }
}

/** An Origin (PHB 2.5.1, 7.8.0). The document type stays `origin` for existing worlds. */
export class OriginData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Talent: two Attribute dice advanced to a set size ("Finesse to d10").
      talent: new f.ArrayField(new f.SchemaField({
        attribute: new f.StringField({ required: true, initial: "might", choices: ATTRIBUTE_KEYS }),
        die: new f.NumberField({ required: true, integer: true, initial: 8, choices: [6, 8, 10, 12, 20] })
      })),
      feats: new f.ArrayField(new f.StringField({ required: true, blank: false })),
      feat: str(""),
      section: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    this.talentSummary = (this.talent ?? []).map(t => `${cap(t.attribute)} to d${t.die}`).join(", ");
    this.featsSummary = (this.feats?.length ? this.feats : [this.feat].filter(Boolean)).join(", ");
  }
}
