/**
 * src/item/item-sheet.js
 * FoilItemSheet — one ItemSheetV2 dispatching by type. Content sheets
 * (instrument/technique/equipment) render registry-driven pickers and array
 * composers; definition sheets (instrumentType/quality/effect) edit the
 * vocabulary itself.
 */

import {
  typeOptions, effectOptions, qualityOptions, effectMap, qualityMap
} from "../registry.js";
import {
  WEIGHT_KEYS, WEIGHT_PROFILE, RANGE_BANDS, APTITUDE_KEYS, ATTRIBUTE_KEYS, cap,
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, MATERIAL_SCARCITY_KEYS, MATERIAL_SCARCITY_LABEL,
  RESISTANCE_KINDS, RESISTANCE_LABEL
} from "../constants.js";
import { QualityData, EffectData } from "../data/definition-models.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ItemSheetV2Base = foundry.applications.sheets.ItemSheetV2;

const TEMPLATE_MAP = {
  instrument:     "systems/foil/templates/item/instrument-sheet.hbs",
  technique:      "systems/foil/templates/item/technique-sheet.hbs",
  feat:           "systems/foil/templates/item/feat-sheet.hbs",
  equipment:      "systems/foil/templates/item/equipment-sheet.hbs",
  background:     "systems/foil/templates/item/background-sheet.hbs",
  origin:         "systems/foil/templates/item/origin-sheet.hbs",
  instrumentType: "systems/foil/templates/item/instrument-type-sheet.hbs",
  quality:        "systems/foil/templates/item/quality-sheet.hbs",
  effect:         "systems/foil/templates/item/effect-sheet.hbs"
};

const EQUIP_CATEGORIES = [
  { value: "armor", label: "Armor" }, { value: "shield", label: "Shield" },
  { value: "ward", label: "Ward" }, { value: "gear", label: "Gear" },
  { value: "medicine", label: "Medicine" }, { value: "potion", label: "Potion" }
];

const WEIGHTS = WEIGHT_KEYS.map(k => ({
  value: k, label: `${WEIGHT_PROFILE[k].label} (${WEIGHT_PROFILE[k].mult} Stress, AP ${WEIGHT_PROFILE[k].baseAP})`
}));

const APTITUDES = [...APTITUDE_KEYS, "varies"];
const TARGETS = [...ATTRIBUTE_KEYS, "ally", "self"];
const PATTERN_SHAPES = ["single", "beam", "cone", "radius", "wall"];
const FEAT_KINDS = [
  { value: "origin", label: "Ancestry (granted, free)" },
  { value: "learned", label: "Learned (bought with XP)" }
];

// Full names + a one-line rule explanation for each pricing archetype, shown
// in the Effect definition sheet's dropdown (was raw camelCase keys before).
const PRICING_KIND_INFO = {
  perPoint:    { label: "Per Point",    hint: "Base XP + Per-point XP × the effect's magnitude N (e.g. Pierce N, Accuracy +N)." },
  linear:      { label: "Linear",       hint: "Same rule as Per Point — base + per-point × N. The seeded catalogue's name for it." },
  flat:        { label: "Flat",         hint: "A fixed Base XP cost, unaffected by magnitude." },
  condition:   { label: "Condition",    hint: "A fixed Base XP cost for a named condition (Grappled, Stunned, Charmed...)." },
  pattern:     { label: "Pattern",      hint: "Priced by area shape and reach: Beam/Wall by bands, Cone 3x, Radius 12x, plus placement." },
  selective:   { label: "Selective",    hint: "N targets within R bands, priced as N + R × N XP." },
  extendRange: { label: "Extend Range", hint: "Per-band XP for each range band the Technique's reach is extended." },
  upkeep:      { label: "Upkeep",       hint: "A flat Base XP cost, exempt from the combination premium — a recurring, sustained effect." },
  reaction:    { label: "Reaction",     hint: "Sets the Technique's floor to Reaction Floor XP, exempt from the combination premium." },
  counter:     { label: "Counter",      hint: "A fixed Base XP cost to negate or counter another Technique." }
};

