/**
 * src/data/actor-models.js
 * TypeDataModels for the character and creature actors (Foilbound 0.6.0).
 * Both share the four Attributes, six Skills, Habits, Foil Tokens,
 * Resistance, and active Conditions. Attribute state is Potential
 * {current, max}: max is derived from the dice pool, current is stored and
 * lowered as Stress lands. No pooled Total Potential for characters (PHB Key Terms);
 * creatures show it as GM shorthand.
 */

import { f, attributeSchema, skillSchema, int, str, html } from "./fields.js";
import { poolFromCounts } from "../dice.js";
import {
  ATTRIBUTE_KEYS, SKILL_ATTRS, SKILL_KEYS, ATTRIBUTE_KIND, RESISTANCE_KINDS, FOIL_AXES,
  FOIL_LEANS, FOIL_TOKEN_MAX, LEGACY_SKILL_KEY, CARRY_FREE_MULTIPLE, RATION_LBS
} from "../constants.js";
import { aggregateModifiers } from "../modifiers.js";
import { skillFormula } from "../combat.js";

function foilSchema() {
  const axes = {};
  for (const a of FOIL_AXES) {
    axes[a.key] = new f.SchemaField({
      lean: new f.StringField({ required: true, blank: true, initial: "", choices: FOIL_LEANS }),
      habit: str("")
    });
  }
  return new f.SchemaField(axes);
}

function coreSchema() {
  const attrs = {};
  for (const k of ATTRIBUTE_KEYS) attrs[k] = attributeSchema();
  const skills = {};
  for (const k of SKILL_KEYS) skills[k] = skillSchema();
  return {
    attributes: new f.SchemaField(attrs),
    skills: new f.SchemaField(skills),
    // One Habit per FOIL axis, leaning High, Low, or Neutral; blank until declared (PHB 3.4.0).
    foil: foilSchema(),
    // Earned by invoking a held Habit, spent to halve one source's Stress or reroll a die (PHB 3.2.0).
    foilTokens: int(0, { min: 0, max: FOIL_TOKEN_MAX }),
    // A stated base; Equipment and Feats add on top (PHB 6.6.0).
    resistance: new f.SchemaField({ physical: int(0), mental: int(0) }),
    conditions: new f.ArrayField(new f.SchemaField({
      name: str(""), rounds: str(""), note: str("")
    }))
  };
}

/** Stress down to half Potential or less lifts Incapacitation (PHB 6.8.1). */
export function recoveryThreshold(max) {
  return max - Math.floor(max / 2);
}

