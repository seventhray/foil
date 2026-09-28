/**
 * src/data/actor-models.js
 * TypeDataModels for the character and creature actors. Both share the core
 * Attribute/Aptitude/AP schema and the same derivation (Potential max from the
 * dice pool, incapacitation, Aptitude nets, roll formulas). Attribute state is
 * Potential {current, max}: max is derived, current is stored and counted down
 * as Stress lands. No pooled Health — Destroyed is read off the four Attributes.
 */

import { f, attributeSchema, aptitudeSchema, int, str, html } from "./fields.js";
import { poolFromCounts } from "../dice.js";
import { ATTRIBUTE_KEYS, APTITUDE_ATTRS, ATTRIBUTE_KIND, RESISTANCE_KINDS } from "../constants.js";
import { aggregateModifiers } from "../modifiers.js";

function coreSchema() {
  const attrs = {};
  for (const k of ATTRIBUTE_KEYS) attrs[k] = attributeSchema();
  const apts = {};
  for (const k of Object.keys(APTITUDE_ATTRS)) apts[k] = aptitudeSchema();
  return {
    attributes: new f.SchemaField(attrs),
    aptitudes: new f.SchemaField(apts),
    ap: new f.SchemaField({ value: int(3), max: int(3) }),
    // FOIL Values (PHB §3.0.0): shared by characters and creatures alike, so
    // an NPC's convictions guide behaviour and give players something to press on (GMG §7.0.0).
    foil: new f.SchemaField({
      faith: int(0), order: int(0), individualism: int(0), levity: int(0)
    }),
    // Resistance is physical (Might + Finesse) or mental (Wit + Presence),
    // one value each (PHB §6.6.0). One suit of armor covers the body; one
    // ward covers the mind.
    resistance: new f.SchemaField({ physical: int(0), mental: int(0) })
  };
}

/**
 * Every FOIL axis moves a flat 1 point, Order included (PHB §3.2.0). Order's
 * variable Step was retired in v0.2.0, so there is nothing left to derive here.
 */
function prepareFoil(_sys) {}

/**
 * Shared derivation for both actor types. `doc` is the DataModel; its parent
 * document's items feed the Training/Resistance modifier aggregation.
 */
