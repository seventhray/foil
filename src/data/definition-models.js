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
 * An Instrument Type (PHB 4.1.1): a tag with a type effect on a landed hit's
 * Stress, or on how the Instrument is used.
 */
export class InstrumentTypeData extends foundry.abstract.TypeDataModel {
  static FAMILIES = ["melee", "ranged", "arcane", "sonic", "other"];
  static RELOADS = ["", "quick", "action"];

  static migrateData(source) {
    if (source && source.stressPhysical === undefined && source.bonusStress !== undefined) {
      source.stressPhysical = Number(source.bonusStress) || 0;
    }
    // Edged went from no bonus against any Resistance to Resistance counting double (2026-09-29).
    if (source && source.doubleResistance === undefined && source.noBonusVsResistance !== undefined) {
      source.doubleResistance = !!source.noBonusVsResistance;
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      key: slugField(""),
      family: new f.StringField({ required: true, initial: "other", choices: InstrumentTypeData.FAMILIES }),
      // Stress this Type adds against a physical or a mental Attribute (may be negative).
      stressPhysical: int(0),
      stressMental: int(0),
      // Pierce against physical Resistance (Pointed 1, Blunt 3).
      pierce: int(0),
      // Edged: physical Resistance, after Pierce, counts double against it.
      doubleResistance: bool(false),
      // Grappling deals no Stress.
      dealsNoStress: bool(false),
      // Built-in Techniques usable as a Quick Action too.
      quick: bool(false),
      // Blocking: its +N applies to Oppose rolls only.
      blocking: bool(false),
      reload: new f.StringField({ required: true, blank: true, initial: "", choices: InstrumentTypeData.RELOADS }),
      // Tool and Craft roll against a Difficulty as a Trade (PHB 4.2.6).
      isTool: bool(false),
      description: html("")
    };
  }
}

/**
 * A passive Quality carried by Equipment (PHB 7.5.1): Resistance +N of a kind,
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
 * A Technique Effect (Fundamental Math's Effects table, GMG 5.1.0). Carries
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
