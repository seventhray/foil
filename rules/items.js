/**
 * rules/items.js
 * What an item derives from its stored data: an Instrument's weight, Range, Skills, price and Type effects,
 * Enchantment; a Technique's XP cost, Strain, requirements and summary; Equipment's carried
 * weight; a Material's price and Mass a batch; Background and Origin summaries. Pure: each function works on a plain object and sets derived fields
 * on it in place. The registry ({ instrumentTypes, effects }, slug-keyed definitions) is passed in, so Foundry
 * and the companion app run the same code against the same definitions.
 */

import {
  WEIGHT_CLASS, SKILL_KEYS, SKILL_LABEL, PRIMARY_SKILLS, BONUS_PRICE, MATERIAL_TIER_PRICE, SIZE, TYPE_SURCHARGE,
  REACH_PRICE_PER_BAND, RANGE_BANDS, RANGE_LABEL, rangeBandOf, usualRange, rangeTextFor, RESISTANCE_LABEL, ATTR_LABEL,
  MATERIAL_CATEGORY_LABEL, MATERIAL_SCARCITY_LABEL, MATERIAL_SCARCITY_MULT, MATERIAL_BATCH_LBS, CONDITION_ATTR
} from "./constants.js";
import { priceTechnique, strainFor, SELECTIVE_PREMIUM } from "./pricing.js";

const ARCANE_TYPES = ["kinetic", "incorporeal", "fortifying"];

/** The Instrument Types an item carries, resolved against the registry's Type definitions. */
function resolveTypes(types, reg = {}) {
  return { reg, defs: types.map(k => reg[k]).filter(Boolean), unknown: types.filter(k => !reg[k]) };
}

