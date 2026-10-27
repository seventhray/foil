/**
 * src/apps/chargen.js
 * Starting Character (PHB 2.5.0), all six steps in one window:
 *   1. Every Attribute starts at 2d4.
 *   2. Origin: Talent on one or two dice, two Feats (and any Technique a Feat teaches),
 *      then the Talent roll: each pool rolled three times, one die at a time; a die
 *      that rolls its highest advances one size, up to d12.
 *   3. Background: +1 Training in three Skills, 2d4 Know-how, coin, and a kit.
 *   4. Starting Point (PHB 2.3.2) sets Starting XP and Starting Coin;
 *      Fresh Start, or none, takes the Background's coin.
 *   5. Habits, picked or rolled from the Habit Tables (PHB 3.4.x).
 *   6. The character prompts.
 * Each choice shows what it grants, and a preview shows the finished dice,
 * Training, and Resistance before anything is written to the actor.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_KEYS, SKILL_LABEL, FOIL_AXES } from "../constants.js";
import { poolFromCounts } from "../dice.js";
import { consumableSummary, equipmentSummary } from "../registry.js";
import { HABIT_TABLES } from "../habits.js";
import { STARTING_TIERS, INNATE_INSTRUMENTS, NEXT_SIZE, TALENT_PASSES, TALENT_ROLLS, parseKit, findKitItem, talentDice, nextTalentRoll, startingPools } from "../../rules/chargen.js";
export { STARTING_TIERS, parseKit };
const DIE_KEYS = ["d4", "d6", "d8", "d10", "d12", "d20"];

const PROMPTS = [
  { key: "whoTheyAre", label: "Where from, and what pulled them into conflict?" },
  { key: "wants",      label: "What do they want most?" },
  { key: "fightFor",   label: "Who or what do they fight for?" },
  { key: "fears",      label: "What is one thing they fear or avoid?" }
];

/** Map a compendium pack's documents by lower-cased name. */
async function packDocsByName(packName) {
  const pack = game.packs.get(packName);
  const map = new Map();
  if (!pack) return map;
  for (const d of await pack.getDocuments()) map.set(d.name.toLowerCase(), d);
  return map;
}

/** Equipment and Consumables together, by lower-cased name: a kit names either. */
async function gearDocsByName() {
  return new Map([...await packDocsByName("foil.equipment"), ...await packDocsByName("foil.consumables")]);
}

/** Resolve kit names to compendium documents. */
export async function matchKitItems(kitNames) {
  const instruments = await packDocsByName("foil.instruments");
  const equipment = await gearDocsByName();
  const found = [], missing = [];
  for (const name of kitNames) {
    const doc = findKitItem(name, instruments, equipment);
    if (doc) found.push(doc.toObject());
    else missing.push(name);
  }
  return { found, missing };
}

/** Ensure Body, Voice, and Mind are on the actor, and drop the old Read Habit Technique. Idempotent. */
export async function grantStartingKit(actor) {
  const existing = new Set(actor.items.map(i => i.name.toLowerCase()));
  const map = await packDocsByName("foil.instruments");
  const toCreate = INNATE_INSTRUMENTS
    .filter(n => !existing.has(n.toLowerCase()) && map.has(n.toLowerCase()))
    .map(n => map.get(n.toLowerCase()).toObject());
  const stale = actor.items.filter(i => i.type === "technique" && i.name === "Read Habit").map(i => i.id);
  if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  return toCreate.length;
}

