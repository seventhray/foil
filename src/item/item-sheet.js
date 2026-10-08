/**
 * src/item/item-sheet.js
 * FoilItemSheet: one ItemSheetV2 dispatching by type. Content sheets render
 * registry-driven pickers and array editors; definition sheets edit the
 * vocabulary itself.
 */

import { typeOptions, effectOptions, qualityOptions, effectMap, qualityMap } from "../registry.js";
import {
  WEIGHT_KEYS, WEIGHT_CLASS, ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_KEYS, SKILL_LABEL, SIZE, SIZE_KEYS,
  FOCUS_GEMS, EQUIPMENT_CATEGORY_LABEL, RESISTANCE_KINDS, RESISTANCE_LABEL, cap, ITEM_LOCATIONS, LOCATION_LABEL,
  TECHNIQUE_FAMILIES, ORIGIN_NAMES, RANGE_CHOICES
} from "../constants.js";
import { QualityData, EffectData, InstrumentTypeData } from "../data/definition-models.js";
import { entryLabel } from "../pricing.js";
import { lookup } from "../glossary-ui.js";

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

const opt = (value, label) => ({ value, label });
/** Options with the current value kept, even if it is not on the list. */
const withCurrent = (values, current) => {
  const list = [...new Set(values)];
  if (current && !list.includes(current)) list.push(current);
  return list.map(v => opt(v, v));
};
const packNames = key => [...(game.packs?.get(key)?.index ?? [])].map(e => e.name);
const worldNames = type => (game.items?.filter(i => i.type === type) ?? []).map(i => i.name);
const PATTERN_SHAPES = ["single", "beam", "cone", "radius", "wall"];

const PRICING_KIND_INFO = {
  perPoint:    "Base XP + per-point XP x the magnitude N (Pierce N, +N, -N [target Attribute]).",
  flat:        "A fixed XP cost (Stress 4, a Condition, Illusion, Drain).",
  pattern:     "Beam or Wall: 1 + 2 + ... per band. Cone 3x, Radius 12x the Beam cost. Placement adds R.",
  selective:   "Creatures within R bands: range at 1 XP per band, plus an 8 XP premium; Strain is paid per target.",
  extendRange: "Per-band XP for each band of extra reach.",
  upkeep:      "Flat XP; doesn't count toward the +4 per extra Effect.",
  quick:       "A free tag; doesn't count toward the premium. A stated trigger sets the 8 XP floor.",
  counter:     "A fixed XP cost to contest another Technique."
};

export class FoilItemSheet extends HandlebarsApplicationMixin(ItemSheetV2Base) {

  static DEFAULT_OPTIONS = {
    classes: ["foil", "sheet", "item"],
    window: { resizable: true },
    position: { width: 540, height: 720 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      editImage:           FoilItemSheet._onEditImage,
      addRow:              FoilItemSheet._onAddRow,
      removeRow:           FoilItemSheet._onRemoveRow
    }
  };

