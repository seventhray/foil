/**
 * src/data/item-models.js
 * DataModels for the content items: instrument, technique, equipment, feat,
 * background, origin. These REFERENCE the authorable vocabulary (Instrument
 * Types, Qualities, Effects) by slug via the registry, so new definitions
 * recombine into them without code changes.
 *
 * Registry-dependent *display* (type/quality labels) is resolved at sheet-render
 * time, where CONFIG.FOIL is guaranteed built. Registry-dependent *pricing*
 * (Technique XP, and an Instrument's bound Enchantment XP) is computed here in
 * prepareDerivedData when the registry is ready; the registry re-preps both
 * item types (src/registry.js REGISTRY_DEPENDENT_TYPES) once it finishes loading.
 */

import { f, slugField, slugArray, str, int, bool, html } from "./fields.js";
import {
  WEIGHT_PROFILE, WEIGHT_KEYS, RANGE_BANDS, APTITUDE_KEYS, ATTACK_TYPES, PIERCE_TYPES,
  MATERIAL_CATEGORIES, MATERIAL_SCARCITY_KEYS, MATERIAL_SCARCITY_MULT, MATERIAL_TIER_PRICE,
  MATERIAL_CATEGORY_LABEL, MATERIAL_SCARCITY_LABEL
} from "../constants.js";
import { priceTechnique } from "../pricing.js";

const EQUIP_CATEGORIES = ["armor", "shield", "ward", "gear", "medicine", "potion"];

/** Shared Material schema (PHB §7.4.2, §5.4.1): Category/Tier/Scarcity are the
 *  mechanical axes; the named material is fiction-only and not stored. */
function materialSchema() {
  return {
    materialCategory: new f.StringField({ required: true, blank: true, initial: "", choices: ["", ...MATERIAL_CATEGORIES] }),
    materialTier: new f.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 5 }),
    materialScarcity: new f.StringField({ required: true, initial: "common", choices: MATERIAL_SCARCITY_KEYS })
  };
}

/** Derive the display label + ladder price (GMG §8.1.0) for a Material schema. */
function deriveMaterial(sys) {
  sys.materialCategoryLabel = MATERIAL_CATEGORY_LABEL[sys.materialCategory] ?? "";
  sys.materialScarcityLabel = MATERIAL_SCARCITY_LABEL[sys.materialScarcity] ?? "";
  const tierPrice = MATERIAL_TIER_PRICE[sys.materialTier] ?? 0;
  sys.materialPrice = Math.round(tierPrice * (MATERIAL_SCARCITY_MULT[sys.materialScarcity] ?? 1));
}

/** Composed-effects schema shared by a Technique's own effects and an
 *  Instrument's bound Enchantment (PHB §5.4.2) — same shape, same pricing. */
function effectsArraySchema() {
  return new f.ArrayField(new f.SchemaField({
    key: slugField(""),
    magnitude: int(1),
    pattern: str("single"),
    bands: int(0),
    placement: int(0),
    selectiveN: int(0),
    selectiveR: int(0)
  }));
}