/** An Instrument's derived fields. */
export function deriveInstrument(sys, registry = {}) {
  const types = sys.types ?? [];
  const { defs, unknown } = resolveTypes(types, registry.instrumentTypes);
  const w = WEIGHT_CLASS[sys.weight] ?? WEIGHT_CLASS.light;
  sys.weightLabel = w.label;
  // Weight dice on offensive rolls; Heavy takes both hands (PHB 4.1.1).
  sys.twoHanded = sys.weight === "heavy";
  // Heavy: the Action and the Quick Action, margin doubled before the cap (PHB 4.1.1, 6.7.0).
  sys.doublesMargin = !sys.innate && sys.weight === "heavy";
  sys.marginMultiplier = sys.innate ? 1 : (w.mult ?? 1);
  sys.weightDice = sys.innate ? "" : (w.dice ?? "");
  if (sys.innate) sys.location = "equipped";
  sys.equipped = sys.location === "equipped";
  sys.carriedWeight = sys.innate ? 0 : w.lbs;
  sys.rangeBand = sys.maxRange || rangeBandOf(sys.range);
  sys.range = rangeTextFor(sys.minRange, sys.rangeBand) || sys.range;
  sys.primarySkills = PRIMARY_SKILLS[sys.primaryAttribute] ?? [];
  sys.typesLabel = sys.typesDisplay || types.map(k => defs.find(d => d.key === k)?.label ?? k).join(", ");

  // Price formula (PHB 5.2.2): weight class + Type surcharges + 10p per band past the usual Range.
  const channels = types.filter(t => ARCANE_TYPES.includes(t));
  const surcharge = types.reduce((n, t) => n + (TYPE_SURCHARGE[t] ?? 0), 0)
    - (sys.typesDisplay && channels.length > 1 ? (channels.length - 1) * 5 : 0);
  const usual = usualRange(sys.category, sys.weight, types);
  const extra = Math.max(0, RANGE_BANDS.indexOf(sys.rangeBand) - RANGE_BANDS.indexOf(usual));
  const typeTerms = types.filter(t => TYPE_SURCHARGE[t]).map(t => `${defs.find(d => d.key === t)?.label ?? t} ${TYPE_SURCHARGE[t]}`);
  const shared = sys.typesDisplay && channels.length > 1 ? (channels.length - 1) * 5 : 0;
  sys.priceMath = [`${w.label} ${w.price}`, ...typeTerms, ...(shared ? [`pick-one channels -${shared}`] : []),
    `reach ${REACH_PRICE_PER_BAND * extra} (${extra} step${extra === 1 ? "" : "s"} past the usual ${RANGE_LABEL[usual] ?? usual}, x${REACH_PRICE_PER_BAND})`].join(" + ")
    .replace(/\+ pick-one channels -/, "- pick-one channels ");
  // Tools sit on their own cheap penny scale, outside the formula (Fundamental Math).
  const formulaApplies = !sys.innate && sys.category !== "tool";
  sys.formulaPrice = formulaApplies ? w.price + surcharge + REACH_PRICE_PER_BAND * extra : sys.price;
  sys.priceMismatch = formulaApplies && sys.price !== sys.formulaPrice;
  sys.bonusPrice = (BONUS_PRICE[sys.size] ?? BONUS_PRICE.medium)[sys.bonus] ?? 0;
  // Its materials' Tier: what it was built at, or more (PHB 5.3.1). An Enchantment needs at least its own Tier (PHB 5.3.4).
  sys.materialTier = Math.max(Number(sys.tier ?? 0), Number(sys.bonus ?? 0));
  // Crafting (PHB 5.3.2): the size's batches at the item's Tier (its bonus).
  sys.craftCost = (SIZE[sys.size]?.batches ?? 2) * (MATERIAL_TIER_PRICE[sys.bonus] ?? 0);
  sys.bonusMath = `+${sys.bonus} on a ${SIZE[sys.size]?.label ?? sys.size} item = ${sys.bonusPrice}p (PHB 7.10.1)`;
  sys.craftMath = `${SIZE[sys.size]?.batches ?? 2} batches (${SIZE[sys.size]?.label ?? sys.size}) x Tier ${sys.bonus} Common ${MATERIAL_TIER_PRICE[sys.bonus] ?? 0}p = ${sys.craftCost}p (PHB 5.3.1, 5.3.2)`;

  // Type effects (PHB 4.1.1).
  // A Light Instrument's built-ins can use the Quick Action (PHB 4.1.1). The Quick Type
  // survives only for a creature's natural weapon chosen to work that way (GMG 9.6.0).
  sys.quick = sys.weight === "light" || defs.some(d => d.quick);
  sys.reload = defs.find(d => d.reload)?.reload ?? "";
  sys.blockingOnly = defs.some(d => d.blocking) && !defs.some(d => d.family === "melee" || d.family === "ranged");
  sys.stressTypes = defs.filter(d => d.stressPhysical || d.stressMental || d.pierce || d.dealsNoStress || d.doubleResistance)
    .map(d => ({ key: d.key, family: d.family, label: d.label, physical: d.stressPhysical, mental: d.stressMental,
                 pierce: d.pierce, doubleResistance: d.doubleResistance, dealsNoStress: d.dealsNoStress }));

  // +N (PHB 5.2.1): +N to rolls, Pierce half of N (rounded down) for Melee or Ranged;
  // Blocking-only is Oppose-only.
  const meleeOrRanged = defs.some(d => d.family === "melee" || d.family === "ranged");
  sys.isMelee = defs.some(d => d.family === "melee");
  sys.bonusRoll   = sys.blockingOnly ? 0 : sys.bonus;
  sys.bonusPierce = !sys.blockingOnly && meleeOrRanged ? Math.floor(sys.bonus / 2) : 0;
  sys.bonusOppose = sys.blockingOnly ? sys.bonus : 0;

  // An enchanted bonus (PHB 5.3.4).
  const eb = sys.enchantment?.bonus ?? {};
  sys.enchantSkill = { skill: "", n: 0 };
  sys.enchantStress = 0;
  sys.enchantRoll = 0;
  sys.enchantPierce = 0;
  if (eb.kind) {
    // 10p per XP, from the Effects table: a Skill or roll point 6 XP, Pierce 4, Stress 8 (PHB 5.3.4).
    const perPoint = { skill: 60, roll: 60, pierce: 40, stress: 80 }[eb.kind] ?? 0;
    const price = perPoint * eb.n;
    const what = { skill: `+${eb.n} ${SKILL_LABEL[eb.skill] ?? "Skill"}`, roll: `+${eb.n} to its rolls`, pierce: `Pierce ${eb.n}`,
                   stress: `+${eb.n} Stress after the margin` }[eb.kind];
    sys.enchantBonus = { price, label: what, ...enchantWork(price, eb.n), materialTier: eb.n };
    if (eb.kind === "roll") { sys.bonusRoll += eb.n; sys.enchantRoll = eb.n; }
    else if (eb.kind === "pierce") { sys.bonusPierce += eb.n; sys.enchantPierce = eb.n; }
    else if (eb.kind === "stress") sys.enchantStress = eb.n;
    else if (eb.kind === "skill") sys.enchantSkill = { skill: eb.skill, n: eb.n };
  } else sys.enchantBonus = null;

  sys.isArcane = channels.length > 0;

  sys.typeWarning = types.length === 0 && !sys.innate
    ? "No Instrument Types set: this Instrument can't be used for anything."
    : unknown.length ? `Unresolved Instrument Type(s): ${unknown.join(", ")}.` : "";

  // Its three built-in Techniques (PHB 7.4.0), each with what it means, as a Technique's fullText says it.
  for (const k of sys.kit ?? []) {
    k.explain = explainKit(k);
    const printed = String(k.effect ?? "").trim();
    k.fullText = [printed && !/[.!?]$/.test(printed) ? `${printed}.` : printed, k.explain].filter(Boolean).join(" ");
  }

  // Enchanting (PHB 5.3.4): priced like a custom Technique, sold at 10p per XP.
  const ench = sys.enchantment ?? {};
  const effects = registry.effects ?? null;
  const priced = effects && ench.enabled ? priceTechnique(ench.effects ?? [], effects) : { xp: 0, breakdown: [] };
  ench.xpCost = priced.xp;
  ench.strain = priced.strain ?? strainFor(priced.xp);
  ench.price  = priced.xp * 10;
  const x = priced.xp;
  ench.materialTier = !x ? 0 : x <= 8 ? 1 : x <= 16 ? 2 : x <= 24 ? 3 : 4;
  Object.assign(ench, x ? enchantWork(ench.price, ench.materialTier) : { difficulty: 0, hours: 0, workStrain: 0 });
  const text = ench.effectText || (priced.breakdown ?? []).map(b => b.label).join(", ");
  ench.effectSummary = ench.strain ? (text ? `${text}, Strain ${ench.strain}` : `Strain ${ench.strain}`) : text;
}

