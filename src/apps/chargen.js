/**
 * src/apps/chargen.js
 * Starting Character (PHB 2.5.0), all six steps in one window:
 *   1. Every Attribute starts at 2d4.
 *   2. Ancestry: Talent on two dice, two Feats (and any Technique a Feat teaches).
 *   3. Background: +1 Training in three Skills, 2d4 Know-how, coin, and a kit.
 *   4. Starting Point (GMG 2.1.0) sets Starting XP and suggests Starting Coin;
 *      a blank coin field takes the Background's.
 *   5. Habits, picked or rolled from the Habit Tables (PHB 3.4.x).
 *   6. The character prompts.
 * Each choice shows what it grants, and a preview shows the finished dice,
 * Training, and Resistance before anything is written to the actor.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_KEYS, SKILL_LABEL, FOIL_AXES } from "../constants.js";
import { poolFromCounts } from "../dice.js";
import { equipmentSummary } from "../registry.js";
import { CONVICTIONS } from "../convictions.js";

// Starting Points (GMG 2.1.0): picked for the whole party, sets Starting XP and suggests Starting Coin.
export const STARTING_TIERS = [
  { key: "fresh",     label: "Fresh Start (0 XP)",   xp: 0 },
  { key: "blooded",   label: "Blooded (175 XP, 175p to 350p)",     xp: 175 },
  { key: "hardened",  label: "Hardened (400 XP, 400p to 800p)",    xp: 400 },
  { key: "storied",   label: "Storied (825 XP, 825p to 1650p)",     xp: 825 },
  { key: "legendary", label: "Legendary (1600+ XP, 1600p to 3200p)", xp: 1600 }
];

const PROMPTS = [
  { key: "whoTheyAre", label: "Where from, and what pulled them into conflict?" },
  { key: "wants",      label: "What do they want most?" },
  { key: "fightFor",   label: "Who or what do they fight for?" },
  { key: "fears",      label: "What is one thing they fear or avoid?" }
];

const INNATE_INSTRUMENTS = ["Body", "Voice"];
const DIE_KEYS = ["d4", "d6", "d8", "d10", "d12", "d20"];

/** Split a Background kit string ("Longsword, Leather armor, Traveler Pack.") into item names. */
export function parseKit(kit) {
  return String(kit ?? "").replace(/\.\s*$/, "").split(",").map(s => s.trim()).filter(Boolean);
}

/** Map a compendium pack's documents by lower-cased name. */
async function packDocsByName(packName) {
  const pack = game.packs.get(packName);
  const map = new Map();
  if (!pack) return map;
  for (const d of await pack.getDocuments()) map.set(d.name.toLowerCase(), d);
  return map;
}

/** Find a kit item by name in the Instruments or Equipment maps ("Leather armor" is Leather). */
function findKitItem(name, instruments, equipment) {
  const key = name.toLowerCase().replace(/^50ft of rope$/, "rope (50ft)");
  const bare = key.replace(/\s+(armor|armour)$/, "").trim();
  return instruments.get(key) || equipment.get(key) || instruments.get(bare) || equipment.get(bare) || null;
}

/** Resolve kit names to compendium documents. */
export async function matchKitItems(kitNames) {
  const instruments = await packDocsByName("foil.instruments");
  const equipment = await packDocsByName("foil.equipment");
  const found = [], missing = [];
  for (const name of kitNames) {
    const doc = findKitItem(name, instruments, equipment);
    if (doc) found.push(doc.toObject());
    else missing.push(name);
  }
  return { found, missing };
}

/** Ensure Body and Voice are on the actor. Idempotent. */
export async function grantStartingKit(actor) {
  const existing = new Set(actor.items.map(i => i.name.toLowerCase()));
  const map = await packDocsByName("foil.instruments");
  const toCreate = INNATE_INSTRUMENTS
    .filter(n => !existing.has(n.toLowerCase()) && map.has(n.toLowerCase()))
    .map(n => map.get(n.toLowerCase()).toObject());
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  return toCreate.length;
}

/** The starting pools from an Ancestry and a Background (PHB 2.5.0 steps 1-3). */
function startingPools(ancestry, background) {
  const pools = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, { d4: 2 }]));
  for (const t of ancestry?.system.talent ?? []) {
    const p = pools[t.attribute];
    if (!p?.d4) continue;
    p.d4 -= 1;
    p[`d${t.die}`] = (p[`d${t.die}`] ?? 0) + 1;
  }
  for (const a of background?.system.knowHow ?? []) if (pools[a]) pools[a].d4 += 1;
  return pools;
}