const MATERIAL_CATEGORY_OPTIONS = [
  { value: "", label: "— none —" },
  ...MATERIAL_CATEGORIES.map(k => ({ value: k, label: MATERIAL_CATEGORY_LABEL[k] }))
];
const MATERIAL_SCARCITY_OPTIONS = MATERIAL_SCARCITY_KEYS.map(k => ({ value: k, label: MATERIAL_SCARCITY_LABEL[k] }));

export class FoilItemSheet extends HandlebarsApplicationMixin(ItemSheetV2Base) {

  static DEFAULT_OPTIONS = {
    classes: ["foil", "sheet", "item"],
    window: { resizable: true },
    position: { width: 520, height: 720 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage:    FoilItemSheet._onEditImage,
      addEffect:    FoilItemSheet._onAddEffect,
      removeEffect: FoilItemSheet._onRemoveEffect,
      addQuality:   FoilItemSheet._onAddQuality,
      removeQuality: FoilItemSheet._onRemoveQuality,
      addModifier:   FoilItemSheet._onAddModifier,
      removeModifier: FoilItemSheet._onRemoveModifier,
      addEnchantEffect:    FoilItemSheet._onAddEnchantEffect,
      removeEnchantEffect: FoilItemSheet._onRemoveEnchantEffect
    }
  };