/**
 * Enchanting's work (PHB 5.3.4): Crafting's time, 2 hours per 10p rounded up to a whole 2 hours; the Difficulty two
 * rungs above the Tier's; 1 Strain to each of the enchanter's Attributes per 2 hours.
 */
export function enchantWork(price, tier) {
  const hours = 2 * Math.ceil(price / 10);
  return { difficulty: [20, 24, 32, 48, 64][tier - 1] ?? 0, hours, workStrain: hours / 2 };
}

/** A Technique's derived fields. */
export function deriveTechnique(sys, registry = {}) {
  const effects = registry.effects ?? null;
  const types = sys.requires ?? [];
  const { defs, unknown } = resolveTypes(types, registry.instrumentTypes);
  const fortifying = types.includes("fortifying");
  const priced = effects ? priceTechnique(sys.effects ?? [], effects, { floor: sys.floor || fortifying })
                          : { xp: 0, breakdown: [] };
  sys.xpCost = priced.xp;
  sys.perTarget = (sys.effects ?? []).some(e => e.key === "selective");
  sys.strain = strainFor(sys.xpCost - (sys.perTarget ? SELECTIVE_PREMIUM : 0));
  sys.pricingBreakdown = priced.breakdown;
  sys.priceMath = priced.math ?? "";

  const has = key => (sys.effects ?? []).filter(e => e.key === key);
  const sum = key => has(key).reduce((n, e) => n + Number(e.magnitude ?? 0), 0);
  sys.quick      = has("quick").length > 0;
  sys.upkeep     = has("upkeep").length > 0;
  sys.dealsStress = has("stress").length > 0;
  sys.rollBonus  = sum("roll-bonus");
  sys.pierceTotal = sum("pierce");
  sys.stressRider = has("stress-rider").length;
  // Used against a target (PHB 6.4.0): the weight dice apply only to these.
  const TARGETED = new Set(["stress", "stress-rider", "weaken", "weaken-minute", "reeling", "reeling-minute", "move", "drain", "lingering", "illusion", "counter",
    "grappled", "prone", "restrained", "charmed", "frightened", "controlled", "intimidated", "baited",
    "angered", "relaxed", "impressed", "wary", "enthralled", "blinded", "slowed", "stunned", "disarm", "foil-exposed"]);
  sys.offensive = (sys.effects ?? []).some(e => TARGETED.has(e.key) || (e.key.startsWith("skill-mod") && Number(e.magnitude) < 0));

  const sameSet = group => group.length === types.length && group.every(k => types.includes(k));
  sys.requiresLabel = sys.innate ? "Innate"
    : sameSet(["thrown", "drawn", "fired"]) ? "Ranged"
    : sameSet(["edged", "pointed", "blunt", "grappling", "parry"]) ? "Melee"
    : types.length ? types.map(k => defs.find(d => d.key === k)?.label ?? k).join(" or ") : "Any";
  sys.typeWarning = unknown.length ? `Unresolved Instrument Type(s) in Requirement: ${unknown.join(", ")}.` : "";

  const base = (priced.breakdown ?? []).map(b => b.label).join(", ");
  sys.effectSummary = sys.strain ? (base ? `${base}, Strain ${sys.strain}${sys.perTarget ? " per target" : ""}` : `Strain ${sys.strain}`) : base;
  sys.explain = explainTechnique(sys, effects);
  // The printed line and what it means, as one text for a sheet.
  const printed = String(sys.effectText || sys.effectSummary || "").trim();
  sys.fullText = [printed && !/[.!?]$/.test(printed) ? `${printed}.` : printed, sys.explain].filter(Boolean).join(" ");
}