export class InstrumentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      weight: new f.StringField({ required: true, initial: "light", choices: WEIGHT_KEYS }),
      range: new f.StringField({ required: true, initial: "Close", choices: RANGE_BANDS }),
      price: int(0),
      types: slugArray(),          // Instrument Type slugs
      // Item Upgrade bonus, +0 to +5 (PHB §7.4.0). 0 = Tier 0 baseline, no bonus.
      bonus: new f.NumberField({ required: true, integer: true, initial: 0, min: 0, max: 5 }),
      // Reload (PHB §7.11.1): loaded at the start of a conflict; 1 AP to
      // reload before the next attack with it. Informational only, same as
      // Strain/Pierce — nothing here tracks a loaded/unloaded state.
      reload: bool(false),
      ...materialSchema(),
      // Enchantment (PHB §5.4.2): a Technique effect bound to the item. Usable
      // by anyone wielding it — no Technique-known requirement, no Potential
      // gate; the wielder rolls their own dice, Strain still applies to them.
      enchantment: new f.SchemaField({
        enabled: bool(false),
        effects: effectsArraySchema(),
        floorOverride: int(0),
        effectText: str("")
      }),
      description: html("")
    };
  }

  prepareDerivedData() {
    const w = WEIGHT_PROFILE[this.weight] ?? WEIGHT_PROFILE.light;
    this.weightLabel = w.label;
    this.weightMult  = w.mult;          // "0.5x" / "1.0x" / "1.5x" (PHB §5.2.1)
    this.baseAP      = w.baseAP;

    // +N Item Upgrade (PHB §7.4.0). A Blocking Instrument with no attack type
    // works like Armor instead (Bolster Prowess / Resistance); one that also
    // carries an attack type (e.g. a Quarterstaff) keeps the ordinary grant.
    const types = this.types ?? [];
    const hasBlocking = types.includes("blocking");
    const hasAttackType = types.some(t => ATTACK_TYPES.includes(t));
    const isBlockingOnly = hasBlocking && !hasAttackType;

    if (isBlockingOnly) {
      this.bonusAccuracy = 0;
      this.bonusPierce = 0;
      this.bonusBolsterProwess = this.bonus;
      this.bonusResistance = this.bonus;
    } else {
      this.bonusAccuracy = this.bonus;
      this.bonusPierce = types.some(t => PIERCE_TYPES.includes(t)) ? this.bonus : 0;
      this.bonusBolsterProwess = 0;
      this.bonusResistance = 0;
    }

    deriveMaterial(this);

    // What this Instrument can harm, and any flat Stress rider, per matched
    // Instrument Type. Kept per-type rather than unioned: a multi-type
    // Instrument (a Crossbow's Pointed + Fired) represents different MODES of
    // use, and only Fired carries the +2.
    const typeReg = globalThis.CONFIG?.FOIL?.instrumentTypes ?? {};
    const matchedTypes = types.map(k => typeReg[k]).filter(Boolean);
    this.harms = [...new Set(matchedTypes.map(t => t.harms).filter(Boolean))];
    this.bonusByType = matchedTypes
      .filter(t => Number(t.bonusStress ?? 0) > 0)
      .map(t => ({ label: t.label, bonusStress: Number(t.bonusStress) }));

    // Warn when this Instrument can't actually be used: no Type at all, or a
    // Type slug the registry doesn't recognize (e.g. left over from a rename/
    // split — this is exactly the class of bug an earlier live audit had to
    // find by hand; surfacing it here catches it automatically instead).
    const badTypes = types.filter(t => !typeReg[t]);
    this.typeWarning = types.length === 0
      ? "No Instrument Types set — this Instrument can't be wielded for anything."
      : badTypes.length
        ? `Unresolved Instrument Type(s): ${badTypes.join(", ")} — pick a valid type from the list.`
        : "";

    // Enchantment pricing (GMG §5.1.0/§8.2.0): same engine as a Technique.
    const registry = globalThis.CONFIG?.FOIL?.effects ?? null;
    const ench = this.enchantment ?? {};
    let computed = { xp: 0, strain: 0, breakdown: [] };
    if (registry && ench.enabled) {
      computed = priceTechnique(ench.effects ?? [], registry, { floorOverride: ench.floorOverride });
    }
    ench.xpCost = computed.xp;
    ench.strain = Math.floor(computed.xp / 16);
    // Price = effect XP × 10p (PHB §5.4.2).
    ench.price = computed.xp * 10;
    // Difficulty and required Gemstone Tier by effect XP (GMG §8.2.0).
    ench.difficulty = computed.xp <= 0 ? 0 : computed.xp <= 8 ? 12 : computed.xp <= 16 ? 16 : computed.xp <= 24 ? 20 : 25;
    ench.craftMaterialTier = computed.xp <= 0 ? 0 : computed.xp <= 8 ? 1 : computed.xp <= 16 ? 2 : computed.xp <= 24 ? 3 : 4;

    // The Aptitude an Enchantment rolls comes from the Instrument's own carried
    // Instrument Type(s) — it is cast through this specific Instrument.
    const distinctApts = [...new Set(matchedTypes.map(t => t.aptitude).filter(v => v && v !== "None"))];
    ench.aptitudeDisplay = (distinctApts.length === 1 && distinctApts[0] !== "varies") ? distinctApts[0] : "varies";

    const enchBase = ench.effectText || (computed.breakdown ?? []).map(b => b.label).join(", ");
    ench.effectSummary = ench.strain > 0
      ? (enchBase ? `${enchBase}, Strain ${ench.strain}` : `Strain ${ench.strain}`)
      : enchBase;

    // Accuracy/Pierce from the bound effects, same scan TechniqueData does —
    // the wielder's roll adds these plus the Instrument's own +N (PHB §7.4.0),
    // exactly as if the effect were an ordinary Technique through this item.
    ench.accuracyTotal = (ench.effects ?? [])
      .filter(e => e.key === "accuracy")
      .reduce((n, e) => n + Number(e.magnitude ?? 0), 0);
    ench.pierceTotal = (ench.effects ?? [])
      .filter(e => e.key === "pierce")
      .reduce((n, e) => n + Number(e.magnitude ?? 0), 0);
  }
}