function prepareCore(sys) {
  const items = sys.parent?.items?.contents ?? [];
  const mods = aggregateModifiers(items);

  const attrs = sys.attributes ?? {};
  for (const key of ATTRIBUTE_KEYS) {
    const a = attrs[key];
    if (!a) continue;
    const pool = poolFromCounts(a.dice);
    a.potential ??= {};
    const current = Number(a.potential.current ?? 0);
    a.potential.max = pool.max;
    a.dieCount      = pool.dieCount;
    a.diceFormula   = pool.formula;
    a.min           = pool.min;
    a.avg           = pool.avg;
    a.max           = pool.max;
    // Stored flag, plus a floor: a bar at zero is always Incapacitated.
    a.down          = pool.max > 0 && (!!a.incapacitated || current <= 0);
    a.recoverAt     = recoveryThreshold(pool.max);
    a.validPool     = pool.valid;
    a.kind          = ATTRIBUTE_KIND[key];
  }

  sys.resistance ??= {};
  for (const kind of RESISTANCE_KINDS) {
    const base  = Number(sys.resistance[kind] ?? 0);
    const bonus = Number(mods.resistance[kind] ?? 0);
    const from = base ? [{ name: "Base", value: base }, ...(mods.resistanceSources?.[kind] ?? [])]
                      : (mods.resistanceSources?.[kind] ?? []);
    sys.resistance[`${kind}Base`]  = base;
    sys.resistance[`${kind}Bonus`] = bonus;
    sys.resistance[`${kind}Total`] = base + bonus;
    sys.resistance[`${kind}FromLabel`] = from.map(e => `+${e.value} ${e.name}`).join(", ");
  }
  // Resistance made for one Attribute (PHB 5.2.4) adds to its kind's total for that Attribute only.
  for (const key of ATTRIBUTE_KEYS) {
    const a = attrs[key];
    if (!a) continue;
    const extra = Number(mods.attributeResistance?.[key] ?? 0);
    a.resistanceExtra = extra;
    a.resistanceTotal = Number(sys.resistance[`${a.kind}Total`] ?? 0) + extra;
    a.resistanceFromLabel = (mods.attributeResistanceSources?.[key] ?? []).map(e => `+${e.value} ${e.name}`).join(", ");
  }

  // Mass (PHB 5.2.6): everything equipped or carried, worn Armor included.
  const might = attrs.might?.potential?.max ?? 0;
  const carried = items.reduce((n, it) => n + Number(it.system?.carriedWeight ?? 0), 0)
                + Number(sys.rations ?? 0) * RATION_LBS;
  sys.carry = {
    weight: carried,
    rationMass: Number(sys.rations ?? 0) * RATION_LBS,
    rationEach: RATION_LBS,
    limit: CARRY_FREE_MULTIPLE * might,
    penalty: might > 0 && carried > CARRY_FREE_MULTIPLE * might
      ? Math.ceil(carried / might) - CARRY_FREE_MULTIPLE : 0
  };

  const skills = sys.skills ?? {};
  for (const [key, pair] of Object.entries(SKILL_ATTRS)) {
    const sk = skills[key];
    if (!sk) continue;
    sk.attributes    = pair;
    sk.trainingBase  = Number(sk.training ?? 0);
    sk.trainingBonus = Number(mods.training[key] ?? 0);
    sk.trainingTotal = sk.trainingBase + sk.trainingBonus;
    // Gear's +N to a Skill adds to rolls without being Training (PHB 7.5.4).
    sk.skillBonus    = Number(mods.skillBonus?.[key] ?? 0);
    const flat       = sk.trainingTotal + sk.skillBonus;
    // Training can't pass the dice in the Skill's two pools (PHB 2.2.1).
    sk.trainingCap  = pair.reduce((n, ak) => n + (attrs[ak]?.dieCount ?? 0), 0);
    sk.overCap      = sk.trainingTotal > sk.trainingCap;

    const live = ak => (attrs[ak]?.down ? null : attrs[ak]);
    const sum  = field => pair.reduce((n, ak) => n + (live(ak) ? Number(live(ak)[field] ?? 0) : 0), 0);
    sk.rollMin = sum("min") + flat;
    sk.rollAvg = sum("avg") + flat;
    sk.rollMax = sum("max") + flat;
    // A creature that isn't pushing back sets its passive value as the Difficulty (PHB 2.2.2).
    sk.passive = Math.floor(sum("avg")) + flat;

    const parts = pair.filter(ak => live(ak)?.diceFormula).map(ak => attrs[ak].diceFormula);
    if (flat) parts.push(String(flat));
    sk.formula = parts.join(" + ") || "0";
    sk.usable  = pair.some(ak => live(ak)?.diceFormula);
  }

  // Initiative is an Acuity roll and a Stealth roll is Guile (PHB 6.2.0, 6.2.1); Feats add to each.
  sys.initiativeBonus = Number(mods.initiative ?? 0);
  sys.stealthBonus = Number(mods.stealth ?? 0);
  sys.initiativeFormula = skillFormula(sys, "acuity", sys.initiativeBonus);
  sys.stealthFormula = skillFormula(sys, "guile", sys.stealthBonus);

  // Destroyed (PHB 6.8.2): every Attribute Incapacitated at once.
  const active = ATTRIBUTE_KEYS.filter(k => (attrs[k]?.potential?.max ?? 0) > 0);
  sys.destroyed = active.length > 0 && active.every(k => attrs[k].down);
}

// ─── Migration from pre-0.6.0 worlds ─────────────────────────────────────────