/**
 * What a Technique does and who opposes it, in a sentence or two (PHB 6.4.0, 6.5.0; user 2026-10-27: a Technique's one line should say
 * at least what it applies and what opposes it). Stress goes to the Attribute its user names, and the target opposes with a Skill built
 * on it. A Condition alone is opposed through the Attribute it names. A Technique that targets no hostile takes no roll.
 */
export function explainTechnique(sys, effectDefs = null) {
  const list = sys.effects ?? [];
  const label = e => effectDefs?.[e.key]?.label ?? e.key;
  const conds = list.map(label).filter(l => l in CONDITION_ATTR && l !== "Reeling");
  const weaken = list.find(e => String(e.key).startsWith("weaken"));
  const reeling = list.find(e => String(e.key).startsWith("reeling"));
  const out = [];
  if (sys.dealsStress) out.push("Deals Stress to an Attribute you name; the target opposes with a Skill built on it.");
  if (weaken) out.push(`${sys.dealsStress ? "Also gives" : "Gives"} -${weaken.magnitude ?? 1} to an Attribute you name${weaken.key.endsWith("minute") ? " for 1 minute" : " for 1 round"}${sys.dealsStress ? "." : "; the target opposes with a Skill built on it."}`);
  if (reeling) out.push(`${sys.dealsStress || weaken ? "Also applies" : "Applies"} Reeling (-${reeling.magnitude ?? 1} to its Opposes)${sys.dealsStress || weaken ? "." : "; the target opposes with a Finesse Skill."}`);
  for (const c of conds) {
    const attr = ATTR_LABEL[CONDITION_ATTR[c]] ?? CONDITION_ATTR[c];
    out.push(sys.dealsStress || weaken || reeling ? `Also applies ${c}.` : `Applies ${c}; the target opposes with a ${attr} Skill.`);
  }
  if (!out.length && !sys.offensive && list.length) out.push("It takes no roll.");
  return out.join(" ");
}

/**
 * Who opposes one of an Instrument's built-in Techniques, as explainTechnique says it for a Technique (PHB 6.5.0, 6.8.0). Its printed
 * line already names what it does. Stress goes to the Attribute its user names; a Condition is opposed through the Attribute it names,
 * and Weakened through the one in its brackets. A move that targets no hostile adds nothing.
 */
export function explainKit(kit) {
  const effect = String(kit?.effect ?? "").trim();
  if (/^Deals Stress\b/i.test(effect)) return "The target opposes with a Skill built on the Attribute you name.";
  const m = effect.match(/^Applies (Foil Exposed|\w+)(?: \[(\w+)\])?/i);
  if (!m) return "";
  const attr = m[1] === "Weakened" ? Object.keys(ATTR_LABEL).find(k => ATTR_LABEL[k].toLowerCase() === String(m[2] ?? "").toLowerCase()) : CONDITION_ATTR[m[1]];
  return attr ? `The target opposes with a ${ATTR_LABEL[attr]} Skill.` : "";
}

