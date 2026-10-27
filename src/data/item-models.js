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
  WEIGHT_KEYS, ATTRIBUTE_KEYS, SKILL_KEYS, SIZE_KEYS, RANGE_BANDS, rangeBandOf, rangeMinOf, rangeTextOf,
  EQUIPMENT_CATEGORIES, LEGACY_CONSUMABLE_CATEGORIES, LEGACY_SKILL_KEY, ITEM_LOCATIONS
} from "../constants.js";
import { LEGACY_TYPE_KEY } from "./definition-models.js";
import { deriveInstrument, deriveTechnique, deriveEquipment, deriveConsumable, deriveBackground, deriveOrigin } from "../../rules/items.js";

const INSTRUMENT_CATEGORIES = ["melee", "ranged", "arcane", "sonic", "tool", "innate"];

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

export class InstrumentData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    if (typeof source?.range === "string") {
      source.range = rangeTextOf(source.range);
      // Min and Max Range read from older Range text ("Range 2-4").
      if (!source.maxRange) source.maxRange = rangeBandOf(source.range);
      if (!source.minRange) source.minRange = rangeMinOf(source.range);
    }
    if (source?.types) source.types = mapTypes(source.types);
    if (source && "weight" in source && !WEIGHT_KEYS.includes(source.weight)) source.weight = "light";
    // Aid and situational Enchantments are the GM's, not an Instrument's (PHB 5.3.4); Focus Gems are gone.
    if (source?.enchantment?.bonus?.kind === "aid") source.enchantment.bonus.kind = "";
    if (source) delete source.gem;
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      category: new f.StringField({ required: true, initial: "melee", choices: INSTRUMENT_CATEGORIES }),
      weight: new f.StringField({ required: true, initial: "light", choices: WEIGHT_KEYS }),
      primaryAttribute: new f.StringField({ required: true, initial: "might", choices: ATTRIBUTE_KEYS }),
      range: str("Range 1"),
      // The farthest band it reaches; the Range text follows Min and Max.
      maxRange: new f.StringField({ required: true, blank: true, initial: "close", choices: ["", ...RANGE_BANDS] }),
      // The nearest band it works from, when it has one (blank for none).
      minRange: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...RANGE_BANDS] }),
      types: slugArray(),
      // Verbatim Types line when it isn't a plain list (a Wand's "or Fortifying (pick one)").
      typesDisplay: str(""),
      price: int(0),
      rider: str(""),
      // Three built-in Techniques, one per Skill its Primary Attribute reaches (PHB 7.4.0).
      kit: new f.ArrayField(new f.SchemaField({
        name: str(""),
        skill: new f.StringField({ required: true, initial: "prowess", choices: SKILL_KEYS }),
        effect: str("")
      })),
      // Body, Voice, and Mind: every character has them, free (PHB 2.5.3).
      innate: bool(false),
      // Equipped (ready) or carried (PHB 4.1.0, 5.2.6). Innate Instruments are always equipped.
      location: new f.StringField({ required: true, initial: "equipped", choices: ITEM_LOCATIONS }),
      // The place of Storage that holds it while stored.
      storedAt: str(""),
      bonus: new f.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 5 }),
      // The Tier of its materials, when above its +N: an iron Longsword is Tier 1 at +0 (PHB 5.3.1, 5.3.4).
      tier: new f.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 5 }),
      size: sizeField("medium"),
      materials: str(""),
      // A Technique effect bound to the item (PHB 5.3.4).
      enchantment: new f.SchemaField({
        enabled: bool(false),
        effects: effectsArraySchema(),
        effectText: str(""),
        // Or a numerical bonus instead of a Technique (PHB 5.3.4): one Enchantment per item.
        bonus: new f.SchemaField({
          kind: new f.StringField({ required: true, blank: true, initial: "", choices: ["", "skill", "roll", "pierce", "stress"] }),
          skill: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...SKILL_KEYS] }),
          n: new f.NumberField({ required: true, integer: true, initial: 1, min: 1, max: 5 })
        })
      }),
      description: html("")
    };
  }

  prepareDerivedData() {
    deriveInstrument(this, globalThis.CONFIG?.FOIL);
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
      // Range for a Technique that has no Instrument, and the nearest band it works from (blank for none).
      range: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...RANGE_BANDS] }),
      minRange: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...RANGE_BANDS] }),
      // Skills the Technique may roll when it names more than one (a Technique may name two Skills).
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
    deriveTechnique(this, globalThis.CONFIG?.FOIL);
  }
}

export class EquipmentData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    if (source?.category === "gem") source.category = "gear";
    if (source) delete source.gemType;
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
      // A legacy consumable category loads until the world migration moves the item to a Consumable (system.js).
      category: new f.StringField({ required: true, initial: "gear", choices: [...EQUIPMENT_CATEGORIES, ...LEGACY_CONSUMABLE_CATEGORIES] }),
      price: int(0),
      // Carried weight in pounds (PHB 5.2.4, 5.2.6).
      weight: new f.NumberField({ required: true, initial: 0, min: 0 }),
      // A Shield's weight class (PHB 7.9.3).
      weightClass: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...WEIGHT_KEYS] }),
      size: sizeField("medium"),
      materials: str(""),
      // Equipped (worn or in hand) or carried (PHB 5.2.6).
      location: new f.StringField({ required: true, initial: "carried", choices: ITEM_LOCATIONS }),
      // The place of Storage that holds it while stored.
      storedAt: str(""),
      qualities: new f.ArrayField(new f.SchemaField({
        key: slugField(""),
        value: int(0),
        param: str("")
      })),
      // What it does or helps with: a Shield's Blocking, a Rope's climbing and hauling.
      effect: str(""),
      tier: new f.NumberField({ required: true, integer: true, initial: 1, min: 1, max: 5 }),
      // An Enchantment (PHB 5.3.4): Resistance +N or +N to a Skill, or a Technique that takes no roll (user, 2026-10-26).
      enchantment: new f.SchemaField({
        enabled: bool(false),
        effects: effectsArraySchema(),
        effectText: str(""),
        bonus: new f.SchemaField({
          kind: new f.StringField({ required: true, blank: true, initial: "", choices: ["", "resistance", "skill"] }),
          param: str(""),
          n: new f.NumberField({ required: true, integer: true, initial: 1, min: 1, max: 5 })
        })
      }),
      notes: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    deriveEquipment(this, globalThis.CONFIG?.FOIL);
  }
}

/** A Consumable (PHB 7.9.5): used up in Uses, with an Effect that lasts its Duration. Medicine, poisons, throwables, a Torch. */
export class ConsumableData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      effect: str(""),
      duration: str(""),
      uses: str("1"),
      price: int(0),
      // Mass in pounds (PHB 5.2.6).
      weight: new f.NumberField({ required: true, initial: 0, min: 0 }),
      // Its Tier (PHB 6.10.0): Medicine runs from Tier 0 to Tier 5.
      tier: new f.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 5 }),
      materials: str(""),
      location: new f.StringField({ required: true, initial: "carried", choices: ["carried", "stored"] }),  // used from the pack, never worn
      storedAt: str(""),
      notes: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    deriveConsumable(this);
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
        type: new f.StringField({ required: true, initial: "training", choices: ["training", "resistance", "initiative", "stealth"] }),
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
    deriveBackground(this);
  }
}

/** An Origin (PHB 2.5.1, 7.5.0). The document type stays `origin` for existing worlds. */
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
    deriveOrigin(this);
  }
}