function prepareCore(doc) {
  const sys = doc;
  const items = doc.parent?.items?.contents ?? [];
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
    a.max           = pool.max;   // same number as potential.max, named to match min/avg
    a.incapacitated = pool.max > 0 && current <= 0;
    a.validPool     = pool.valid;
    a.kind = ATTRIBUTE_KIND[key];
  }

  // Resistance: stored base + worn-Equipment / Feat modifiers, per kind.
  sys.resistance ??= {};
  for (const kind of RESISTANCE_KINDS) {
    const base  = Number(sys.resistance[kind] ?? 0);
    const bonus = Number(mods.resistance[kind] ?? 0);
    // A character's Resistance comes from Equipment and Feats (PHB §6.6.0), so
    // the total leads and the contributors follow it. A stored base only turns
    // up on a GM-stated creature or a migrated actor; it rides along as a named
    // contributor rather than vanishing into an untraceable total.
    const from = base ? [{ name: "Base", value: base }, ...(mods.resistanceSources?.[kind] ?? [])]
                      : (mods.resistanceSources?.[kind] ?? []);
    sys.resistance[`${kind}Base`]  = base;
    sys.resistance[`${kind}Bonus`] = bonus;
    sys.resistance[`${kind}Total`] = base + bonus;
    sys.resistance[`${kind}From`]  = from;
    sys.resistance[`${kind}FromLabel`] =
      from.map(e => `+${e.value} ${e.name}`).join(", ");
  }

  // An Incapacitated Attribute (PHB §6.8.1) needs no summary status on top of
  // itself; the Incapacitated badges already say it. Destruction, below, is
  // a real state.

  const apts = sys.aptitudes ?? {};
  for (const [key, pair] of Object.entries(APTITUDE_ATTRS)) {
    const ap = apts[key];
    if (!ap) continue;
    ap.attributes = pair;
    // Training: stored base + Background / Feat modifiers.
    ap.trainingBase  = Number(ap.training ?? 0);
    ap.trainingBonus = Number(mods.training[key] ?? 0);
    ap.trainingTotal = ap.trainingBase + ap.trainingBonus;

    const potOf = ak => (attrs[ak]?.incapacitated ? 0 : (attrs[ak]?.potential?.max ?? 0));
    // What this Aptitude can actually roll right now, Training included.
    // Incapacitated Attributes contribute nothing, so the range narrows as a
    // character takes damage, which is the point of showing it.
    const live = ak => (attrs[ak]?.incapacitated ? null : attrs[ak]);
    const sum  = f => pair.reduce((n, ak) => n + (live(ak) ? Number(live(ak)[f] ?? 0) : 0), 0);
    ap.rollMin      = sum("min") + ap.trainingTotal;
    ap.rollAvg      = sum("avg") + ap.trainingTotal;
    ap.rollMax      = sum("max") + ap.trainingTotal;
    ap.netPotential = ap.rollMax;   // kept: same number, older name

    const parts = [];
    for (const ak of pair) {
      const a = attrs[ak];
      if (!a?.diceFormula || a.incapacitated) continue;
      parts.push(a.diceFormula);
    }
    if (ap.trainingTotal) parts.push(String(ap.trainingTotal));
    ap.formula = parts.join(" + ") || "0";
  }

  // Destroyed (PHB §6.8.2): every Attribute's Stress at its Potential at once.
  // Read off the four Attributes, not a separate pooled Health field.
  const active = ATTRIBUTE_KEYS.filter(k => (attrs[k]?.potential?.max ?? 0) > 0);
  sys.destroyed = active.length > 0 && active.every(k => attrs[k].incapacitated);
}

/**
 * Pre-v0.2.0 worlds stored Resistance per Attribute. It is now one physical
 * value covering Might and Finesse and one mental value covering Wit and
 * Presence (PHB §6.6.0). Carry the old numbers across by taking the higher of
 * each pair, which is how the printed Bestiary was converted: a creature listed
 * as "Might +4, Finesse +4" and one listed as "Might +2" both mean the armor
 * it was wearing, and the higher value is the one that was doing the work.
 */
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

// The fourth FOIL axis was Leniency (Unforgiving to Forgiving) before it became
// Levity (Grave to Light). The axes are not equivalent, so a stored value is
// carried across rather than converted; a GM re-answering it is the intent.
function migrateFoilLevity(source) {
  const foil = source?.foil;
  if (!foil || !("leniency" in foil)) return source;
  if (!("levity" in foil)) foil.levity = foil.leniency;
  delete foil.leniency;
  return source;
}

export class CharacterData extends foundry.abstract.TypeDataModel {
  static migrateData(source) { return super.migrateData(migrateFoilLevity(migrateResistance(source))); }

  static defineSchema() {
    return {
      ...coreSchema(),
      player: str(""),
      origin: str(""),
      background: str(""),
      coin: str(""),
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
    prepareFoil(this);
  }
}

export class CreatureData extends foundry.abstract.TypeDataModel {
  static migrateData(source) { return super.migrateData(migrateFoilLevity(migrateResistance(source))); }

  static defineSchema() {
    return {
      ...coreSchema(),
      tier: str("minor"),
      threat: str(""),
      // What it does when an Attribute is Incapacitated (GMG §4.1.0). Free
      // text so a conditional Trait can name its own bracket: "Territorial
      // [its lair], Craven". Blank means it simply fights on, the unstated default.
      behavior: str(""),
      notes: html("")
    };
  }

  prepareDerivedData() {
    prepareCore(this);
    prepareFoil(this);
  }
}