/** A piece of Equipment's derived fields. */
export function deriveEquipment(sys, registry = {}) {
  const wc = WEIGHT_CLASS[sys.weightClass];
  sys.equipped = sys.location === "equipped";
  sys.carriedWeight = Number(sys.weight) || (wc ? wc.lbs : 0);
  sys.weightClassLabel = wc?.label ?? "";
  sys.materialPrice = MATERIAL_TIER_PRICE[sys.tier] ?? 0;
  sys.materialTier = Number(sys.tier ?? 0);
  // An enchanted bonus (PHB 5.3.4): Resistance +N or +N to a Skill, at the +N price for the item's size.
  const eb = sys.enchantment?.bonus ?? {};
  if (eb.kind) {
    const price = (BONUS_PRICE[sys.size] ?? BONUS_PRICE.small)[eb.n] ?? 0;
    const what = eb.kind === "resistance" ? `Resistance +${eb.n}${eb.param ? ` (${RESISTANCE_LABEL[eb.param] ?? ATTR_LABEL[eb.param] ?? eb.param})` : ""}`
      : `+${eb.n} ${SKILL_LABEL[eb.param] ?? "Skill"}`;
    sys.enchantBonus = { price, label: what, ...enchantWork(price, eb.n), materialTier: eb.n };
  } else sys.enchantBonus = null;
  // A Technique bound to it (PHB 5.3.4): one that takes no roll, since Equipment has no Instrument Types. Its Strain goes to every Attribute.
  const ench = sys.enchantment ?? {};
  if (ench.enabled && registry.effects) {
    const priced = priceTechnique(ench.effects ?? [], registry.effects);
    ench.xpCost = priced.xp;
    ench.strain = priced.strain ?? strainFor(priced.xp);
    ench.price = priced.xp * 10;
    ench.materialTier = !priced.xp ? 0 : priced.xp <= 8 ? 1 : priced.xp <= 16 ? 2 : priced.xp <= 24 ? 3 : 4;
    Object.assign(ench, priced.xp ? enchantWork(ench.price, ench.materialTier) : { difficulty: 0, hours: 0, workStrain: 0 });
    const text = ench.effectText || (priced.breakdown ?? []).map(b => b.label).join(", ");
    ench.effectSummary = ench.strain ? `${text}, Strain ${ench.strain} on every Attribute` : text;
  }
}

/** A Consumable's derived fields (PHB 7.9.5): the stack's Mass, each one's times its quantity, and its uses as a number. */
export function deriveConsumable(sys) {
  sys.quantity = Math.max(0, Math.trunc(Number(sys.quantity ?? 1)));
  sys.carriedWeight = (Number(sys.weight) || 0) * sys.quantity;
  const n = String(sys.uses ?? "").trim();
  sys.usesLeft = /^\d+$/.test(n) ? Number(n) : null;
}

/** A batch's price: its Tier's price times its Scarcity, to the nearest penny (PHB 5.3.1). */
export const materialBatchPrice = (tier, scarcity) => Math.round((MATERIAL_TIER_PRICE[tier] ?? 0) * (MATERIAL_SCARCITY_MULT[scarcity] ?? 1));

/** A Material's derived fields (PHB 5.3.1, 5.2.6): its price and Mass a batch, and the Mass of all its batches. A Mass set on the
 *  item replaces its category's. */
export function deriveMaterial(sys) {
  sys.categoryLabel = MATERIAL_CATEGORY_LABEL[sys.category] ?? "";
  sys.scarcityLabel = MATERIAL_SCARCITY_LABEL[sys.scarcity] ?? "";
  sys.price = materialBatchPrice(Number(sys.tier ?? 0), sys.scarcity);
  sys.lbsEach = Number(sys.weight) || (MATERIAL_BATCH_LBS[sys.category] ?? 0);
  sys.carriedWeight = Math.round(Number(sys.batches ?? 0) * sys.lbsEach * 100) / 100;
}

/** A Background's derived fields. */
export function deriveBackground(sys) {
  const t = sys.training ?? {};
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  sys.grantsSummary = SKILL_KEYS.filter(k => Number(t[k]) > 0).map(k => `+${t[k]} ${cap(k)}`).join(", ");
  const counts = {};
  for (const a of sys.knowHow ?? []) counts[a] = (counts[a] ?? 0) + 1;
  sys.knowHowSummary = Object.entries(counts).map(([a, n]) => `${n}d4 ${cap(a)}`).join(", ");
}

/** An Origin's derived fields. */
export function deriveOrigin(sys) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  sys.talentSummary = (sys.talent ?? []).map(t => `${cap(t.attribute)} to d${t.die}`).join(", ");
  sys.featsSummary = (sys.feats?.length ? sys.feats : [sys.feat].filter(Boolean)).join(", ");
}
