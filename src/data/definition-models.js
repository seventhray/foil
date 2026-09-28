/**
 * src/data/definition-models.js
 * DataModels for the authorable *vocabulary* documents. These are the pieces a
 * GM creates and recombines: an Instrument Type, a Quality, an Effect. Content
 * items (instruments, techniques, equipment) reference them by `key` slug via
 * the registry (src/registry.js).
 */

import { f, slugField, str, int, bool, html, slugArray } from "./fields.js";
import { APTITUDE_KEYS, ATTRIBUTE_KEYS } from "../constants.js";

/**
 * An Instrument Type (PHB §7.11.1): the casting Aptitude(s), Target(s), and
 * Oppose(s) an Instrument carrying it lends, and whether it is a Tool type.
 */
export class InstrumentTypeData extends foundry.abstract.TypeDataModel {
  /**
   * Pre-v0.2.0 Instrument Types stored a Target, an Oppose list, an Attribute
   * Bonus, and a Bonus Die. Target became a body-or-mind call, Oppose became
   * derived, and the Attribute Bonus was retired (PHB §5.2.2). Infer `harms`
   * from whichever Attributes the old Target column named, and turn Fired's
   * 1d4 Bonus Die into its flat +2.
   */
  static migrateData(source) {
    if (source && source.harms === undefined) {
      const t = String(source.targets ?? "").toUpperCase();
      source.harms = /\b(MI|FS)\b/.test(t) ? "physical" : (/\b(WI|PS)\b/.test(t) ? "mental" : "");
    }
    if (source && source.bonusStress === undefined) {
      source.bonusStress = source.bonusDie ? 2 : 0;
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      key: slugField(""),
      // Display/reference strings (the roll reads the Technique's own aptitude,
      // not these). "varies" is allowed for `aptitude`.
      aptitude: str("varies"),
      // What kind of harm this type does (PHB §5.2.2): "physical" harms Might
      // or Finesse, "mental" harms Wit or Presence, "" is support or a Tool.
      // The attacker picks which Attribute of the pair. Oppose is no longer
      // stored: a target Opposes with any Aptitude built on the Attribute
      // under attack, which is derived, not looked up.
      harms: str(""),
      isTool: bool(false),
      // A flat Stress rider a landed Technique adds on top of the Weight term
      // (PHB §5.2.2). Only Fired carries one, at +2; 0 everywhere else. The
      // Attribute Bonus this used to sit beside was retired in v0.2.0, since
      // margin-derived Stress already converts Potential into damage.
      bonusStress: new f.NumberField({ required: true, integer: true, initial: 0 }),
      description: html("")
    };
  }
}

/**
 * A passive Quality carried by Equipment (or an Instrument): Resistance +N to an
 * kind, Bolster +N to an Aptitude, Aid +N to a task, etc. `kind` picks how it
 * reads; `scope` says what its parameter names, which is what decides whether
 * the item sheet offers a dropdown or a text box.
 */
export class QualityData extends foundry.abstract.TypeDataModel {
  static KINDS = ["resistance", "bolster", "aid", "impair", "blocking", "custom"];
  static SCOPES = ["resistanceKind", "attribute", "aptitude", "free", "none"];

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
 * A Technique Effect (GMG §5.1.0). Carries its pricing archetype and the
 * Instrument Types allowed to deliver it. The pricing engine (src/pricing.js)
 * reads `pricingKind` + `pricingParams` to derive a composed Technique's XP.
 * Consumed only at build time — nothing resolves effects in play.
 */
export class EffectData extends foundry.abstract.TypeDataModel {
  static PRICING_KINDS = [
    "perPoint",     // base + perPoint × N (params: base, perPoint)
    "linear",       // same rule as perPoint — the seeder's name for it; both
                     // must stay valid choices or a compendium doc authored
                     // with one silently resets to the schema default on load
    "flat",         // fixed XP (params: base)
    "condition",    // fixed XP, a named condition (params: base)
    "pattern",      // Beam/Cone/Radius/Wall by bands (params: none; read from entry)
    "selective",    // N + R × N (params: none; read from entry)
    "extendRange",  // 1 per band (params: perBand default 1)
    "upkeep",       // flat, premium-exempt (params: base default 5)
    "reaction",     // sets a floor, premium-exempt (params: floor default 10)
    "counter"       // flat (params: base)
  ];

  static defineSchema() {
    return {
      key: slugField(""),
      requires: slugArray(), // Instrument Type slugs allowed to deliver it; empty = any
      pricingKind: new f.StringField({ required: true, initial: "flat", choices: EffectData.PRICING_KINDS }),
      pricingParams: new f.SchemaField({
        base: int(0),      // flat / condition / counter base XP
        perPoint: int(5),  // perPoint rate (× magnitude)
        perBand: int(1),   // extendRange rate
        floor: int(10)     // reaction floor
      }),
      exemptFromPremium: bool(false), // Upkeep, Reaction: no combination premium
      setsFloor: bool(false),         // Reaction: raises the Technique floor, doesn't add
      noStrain: bool(false),          // effects that never contribute (informational)
      description: html("")
    };
  }
}