  static PARTS = { main: { template: "systems/foil/templates/item/feat-sheet.hbs" } };

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.main = { ...parts.main, template: TEMPLATE_MAP[this.item.type] ?? TEMPLATE_MAP.feat };
    return parts;
  }

  async _prepareContext(options) {
    const sys = this.item.system;
    const em = effectMap();
    const qm = qualityMap();
    const ctx = {
      item: this.item,
      system: sys,
      weightOptions: WEIGHT_KEYS.map(k => opt(k, WEIGHT_CLASS[k].label)),
      locationOptions: ITEM_LOCATIONS.map(k => opt(k, LOCATION_LABEL[k])),
      weightClassOptions: [opt("", "None"), ...WEIGHT_KEYS.map(k => opt(k, WEIGHT_CLASS[k].label))],
      sizeOptions: SIZE_KEYS.map(k => opt(k, `${SIZE[k].label} (${SIZE[k].batches} batch${SIZE[k].batches > 1 ? "es" : ""})`)),
      attributeOptions: ATTRIBUTE_KEYS.map(k => opt(k, ATTR_LABEL[k])),
      skillOptions: SKILL_KEYS.map(k => opt(k, SKILL_LABEL[k])),
      skillOrNoneOptions: [opt("", "Chosen when rolled"), ...SKILL_KEYS.map(k => opt(k, SKILL_LABEL[k]))],
      categoryOptions: ["melee", "ranged", "arcane", "sonic", "tool", "innate"].map(k => opt(k, cap(k))),
      equipmentCategoryOptions: Object.entries(EQUIPMENT_CATEGORY_LABEL).map(([k, l]) => opt(k, l)),
      gemOptions: [opt("", "None"), ...Object.entries(FOCUS_GEMS).map(([k, g]) => opt(k, `${g.label}${g.damageType ? ` (${g.damageType})` : ""}`))],
      featTypeOptions: [opt("learned", "Learned (bought with XP)"), opt("trait", "Trait (from a Transformation or a creature)"), opt("ancestry", "Origin (granted, free)")],
      dieOptions: [6, 8, 10, 12, 20].map(n => opt(n, `d${n}`)),
      patternShapes: PATTERN_SHAPES.map(s => opt(s, cap(s))),
      typeOptions: typeOptions(sys.requires ?? sys.types ?? []).map(t => ({ ...t, help: lookup(t.key)?.text ?? lookup(t.label)?.text ?? "" })),
      effectOptions: effectOptions(),
      qualityOptions: qualityOptions(),
      familyOptions: InstrumentTypeData.FAMILIES.map(k => opt(k, cap(k))),
      reloadOptions: [opt("", "None"), opt("quick", "Quick Action"), opt("action", "Action")],
      qualityKinds: QualityData.KINDS.map(k => opt(k, cap(k))),
      qualityScopes: QualityData.SCOPES.map(k => opt(k, cap(k))),
      pricingKinds: EffectData.PRICING_KINDS.map(k => ({ value: k, label: cap(k), hint: PRICING_KIND_INFO[k] ?? "" })),
      modifierTypeOptions: [opt("training", "Training"), opt("resistance", "Resistance")],
      rangeOptions: withCurrent(RANGE_CHOICES, sys.range),
      originOptions: [opt("", "None"), ...withCurrent([...ORIGIN_NAMES, ...worldNames("origin")].sort(), sys.ancestryGrant || sys.ancestry)],
      techniqueNameOptions: [opt("", "None"), ...withCurrent([...packNames("foil.techniques"), ...worldNames("technique")].sort(), sys.grantsTechnique)],
      familyChoices: [opt("", "None (Innate)"), ...withCurrent(Object.keys(TECHNIQUE_FAMILIES), sys.family)],
      subgroupGroups: [{ label: "", options: [opt("", "None")] },
        ...Object.entries(TECHNIQUE_FAMILIES).filter(([, g]) => g.length).map(([f, g]) => ({ label: f, options: g.map(x => opt(x, x)) })),
        ...(sys.subgroup && !Object.values(TECHNIQUE_FAMILIES).some(g => g.includes(sys.subgroup)) ? [{ label: "Other", options: [opt(sys.subgroup, sys.subgroup)] }] : [])],
      modifierKeyGroups: [
        { label: "Skills", options: SKILL_KEYS.map(k => opt(k, SKILL_LABEL[k])) },
        { label: "Resistance", options: RESISTANCE_KINDS.map(k => opt(k, RESISTANCE_LABEL[k])) },
        { label: "One Attribute", options: ATTRIBUTE_KEYS.map(k => opt(k, `${ATTR_LABEL[k]} only`)) }
      ]
    };

    const effectRows = list => (list ?? []).map((e, idx) => ({ idx, ...e, label: entryLabel(e, em[e.key]), help: lookup(String(e.key).split("-")[0])?.text ?? "" }));
    if (this.item.type === "technique") ctx.effectRows = effectRows(sys.effects);
    if (this.item.type === "instrument") {
      ctx.enchantEffectRows = effectRows(sys.enchantment?.effects);
      ctx.kitRows = (sys.kit ?? []).map((k, idx) => ({ idx, ...k }));
    }
    if (this.item.type === "equipment") {
      ctx.qualityRows = (sys.qualities ?? []).map((q, idx) => {
        const scope = qm[q.key]?.scope ?? (q.key === "resistance" ? "resistanceKind" : q.key === "skill-bonus" ? "skill" : "free");
        const choices = scope === "resistanceKind"
                        ? [...RESISTANCE_KINDS.map(k => opt(k, RESISTANCE_LABEL[k])), ...ATTRIBUTE_KEYS.map(k => opt(k, `${ATTR_LABEL[k]} only`))]
                      : scope === "skill" ? SKILL_KEYS.map(k => opt(k, SKILL_LABEL[k]))
                      : scope === "attribute" ? ATTRIBUTE_KEYS.map(k => opt(k, ATTR_LABEL[k])) : null;
        // A blank choice for generic gear (a one-Attribute Ward, a charm) until the player picks one.
        const withBlank = choices && !q.param ? [opt("", "Choose..."), ...choices] : choices;
        return { idx, ...q, choices: withBlank?.map(c => ({ ...c, selected: c.value === q.param })) ?? null };
      });
    }
    if (this.item.type === "feat") {
      ctx.modifierRows = (sys.modifiers ?? []).map((m, idx) => ({ idx, ...m }));
    }
    if (this.item.type === "origin") {
      ctx.talentRows = (sys.talent ?? []).map((t, idx) => ({ idx, ...t }));
      ctx.featRows = (sys.feats ?? []).map((name, idx) => ({ idx, name }));
    }
    if (this.item.type === "background") {
      ctx.knowHowRows = (sys.knowHow ?? []).map((attribute, idx) => ({ idx, attribute }));
      ctx.trainingRows = SKILL_KEYS.map(k => ({ key: k, label: SKILL_LABEL[k], value: sys.training?.[k] ?? 0 }));
    }
    return ctx;
  }

  // ─── Array editors: one add/remove pair keyed by the array's path ───────────

  static ROW_DEFAULTS = {
    "system.effects": { key: "", magnitude: 1, pattern: "single", bands: 0, placement: 0, selectiveR: 0 },
    "system.enchantment.effects": { key: "", magnitude: 1, pattern: "single", bands: 0, placement: 0, selectiveR: 0 },
    "system.qualities": { key: "", value: 0, param: "" },
    "system.modifiers": { type: "training", key: "", value: 0 },
    "system.kit": { name: "", skill: "prowess", effect: "" },
    "system.talent": { attribute: "might", die: 8 },
    "system.feats": "",
    "system.knowHow": "might"
  };

  static async _onAddRow(event, target) {
    const path = target.dataset.path;
    if (!(path in FoilItemSheet.ROW_DEFAULTS)) return;
    const list = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? []);
    list.push(foundry.utils.deepClone(FoilItemSheet.ROW_DEFAULTS[path]));
    await this.item.update({ [path]: list });
  }

  static async _onRemoveRow(event, target) {
    const path = target.dataset.path;
    const list = foundry.utils.deepClone(foundry.utils.getProperty(this.item, path) ?? []);
    list.splice(Number(target.dataset.index), 1);
    await this.item.update({ [path]: list });
  }

  static _onEditImage(event, target) {
    const FP = foundry.applications?.apps?.FilePicker?.implementation
            ?? foundry.applications?.apps?.FilePicker ?? FilePicker;
    new FP({ type: "image", current: this.item.img, callback: path => this.item.update({ img: path }) }).render(true);
  }
}