/** Pre-0.2.0 stored Resistance per Attribute; take the higher of each pair. */
function migrateResistance(source) {
  if (!source?.attributes || source.resistance) return source;
  const at = source.attributes;
  const of = k => Number(at?.[k]?.resistance ?? 0);
  const physical = Math.max(of("might"), of("finesse"));
  const mental   = Math.max(of("wit"), of("presence"));
  if (physical || mental) source.resistance = { physical, mental };
  for (const k of ATTRIBUTE_KEYS) if (at?.[k]) delete at[k].resistance;
  return source;
}

/** Aptitudes became Skills, and Fortitude and Command were renamed. */
function migrateSkills(source) {
  if (!source?.aptitudes) return source;
  source.skills ??= {};
  for (const [old, value] of Object.entries(source.aptitudes)) {
    const key = LEGACY_SKILL_KEY[old] ?? old;
    if (SKILL_KEYS.includes(key) && !source.skills[key]) source.skills[key] = { training: Number(value?.training ?? 0) };
  }
  delete source.aptitudes;
  return source;
}

/** FOIL axes were -5..+5 integers, then a lean and a `trait` string; now a lean and a Habit. */
function migrateFoil(source) {
  const foil = source?.foil;
  if (!foil) return source;
  if ("leniency" in foil && !("levity" in foil)) foil.levity = foil.leniency;
  delete foil.leniency;
  for (const a of FOIL_AXES) {
    const v = foil[a.key];
    if (typeof v === "number") foil[a.key] = { lean: v > 0 ? "high" : v < 0 ? "low" : "", habit: "" };
    else if (v && "trait" in v) { v.habit ??= v.trait; delete v.trait; }
    if (foil[a.key]?.lean === "neutral") foil[a.key].lean = "";
  }
  return source;
}

/** Action Points were retired for one Action and one Quick Action (PHB 6.1.0). */
function migrateActions(source) {
  if (source && "ap" in source) delete source.ap;
  return source;
}

/** A bar at zero is Incapacitated. */
function migrateIncapacitated(source) {
  for (const k of ATTRIBUTE_KEYS) {
    const a = source?.attributes?.[k];
    if (a && a.incapacitated === undefined && a.potential && Number(a.potential.current) <= 0
        && Object.values(a.dice ?? {}).some(n => Number(n) > 0)) a.incapacitated = true;
  }
  return source;
}

function migrateCore(source) {
  return migrateIncapacitated(migrateActions(migrateFoil(migrateSkills(migrateResistance(source)))));
}

export class CharacterData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    migrateCore(source);
    if (source && "origin" in source && !("ancestry" in source)) source.ancestry = source.origin;
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      ...coreSchema(),
      player: str(""),
      ancestry: str(""),
      background: str(""),
      coin: str(""),
      rations: int(0, { min: 0 }),
      xp: new f.SchemaField({ total: int(0), spent: int(0) }),
      prompts: new f.SchemaField({
        whoTheyAre: str(""), wants: str(""), fightFor: str(""), fears: str("")
      }),
      notes: html("")
    };
  }

  prepareDerivedData() {
    prepareCore(this);
    this.xp.available = Number(this.xp.total ?? 0) - Number(this.xp.spent ?? 0);
  }
}

export class CreatureData extends foundry.abstract.TypeDataModel {
  static migrateData(source) {
    migrateCore(source);
    if (source && typeof source.tier === "string") {
      const n = parseInt(source.tier, 10);
      source.tier = Number.isFinite(n) ? n : 1;
    }
    return super.migrateData(source);
  }

  static defineSchema() {
    return {
      ...coreSchema(),
      tier: int(1, { min: 1 }),
      cr: str(""),
      // What it does once an Attribute is Incapacitated (GMG 4.8.0). Blank: it Holds.
      behavior: str(""),
      // Vulnerable N to an Instrument Type, Material, or damage type (PHB 6.6.0, GMG 4.3.0).
      vulnerable: str(""),
      notes: html("")
    };
  }

  prepareDerivedData() {
    prepareCore(this);
    // Total Potential: the four Potentials added together, creature-building shorthand (PHB Key Terms).
    this.health = ATTRIBUTE_KEYS.reduce((n, k) => n + (this.attributes[k]?.potential?.max ?? 0), 0);
  }
}
