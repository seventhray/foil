/**
 * src/data/definition-models.js
 * DataModels for the authorable vocabulary: Instrument Types, Qualities, and
 * Effects. Content items reference them by `key` slug through the registry
 * (src/registry.js), so a new definition shows up everywhere without code.
 */

import { f, slugField, str, int, bool, html, slugArray } from "./fields.js";

// Pre-0.6.0 slugs that no longer name an Instrument Type.
export const LEGACY_TYPE_KEY = {
  command: "sonic", guile: "sonic", resonance: "sonic",
  survival: "tool", alchemy: "tool", craft: "craft", performance: "tool",
  subterfuge: "tool", athletics: "tool"
};

/**
 * An Instrument Type or Property (PHB 4.1.1). A Type (Melee, Ranged, Arcane, Sonic) sets which Attributes the Instrument harms;
 * a Property says what else it can do, and Kinetic and Incorporeal set what an Arcane Instrument harms. Neither adds Stress.
 */
export class InstrumentTypeData extends foundry.abstract.TypeDataModel {
  static FAMILIES = ["melee", "ranged", "arcane", "sonic", "other"];
  static KINDS = ["type", "property"];
  static HARMS = ["", "physical", "mental"];
  static RELOADS = ["", "quick", "action"];

  static defineSchema() {
    return {
      key: slugField(""),
      kind: new f.StringField({ required: true, initial: "property", choices: InstrumentTypeData.KINDS }),
      family: new f.StringField({ required: true, initial: "other", choices: InstrumentTypeData.FAMILIES }),
      // The kind of Attribute it harms: a Type's, or an Arcane Instrument's Kinetic (physical) or Incorporeal (mental).
      harms: new f.StringField({ required: true, blank: true, initial: "", choices: InstrumentTypeData.HARMS }),
      // A creature's natural weapon whose built-ins may be used as a Quick Action (GMG 9.6.0).
      quick: bool(false),
      reload: new f.StringField({ required: true, blank: true, initial: "", choices: InstrumentTypeData.RELOADS }),
      // Tools and Tools [Material] roll against a Difficulty as a Trade (PHB 4.2.6).
      isTool: bool(false),
      description: html("")
    };
  }
}

/**
 * A passive Quality carried by Equipment (PHB 7.9.1): Resistance +N of a kind,
 * +N to a Skill, Aid +N to a task.
 */
export class QualityData extends foundry.abstract.TypeDataModel {
  static KINDS = ["resistance", "skill", "aid", "custom"];
  static SCOPES = ["resistanceKind", "skill", "attribute", "free", "none"];

  static defineSchema() {
    return {
      key: slugField(""),
      kind: new f.StringField({ required: true, initial: "custom", choices: QualityData.KINDS }),
      scope: new f.StringField({ required: true, initial: "free", choices: QualityData.SCOPES }),
      valueLabel: str(""),
      description: html("")
    };
  }
}

/**
 * A Technique Effect (Fundamental Math's Effects table, GMG 10.0.0). Carries
 * its price and the Instrument Types allowed to deliver it.
 */
export class EffectData extends foundry.abstract.TypeDataModel {
  static PRICING_KINDS = [
    "perPoint",     // base + perPoint x N
    "flat",         // fixed XP
    "pattern",      // Beam/Cone/Radius/Wall by reach, plus placement
    "selective",    // range plus an 8 XP premium; Strain per target
    "extendRange",  // perBand x bands
    "upkeep",       // flat, doesn't count toward the premium
    "quick",        // free tag, doesn't count; a stated trigger sets the 8 XP floor
    "counter"       // flat
  ];

  static migrateData(source) {
    if (source?.pricingKind === "linear") source.pricingKind = "perPoint";
    if (source?.pricingKind === "condition") source.pricingKind = "flat";
    if (source?.pricingKind === "reaction") source.pricingKind = "quick";
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      key: slugField(""),
      requires: slugArray(),
      pricingKind: new f.StringField({ required: true, initial: "flat", choices: EffectData.PRICING_KINDS }),
      pricingParams: new f.SchemaField({
        base: int(0),
        perPoint: int(0),
        perBand: int(1)
      }),
      // How a magnitude reads, with N standing in for it ("Pierce N").
      magnitudeLabel: str(""),
      exemptFromPremium: bool(false),
      setsFloor: bool(false),
      description: html("")
    };
  }
}
