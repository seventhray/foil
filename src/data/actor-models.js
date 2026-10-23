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
import { ATTRIBUTE_KEYS, SKILL_KEYS, FOIL_AXES, FOIL_LEANS, FOIL_TOKEN_MAX, LEGACY_SKILL_KEY } from "../constants.js";
import { deriveCharacter, deriveCreature, recoveryThreshold } from "../../rules/sheet.js";

export { recoveryThreshold };

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
      appearance: new f.SchemaField({
        age: str(""), height: str(""), weight: str(""), hair: str(""), eyes: str(""), skin: str(""),
        marks: str(""), other: str("")
      }),
      notes: html("")
    };
  }

  prepareDerivedData() {
    deriveCharacter(this, this.parent?.items?.contents ?? []);
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
      // The creature counterpart to XP (GMG 9.1.0); the tier is the table row nearest it.
      threat: int(0),
      // What it does once an Attribute is Incapacitated (GMG 9.8.0). Blank: it Holds.
      behavior: str(""),
      notes: html("")
    };
  }

  prepareDerivedData() {
    deriveCreature(this, this.parent?.items?.contents ?? []);
  }
}