export class TechniqueData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      requires: slugArray(),        // Instrument Type slugs (any one of); empty = any.
      // Aptitude / Target / Oppose are NOT stored: per PHB §5.2.1 the required
      // Instrument Type dictates them. They are derived below for display.
      // Composed effects (GMG §5.1.0). XP/Strain derive from these.
      effects: effectsArraySchema(),
      floorOverride: int(0),        // manual floor for ward / answers-a-class cases
      // Optional authoritative override (catalogue entries, Skills that don't
      // decompose). null ⇒ use the computed price.
      xpOverride: new f.NumberField({ required: false, nullable: true, integer: true, initial: null }),
      effectText: str(""),          // free-text flavor / summary override
      description: html("")
    };
  }

  prepareDerivedData() {
    const registry = globalThis.CONFIG?.FOIL?.effects ?? null;
    let computed = { xp: 0, strain: 0, gate: { value: 0, attribute: "" }, breakdown: [] };
    if (registry) {
      computed = priceTechnique(this.effects ?? [], registry, { floorOverride: this.floorOverride });
    }
    this.xpComputed = computed.xp;
    this.xpCost = (this.xpOverride ?? null) !== null ? this.xpOverride : computed.xp;
    // Rescaled 2026-07-28 (4 XP/point base): Strain = floor(XP/16); gate 12 XP ⇒ 12, 16+ ⇒ 16.
    this.strain = Math.floor(this.xpCost / 16);
    this.potentialGate = this.xpCost >= 16 ? { value: 16, attribute: "" }
                       : this.xpCost >= 12 ? { value: 12, attribute: "" }
                       : { value: 0, attribute: "" };
    this.pricingBreakdown = computed.breakdown;

    // Accuracy total feeds the roll formula; scan composed effects.
    this.accuracyTotal = (this.effects ?? [])
      .filter(e => e.key === "accuracy")
      .reduce((n, e) => n + Number(e.magnitude ?? 0), 0);

    // Aptitude / Target / Oppose are read from the required Instrument Type(s)
    // (PHB §5.2.1, §7.11.1) — the Technique names the Type, the Type supplies the
    // rest. Display-only: the actual roll aptitude is fixed by the *wielded*
    // Instrument's matching Type at roll time (see actor-sheet _onRollTechnique).
    const typeReg = globalThis.CONFIG?.FOIL?.instrumentTypes ?? {};
    const reqs = this.requires ?? [];
    const resolved = reqs.map(k => typeReg[k]).filter(Boolean);
    const distinct = vals => [...new Set(vals.filter(v => v && v !== "None"))];
    const apts = distinct(resolved.map(t => t.aptitude));
    this.aptitudeDisplay = reqs.length === 0 ? "varies"
      : (apts.includes("varies") || apts.length !== 1) ? "varies" : apts[0];
    this.targetDisplay = distinct(resolved.map(t => t.targets)).join(" / ")
      || (resolved.length && resolved.every(t => t.targets === "None") ? "None" : "");
    this.opposeDisplay = distinct(resolved.map(t => t.opposes)).join(" / ")
      || (resolved.length && resolved.every(t => t.opposes === "None") ? "None" : "");

    // Warn on an unresolved Requires slug (empty Requires is fine — it's the
    // legitimate "any Instrument Type" umbrella meaning, not a problem).
    const badReqs = reqs.filter(k => !typeReg[k]);
    this.typeWarning = badReqs.length
      ? `Unresolved Instrument Type(s) in Requires: ${badReqs.join(", ")} — pick a valid type from the list.`
      : "";

    // Strain is an Effect, not a separate field (PHB §7 catalogue): fold the
    // derived Strain N into the effect summary the lists/roll display show.
    const base = this.effectText || (this.pricingBreakdown ?? []).map(b => b.label).join(", ");
    this.effectSummary = this.strain > 0
      ? (base ? `${base}, Strain ${this.strain}` : `Strain ${this.strain}`)
      : base;
  }
}

export class EquipmentData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      category: new f.StringField({ required: true, initial: "armor", choices: EQUIP_CATEGORIES }),
      weight: new f.StringField({ required: true, blank: true, initial: "" }), // shields
      price: int(0),
      impairFinesse: int(0),
      ...materialSchema(),
      // Worn state: only equipped armor/shield/ward contributes its Resistance.
      equipped: bool(false),
      // Composed passive Qualities: each references a Quality def by slug.
      qualities: new f.ArrayField(new f.SchemaField({
        key: slugField(""),
        value: int(0),
        param: str("")   // Attribute / Aptitude / free target the quality applies to
      })),
      // Potions/Medicine that restore Stress: the amount they Mend (e.g. "1d6" or "4").
      mend: str(""),
      uses: str(""),
      effect: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    this.weightLabel = this.weight ? (WEIGHT_PROFILE[this.weight]?.label ?? this.weight) : "";
    deriveMaterial(this);
  }
}

export class FeatData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      featKind: new f.StringField({ required: true, initial: "learned", choices: ["origin", "learned"] }),
      xpCost: int(0),
      origin: str(""),
      requirements: str(""),
      effect: str(""),
      // Flat stat modifiers (e.g. Iron [Attribute] → Resistance +1). Most Feats
      // are conditional prose and leave this empty. Feeds aggregateModifiers().
      modifiers: new f.ArrayField(new f.SchemaField({
        type: new f.StringField({ required: true, initial: "training", choices: ["training", "resistance"] }),
        key: slugField(""),   // aptitude slug (training) or attribute slug (resistance)
        value: int(0)
      })),
      description: html("")
    };
  }
}

export class BackgroundData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const training = {};
    for (const k of APTITUDE_KEYS) training[k] = int(0);
    return {
      training: new f.SchemaField(training),
      equipmentKit: str(""),
      description: html("")
    };
  }

  prepareDerivedData() {
    const t = this.training ?? {};
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    this.grantsSummary = APTITUDE_KEYS
      .filter(k => Number(t[k]) > 0)
      .map(k => `+${t[k]} ${cap(k)}`)
      .join(", ");
  }
}

export class OriginData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      feat: str(""),
      description: html("")
    };
  }
}