/** One line on what a kit item is. */
function kitLine(doc) {
  const s = doc.system;
  if (doc.type === "instrument") {
    const bits = [s.weightLabel, `${ATTR_LABEL[s.primaryAttribute]} Primary`, s.typesLabel, s.range].filter(Boolean);
    return bits.join(", ");
  }
  return equipmentSummary(s);
}

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class FoilChargen extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    const sys = this.actor?.system ?? {};
    // Choices survive re-renders; FOIL and prompts start from what the sheet already has.
    this.choices = {
      ancestry: "", background: "", startingPoint: "", coin: "",
      foil: Object.fromEntries(FOIL_AXES.map(a => [a.key, {
        lean: sys.foil?.[a.key]?.lean ?? "", trait: sys.foil?.[a.key]?.trait ?? ""
      }])),
      prompts: Object.fromEntries(PROMPTS.map(p => [p.key, sys.prompts?.[p.key] ?? ""]))
    };
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["foil", "chargen"],
    window: { title: "Create a Starting Character", icon: "fas fa-wand-magic-sparkles", resizable: true },
    position: { width: 760, height: "auto" },
    form: { handler: FoilChargen._onSubmit, closeOnSubmit: true },
    actions: { rollTrait: FoilChargen._onRollTrait }
  };

  static PARTS = { main: { template: "systems/foil/templates/apps/chargen.hbs" } };

  get title() { return `Create: ${this.actor?.name ?? ""}`; }

  async _prepareContext() {
    const [origins, backgrounds, feats, techniques, instruments, equipment] = await Promise.all(
      ["foil.origins", "foil.backgrounds", "foil.feats", "foil.techniques", "foil.instruments", "foil.equipment"].map(packDocsByName));
    const st = this.choices;
    const ancestry = origins.get(st.ancestry.toLowerCase()) ?? null;
    const background = backgrounds.get(st.background.toLowerCase()) ?? null;
    const sortByName = m => [...m.values()].sort((a, b) => a.name.localeCompare(b.name));

    // What the Ancestry grants.
    const ancestryFeats = (ancestry?.system.feats ?? []).map(n => {
      const f = feats.get(n.toLowerCase());
      const tech = f?.system.grantsTechnique ? techniques.get(f.system.grantsTechnique.toLowerCase()) : null;
      return {
        name: n, effect: f?.system.effect ?? "(not in the compendium)",
        technique: tech ? `${tech.name}: ${tech.system.xpCost} XP value, ${tech.system.requiresLabel}` : ""
      };
    });

    // What the Background grants.
    const kit = parseKit(background?.system.equipmentKit).map(n => {
      const d = findKitItem(n, instruments, equipment);
      return { name: n, line: d ? kitLine(d) : "(not in the compendium)" };
    });

    // Preview: dice, Training, Resistance.
    const pools = startingPools(ancestry, background);
    const attributes = ATTRIBUTE_KEYS.map(k => {
      const pool = poolFromCounts(pools[k]);
      return { key: k, label: ATTR_LABEL[k], formula: pool.formula, potential: pool.max };
    });
    const training = Object.fromEntries(SKILL_KEYS.map(k => [k, Number(background?.system.training?.[k] ?? 0)]));
    const resistance = { physical: 0, mental: 0 };
    for (const f of ancestryFeats) {
      const doc = feats.get(f.name.toLowerCase());
      for (const m of doc?.system.modifiers ?? []) {
        if (m.type === "training" && m.key in training) training[m.key] += Number(m.value);
        if (m.type === "resistance" && m.key in resistance) resistance[m.key] += Number(m.value);
      }
    }
    for (const n of parseKit(background?.system.equipmentKit)) {
      const d = findKitItem(n, instruments, equipment);
      if (d?.type !== "equipment") continue;
      for (const q of d.system.qualities ?? []) if (q.key === "resistance" && q.param in resistance) resistance[q.param] += Number(q.value);
    }
    const skills = SKILL_KEYS.map(k => ({ label: SKILL_LABEL[k], training: training[k] }));
    const total = attributes.reduce((n, a) => n + a.potential, 0);

    return {
      actorName: this.actor?.name ?? "",
      state: st,
      ancestries: sortByName(origins).map(d => ({ name: d.name, selected: d.name === st.ancestry })),
      backgrounds: sortByName(backgrounds).map(d => ({ name: d.name, selected: d.name === st.background })),
      startingTiers: STARTING_TIERS.map(t => ({ ...t, selected: t.key === st.startingPoint })),
      ancestryInfo: ancestry ? {
        description: ancestry.system.description, talent: ancestry.system.talentSummary, feats: ancestryFeats
      } : null,
      backgroundInfo: background ? {
        description: background.system.description, training: background.system.grantsSummary,
        knowHow: background.system.knowHowSummary, coin: background.system.coin, kit
      } : null,
      preview: { attributes, skills, resistance, total },
      axes: FOIL_AXES.map(a => ({
        key: a.key, label: a.label, lean: st.foil[a.key].lean, trait: st.foil[a.key].trait,
        leanOptions: [["", "Undeclared"], ["low", a.low], ["neutral", "Neutral"], ["high", a.high]]
          .map(([value, label]) => ({ value, label, selected: value === st.foil[a.key].lean })),
        table: (CONVICTIONS[a.key] ?? []).map(r => ({
          value: r.trait, label: `${r.roll}. ${r.trait}`, selected: r.trait === st.foil[a.key].trait
        }))
      })),
      prompts: PROMPTS.map(p => ({ ...p, value: st.prompts[p.key] }))
    };
  }

  /**
   * Keep choices in state and re-render so the details and preview follow them.
   * The form element persists across re-renders, so the listener is bound once.
   */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", event => {
      const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
      const picked = event.target.name?.match(/^pick\.(\w+)$/);
      Object.assign(this.choices, {
        ancestry: data.ancestry ?? "", background: data.background ?? "",
        startingPoint: data.startingPoint ?? "", coin: data.coin ?? ""
      });
      for (const a of FOIL_AXES) this.choices.foil[a.key] = { lean: data.foil?.[a.key]?.lean ?? "", trait: data.foil?.[a.key]?.trait ?? "" };
      for (const p of PROMPTS) this.choices.prompts[p.key] = data.prompts?.[p.key] ?? "";
      // Picking from a Habit Table fills the Habit and its lean.
      if (picked) {
        const row = (CONVICTIONS[picked[1]] ?? []).find(r => r.trait === event.target.value);
        if (row) this.choices.foil[picked[1]] = { lean: row.lean, trait: row.trait };
      }
      if (["ancestry", "background", "startingPoint"].includes(event.target.name) || picked) this.render();
    });
  }

  /** Roll 1d10 on an axis's Habit Table (PHB 3.4.0). */
  static async _onRollTrait(event, target) {
    const axis = target.dataset.axis;
    const roll = await new Roll("1d10").evaluate();
    const row = (CONVICTIONS[axis] ?? []).find(r => r.roll === roll.total);
    if (row) this.choices.foil[axis] = { lean: row.lean, trait: row.trait };
    this.render();
  }

  static async _onSubmit(event, form, formData) {
    const actor = this.actor;
    if (!actor) return;
    const data = foundry.utils.expandObject(formData.object);
    // Throwing keeps the window open with the message (closeOnSubmit only runs on success).
    if (!data.ancestry || !data.background) throw new Error("Pick an Ancestry and a Background.");

    const ancestry = (await packDocsByName("foil.origins")).get(data.ancestry.toLowerCase());
    const background = (await packDocsByName("foil.backgrounds")).get(data.background.toLowerCase());
    if (!ancestry || !background) throw new Error("That Ancestry or Background isn't in the compendium.");

    const pools = startingPools(ancestry, background);
    const update = {};
    for (const k of ATTRIBUTE_KEYS) {
      for (const d of DIE_KEYS) update[`system.attributes.${k}.dice.${d}`] = pools[k][d] ?? 0;
      update[`system.attributes.${k}.incapacitated`] = false;
    }
    update["system.ancestry"] = ancestry.name;
    update["system.background"] = background.name;
    update["system.coin"] = data.coin ? String(data.coin) : (background.system.coin ?? "");
    const tier = STARTING_TIERS.find(t => t.key === data.startingPoint);
    if (tier) update["system.xp.total"] = tier.xp;
    for (const a of FOIL_AXES) {
      update[`system.foil.${a.key}.lean`] = data.foil?.[a.key]?.lean ?? "";
      update[`system.foil.${a.key}.trait`] = data.foil?.[a.key]?.trait ?? "";
    }
    for (const p of PROMPTS) update[`system.prompts.${p.key}`] = data.prompts?.[p.key] ?? "";
    await actor.update(update);
    const fill = {};
    for (const k of ATTRIBUTE_KEYS) fill[`system.attributes.${k}.potential.current`] = actor.system.attributes[k].potential.max;
    await actor.update(fill);

    // Replace any earlier Ancestry or Background, then add the new ones and what they grant.
    const stale = actor.items.filter(i => ["origin", "background"].includes(i.type)).map(i => i.id);
    if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
    const existing = new Set(actor.items.map(i => i.name.toLowerCase()));
    const toCreate = [];
    const notes = [];
    const add = doc => {
      if (existing.has(doc.name.toLowerCase())) return;
      existing.add(doc.name.toLowerCase());
      toCreate.push(doc);
    };

    add(ancestry.toObject());
    const feats = await packDocsByName("foil.feats");
    const techniques = await packDocsByName("foil.techniques");
    for (const featName of ancestry.system.feats ?? []) {
      const feat = feats.get(featName.toLowerCase());
      if (!feat) { notes.push(`Feat "${featName}" not found`); continue; }
      add(feat.toObject());
      const grant = feat.system.grantsTechnique;
      if (grant) {
        const tech = techniques.get(grant.toLowerCase());
        if (tech) add(tech.toObject());
        else notes.push(`Technique "${grant}" not found`);
      }
    }

    add(background.toObject());
    const { found, missing } = await matchKitItems(parseKit(background.system.equipmentKit));
    for (const doc of found) {
      // Worn kit starts equipped so its Resistance or Skill bonus applies at once.
      if (["armor", "shield", "ward", "charm"].includes(doc.system?.category)) doc.system.location = "equipped";
      add(doc);
    }
    if (missing.length) notes.push(`Kit not found: ${missing.join(", ")}`);

    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
    const innate = await grantStartingKit(actor);

    ui.notifications?.info(`${actor.name} built: ${toCreate.length + innate} items added.`);
    if (notes.length) ui.notifications?.warn(notes.join(" · "));
  }
}