  static PARTS = {
    main: { template: "systems/foil/templates/item/feat-sheet.hbs" }
  };

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.main = { ...parts.main, template: TEMPLATE_MAP[this.item.type] ?? TEMPLATE_MAP.feat };
    return parts;
  }

  async _prepareContext(options) {
    const sys = this.item.system;
    const ctx = {
      item: this.item,
      system: sys,
      weights: WEIGHTS,
      ranges: RANGE_BANDS,
      categories: EQUIP_CATEGORIES,
      featKinds: FEAT_KINDS,
      patternShapes: PATTERN_SHAPES.map(s => ({ value: s, label: cap(s) })),
      aptitudeOptions: APTITUDES.map(a => ({ value: a, label: cap(a) })),
      bolsterAptitudeOptions: APTITUDE_KEYS.map(a => ({ value: a, label: cap(a) })),
      targetOptions: TARGETS.map(a => ({ value: a, label: cap(a) })),
      attributeOptions: ATTRIBUTE_KEYS.map(a => ({ value: a, label: cap(a) })),
      // Registry-driven vocabulary (post-ready, always available at render).
      // Instruments carry `types`; Techniques and Effects require `requires`.
      typeOptions: typeOptions(sys.requires ?? sys.types ?? []),
      effectOptions: effectOptions(),
      qualityOptions: qualityOptions(),
      // Definition-sheet enums:
      qualityKinds: QualityData.KINDS.map(k => ({ value: k, label: cap(k) })),
      qualityScopes: QualityData.SCOPES.map(k => ({ value: k, label: cap(k) })),
      pricingKinds: EffectData.PRICING_KINDS.map(k => ({
        value: k, label: PRICING_KIND_INFO[k]?.label ?? cap(k), hint: PRICING_KIND_INFO[k]?.hint ?? ""
      })),
      materialCategories: MATERIAL_CATEGORY_OPTIONS,
      materialScarcities: MATERIAL_SCARCITY_OPTIONS
    };

    // Technique: resolve each composed effect entry's label for display.
    if (this.item.type === "technique") {
      const m = effectMap();
      ctx.effectRows = (sys.effects ?? []).map((e, i) => ({
        idx: i, ...e, label: m[e.key]?.label ?? e.key
      }));
    }
    if (this.item.type === "instrument") {
      const m = effectMap();
      ctx.enchantEffectRows = (sys.enchantment?.effects ?? []).map((e, i) => ({
        idx: i, ...e, label: m[e.key]?.label ?? e.key
      }));
    }
    if (this.item.type === "equipment") {
      const qm = qualityMap();
      ctx.qualityRows = (sys.qualities ?? []).map((q, i) => {
        // A Quality's own scope decides what its parameter is: Resistance names
        // a kind, so it gets a dropdown rather than a box you can typo into.
        const scope = qm[q.key]?.scope ?? "free";
        // Key check as well as scope, so this works against a world whose
        // Quality pack predates the resistanceKind scope.
        const isKind = scope === "resistanceKind" || q.key === "resistance";
        return {
          idx: i, ...q, scope, isKind,
          kindOptions: isKind ? RESISTANCE_KINDS.map(k => ({
            value: k, label: RESISTANCE_LABEL[k], selected: q.param === k
          })) : []
        };
      });
    }
    if (this.item.type === "instrumentType") {
      ctx.harmsOptions = [
        { value: "",         label: "Neither (support or Tool)", checked: !sys.harms },
        { value: "physical", label: "The body (Might or Finesse)", checked: sys.harms === "physical" },
        { value: "mental",   label: "The mind (Wit or Presence)",  checked: sys.harms === "mental" }
      ];
    }
    if (this.item.type === "feat") {
      ctx.modifierRows = (sys.modifiers ?? []).map((m, i) => ({ idx: i, ...m }));
    }
    return ctx;
  }

  // ─── Array composer actions ─────────────────────────────────────────────────

  static async _onAddEffect() {
    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.push({ key: "", magnitude: 1, pattern: "single", bands: 0, placement: 0, selectiveN: 0, selectiveR: 0 });
    await this.item.update({ "system.effects": effects });
  }
  static async _onRemoveEffect(event, target) {
    const idx = Number(target.dataset.index);
    const effects = foundry.utils.deepClone(this.item.system.effects ?? []);
    effects.splice(idx, 1);
    await this.item.update({ "system.effects": effects });
  }
  static async _onAddQuality() {
    const qualities = foundry.utils.deepClone(this.item.system.qualities ?? []);
    qualities.push({ key: "", value: 0, param: "" });
    await this.item.update({ "system.qualities": qualities });
  }
  static async _onRemoveQuality(event, target) {
    const idx = Number(target.dataset.index);
    const qualities = foundry.utils.deepClone(this.item.system.qualities ?? []);
    qualities.splice(idx, 1);
    await this.item.update({ "system.qualities": qualities });
  }
  static async _onAddEnchantEffect() {
    const effects = foundry.utils.deepClone(this.item.system.enchantment?.effects ?? []);
    effects.push({ key: "", magnitude: 1, pattern: "single", bands: 0, placement: 0, selectiveN: 0, selectiveR: 0 });
    await this.item.update({ "system.enchantment.effects": effects });
  }
  static async _onRemoveEnchantEffect(event, target) {
    const idx = Number(target.dataset.index);
    const effects = foundry.utils.deepClone(this.item.system.enchantment?.effects ?? []);
    effects.splice(idx, 1);
    await this.item.update({ "system.enchantment.effects": effects });
  }
  static async _onAddModifier() {
    const modifiers = foundry.utils.deepClone(this.item.system.modifiers ?? []);
    modifiers.push({ type: "training", key: "", value: 0 });
    await this.item.update({ "system.modifiers": modifiers });
  }
  static async _onRemoveModifier(event, target) {
    const idx = Number(target.dataset.index);
    const modifiers = foundry.utils.deepClone(this.item.system.modifiers ?? []);
    modifiers.splice(idx, 1);
    await this.item.update({ "system.modifiers": modifiers });
  }

  static _onEditImage(event, target) {
    const FP = foundry.applications?.apps?.FilePicker?.implementation
            ?? foundry.applications?.apps?.FilePicker ?? FilePicker;
    new FP({ type: "image", current: this.item.img, callback: path => this.item.update({ img: path }) }).render(true);
  }
}