/** One line on what a kit item is. */
function kitLine(doc) {
  const s = doc.system;
  if (doc.type === "instrument") {
    const bits = [s.weightLabel, `${ATTR_LABEL[s.primaryAttribute]} Primary`, s.typesLabel, s.range].filter(Boolean);
    return bits.join(", ");
  }
  return doc.type === "consumable" ? consumableSummary(s) : equipmentSummary(s);
}

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class FoilChargen extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
    const sys = this.actor?.system ?? {};
    // Choices survive re-renders; FOIL and prompts start from what the sheet already has.
    this.choices = {
      ancestry: "", background: "", startingPoint: "",
      // The Talent rolls, kept so a re-render never rerolls; a new Origin clears them.
      talentRolls: [],
      foil: Object.fromEntries(FOIL_AXES.map(a => [a.key, {
        lean: sys.foil?.[a.key]?.lean === "neutral" ? "" : (sys.foil?.[a.key]?.lean ?? ""), habit: sys.foil?.[a.key]?.habit ?? ""
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
    actions: { rollTrait: FoilChargen._onRollTrait, rollTalent: FoilChargen._onRollTalent }
  };

  static PARTS = { main: { template: "systems/foil/templates/apps/chargen.hbs" } };

  get title() { return `Create: ${this.actor?.name ?? ""}`; }

  async _prepareContext() {
    const [ancestryPack, backgrounds, feats, techniques, instruments] = await Promise.all(
      ["foil.ancestries", "foil.backgrounds", "foil.feats", "foil.techniques", "foil.instruments"].map(packDocsByName));
    const equipment = await gearDocsByName();
    const st = this.choices;
    const ancestry = ancestryPack.get(st.ancestry.toLowerCase()) ?? null;
    const background = backgrounds.get(st.background.toLowerCase()) ?? null;
    const sortByName = m => [...m.values()].sort((a, b) => a.name.localeCompare(b.name));

    // What the Origin grants.
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

    // The Talent roll: each die as it stands, every roll so far, and the next one.
    const dice = talentDice(ancestry, st.talentRolls);
    const next = nextTalentRoll(st.talentRolls.length);
    const rollInfo = ancestry ? {
      attributes: ATTRIBUTE_KEYS.map(k => ({
        label: ATTR_LABEL[k],
        dice: dice[k].map((size, i) => ({ size, rolls: st.talentRolls.filter(r => r.attribute === k && r.index === i) }))
      })),
      next: next ? `Pass ${next.pass} of ${TALENT_PASSES}: ${ATTR_LABEL[next.attribute]} die ${next.index + 1} (d${dice[next.attribute][next.index]})` : "",
      done: !next,
      advances: st.talentRolls.filter(r => r.advanced).length
    } : null;

    // Preview: dice, Training, Resistance.
    const pools = startingPools(ancestry, background, st.talentRolls);
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
      ancestries: sortByName(ancestryPack).map(d => ({ name: d.name, selected: d.name === st.ancestry })),
      backgrounds: sortByName(backgrounds).map(d => ({ name: d.name, selected: d.name === st.background })),
      startingTiers: STARTING_TIERS.map(t => ({ ...t, selected: t.key === st.startingPoint })),
      ancestryInfo: ancestry ? {
        description: (ancestry.system.description ?? "").match(/^<p>.*?<\/p>/)?.[0] ?? "", talent: ancestry.system.talentSummary, feats: ancestryFeats
      } : null,
      talentRoll: rollInfo,
      backgroundInfo: background ? {
        description: background.system.description, training: background.system.grantsSummary,
        knowHow: background.system.knowHowSummary, coin: background.system.coin, kit
      } : null,
      preview: { attributes, skills, resistance, total },
      axes: FOIL_AXES.map(a => ({
        key: a.key, label: a.label, lean: st.foil[a.key].lean, habit: st.foil[a.key].habit,
        leanOptions: [["", "Neutral"], ["low", a.low], ["high", a.high]]
          .map(([value, label]) => ({ value, label, selected: value === st.foil[a.key].lean })),
        table: (HABIT_TABLES[a.key] ?? []).map(r => ({
          value: r.habit, label: `${r.roll}. ${r.habit}`, selected: r.habit === st.foil[a.key].habit
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
      if ((data.ancestry ?? "") !== this.choices.ancestry) this.choices.talentRolls = [];
      Object.assign(this.choices, {
        ancestry: data.ancestry ?? "", background: data.background ?? "",
        startingPoint: data.startingPoint ?? ""
      });
      for (const a of FOIL_AXES) this.choices.foil[a.key] = { lean: data.foil?.[a.key]?.lean ?? "", habit: data.foil?.[a.key]?.habit ?? "" };
      for (const p of PROMPTS) this.choices.prompts[p.key] = data.prompts?.[p.key] ?? "";
      // Picking from a Habit Table fills the Habit and its lean.
      if (picked) {
        const row = (HABIT_TABLES[picked[1]] ?? []).find(r => r.habit === event.target.value);
        if (row) this.choices.foil[picked[1]] = { lean: row.lean === "neutral" ? "" : row.lean, habit: row.habit };
      }
      if (["ancestry", "background", "startingPoint"].includes(event.target.name) || picked) this.render();
    });
  }

  /** Roll 1d8 on an axis's Habit Table (PHB 3.4.0). */
  static async _onRollTrait(event, target) {
    const axis = target.dataset.axis;
    const roll = await new Roll("1d8").evaluate();
    const row = (HABIT_TABLES[axis] ?? []).find(r => r.roll === roll.total);
    if (row) this.choices.foil[axis] = { lean: row.lean === "neutral" ? "" : row.lean, habit: row.habit };
    this.render();
  }

  /** Roll the next die of the Talent roll (PHB 2.5.1). Its highest number advances it one size, up to d12. */
  static async _onRollTalent(event, target) {
    const rolls = this.choices.talentRolls;
    const next = nextTalentRoll(rolls.length);
    if (!next) return;
    const ancestry = (await packDocsByName("foil.ancestries")).get(this.choices.ancestry.toLowerCase());
    if (!ancestry) return;
    const size = talentDice(ancestry, rolls)[next.attribute][next.index];
    const roll = await new Roll(`1d${size}`).evaluate();
    await game.dice3d?.showForRoll(roll, game.user, true);
    const advanced = roll.total === size && size in NEXT_SIZE;
    rolls.push({ ...next, size, result: roll.total, advanced, to: advanced ? NEXT_SIZE[size] : size });
    this.render();
  }

  static async _onSubmit(event, form, formData) {
    const actor = this.actor;
    if (!actor) return;
    const data = foundry.utils.expandObject(formData.object);
    // Throwing keeps the window open with the message (closeOnSubmit only runs on success).
    if (!data.ancestry || !data.background) throw new Error("Pick an Origin and a Background.");

    const ancestry = (await packDocsByName("foil.ancestries")).get(data.ancestry.toLowerCase());
    const background = (await packDocsByName("foil.backgrounds")).get(data.background.toLowerCase());
    if (!ancestry || !background) throw new Error("That Origin or Background isn't in the compendium.");

    if (this.choices.talentRolls.length < TALENT_ROLLS) throw new Error("Finish the Talent roll first.");
    const pools = startingPools(ancestry, background, this.choices.talentRolls);
    const update = {};
    for (const k of ATTRIBUTE_KEYS) {
      for (const d of DIE_KEYS) update[`system.attributes.${k}.dice.${d}`] = pools[k][d] ?? 0;
      update[`system.attributes.${k}.incapacitated`] = false;
    }
    update["system.ancestry"] = ancestry.name;
    update["system.background"] = background.name;
    const tier = STARTING_TIERS.find(t => t.key === data.startingPoint);
    update["system.coin"] = tier?.coin ?? background.system.coin ?? "";
    if (tier) update["system.xp.total"] = tier.xp;
    for (const a of FOIL_AXES) {
      update[`system.foil.${a.key}.lean`] = data.foil?.[a.key]?.lean ?? "";
      update[`system.foil.${a.key}.habit`] = data.foil?.[a.key]?.habit ?? "";
    }
    for (const p of PROMPTS) update[`system.prompts.${p.key}`] = data.prompts?.[p.key] ?? "";
    await actor.update(update);
    const fill = {};
    for (const k of ATTRIBUTE_KEYS) fill[`system.attributes.${k}.potential.current`] = actor.system.attributes[k].potential.max;
    await actor.update(fill);

    // Replace any earlier Origin or Background, then add the new ones and what they grant.
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
