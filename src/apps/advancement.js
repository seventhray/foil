/**
 * src/apps/advancement.js
 * Character advancement (PHB 2.3.0): spend XP to grow an Attribute's dice,
 * raise a Skill's Training, or learn a Technique or Feat from the compendium.
 * Stays open across purchases so a session's award can be spent in one sitting.
 *
 * Costs (PHB 2.3.0): a die one size 8/12/16/20 XP by its size, d12 to d20 100 XP
 * (a Transformation, noted, not enforced; its PHB 2.3.1 gift is added by hand), a Know-how 1d4 20 XP (limit:
 * 4 dice, plus 1 per die at d12 or larger), +1 Training 6 XP plus 2 per point held
 * (capped at the dice in the Skill's two pools, PHB 2.2.1), a Technique or Feat
 * its listed XP. A Feat's Requires is shown, and checked by the table.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_KEYS, SKILL_LABEL, XP_COST, knowHowState, trainingCost } from "../constants.js";
import { DIE_SIZES } from "../dice.js";

const dieStepCost = size => size >= 12 ? XP_COST.d12ToD20 : XP_COST.talent[size];


const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class FoilAdvancement extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
  }

  static DEFAULT_OPTIONS = {
    tag: "div",
    classes: ["foil", "chargen", "advancement"],
    window: { title: "Character Advancement", icon: "fas fa-arrow-trend-up", resizable: true },
    position: { width: 500, height: "auto" },
    actions: {
      advanceDie: FoilAdvancement._onAdvanceDie,
      addDie:     FoilAdvancement._onAddDie,
      train:      FoilAdvancement._onTrain,
      learnTechnique: FoilAdvancement._onLearnTechnique,
      learnFeat:      FoilAdvancement._onLearnFeat
    }
  };

  static PARTS = { main: { template: "systems/foil/templates/apps/advancement.hbs" } };

  get title() { return `Advancement: ${this.actor?.name ?? ""}`; }

  async _prepareContext() {
    const sys = this.actor.system;
    const attrs = sys.attributes ?? {};

    const attributeRows = ATTRIBUTE_KEYS.map(key => {
      const a = attrs[key] ?? {};
      const dice = a.dice ?? {};
      const steps = DIE_SIZES.slice(0, -1)
        .filter(size => Number(dice[`d${size}`] ?? 0) > 0)
        .map(size => {
          const next = DIE_SIZES[DIE_SIZES.indexOf(size) + 1];
          const note = size >= 12 ? " (a Transformation; add its gift, PHB 2.3.1)" : "";
          return { size, next, cost: dieStepCost(size), label: `d${size} to d${next}${note}` };
        });
      const kh = knowHowState(dice);
      return { key, label: ATTR_LABEL[key], diceFormula: a.diceFormula || "none", steps,
        newDieCost: XP_COST.knowHow, knowHowHeld: kh.held, knowHowLimit: kh.limit, knowHowAtLimit: kh.atLimit };
    });

    const skills = sys.skills ?? {};
    const skillRows = SKILL_KEYS.map(key => {
      const s = skills[key] ?? {};
      const total = Number(s.trainingTotal ?? s.training ?? 0);
      const cap = Number(s.trainingCap ?? 4);
      return { key, label: SKILL_LABEL[key], training: total, cap, capped: total >= cap, cost: trainingCost(total) };
    });

    const owned = new Set(this.actor.items.map(i => i.name.toLowerCase()));
    const techDocs = (await game.packs.get("foil.techniques")?.getDocuments()) ?? [];
    const techniques = techDocs
      .filter(t => !owned.has(t.name.toLowerCase()))
      .map(t => ({ id: t.id, name: t.name, xp: t.system.xpCost, requires: t.system.requiresLabel }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const featDocs = (await game.packs.get("foil.feats")?.getDocuments()) ?? [];
    const feats = featDocs
      .filter(f => f.system.featType !== "ancestry" && !owned.has(f.name.toLowerCase()))
      .map(f => ({ id: f.id, name: f.name, xp: f.system.xpCost, requirements: f.system.requirements }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      actorName: this.actor.name,
      xp: sys.xp ?? { total: 0, spent: 0, available: 0 },
      attributeRows, skillRows, techniques, feats
    };
  }

  /** Spend XP if enough is available, folding any other changes into the same update. */
  async _spend(cost, updateData = {}) {
    const available = Number(this.actor.system.xp?.available ?? 0);
    if (cost > available) {
      ui.notifications?.warn(`Not enough XP: needs ${cost}, has ${available} available.`);
      return false;
    }
    const spent = Number(this.actor.system.xp?.spent ?? 0) + cost;
    await this.actor.update({ "system.xp.spent": spent, ...updateData });
    return true;
  }

  static async _onAdvanceDie(event, target) {
    const key  = target.dataset.attr;
    const size = Number(target.dataset.size);
    const next = Number(target.dataset.next);
    const dice = this.actor.system.attributes?.[key]?.dice ?? {};
    const current = Number(dice[`d${size}`] ?? 0);
    if (!current) return;
    const ok = await this._spend(dieStepCost(size), {
      [`system.attributes.${key}.dice.d${size}`]: current - 1,
      [`system.attributes.${key}.dice.d${next}`]: Number(dice[`d${next}`] ?? 0) + 1
    });
    if (ok) this.render();
  }

  static async _onAddDie(event, target) {
    const key = target.dataset.attr;
    const dice = this.actor.system.attributes?.[key]?.dice ?? {};
    const kh = knowHowState(dice);
    if (kh.atLimit) {
      ui.notifications?.warn(`${ATTR_LABEL[key]} has ${kh.held} dice, its limit: 4, plus 1 per die at d12 or larger (PHB 2.3.0).`);
      return;
    }
    const ok = await this._spend(XP_COST.knowHow, {
      [`system.attributes.${key}.dice.d4`]: Number(dice.d4 ?? 0) + 1
    });
    if (ok) this.render();
  }

  static async _onTrain(event, target) {
    const key = target.dataset.skill;
    const s = this.actor.system.skills?.[key];
    const total = Number(s?.trainingTotal ?? 0);
    const cap = Number(s?.trainingCap ?? 4);
    if (total >= cap) {
      ui.notifications?.warn(`${SKILL_LABEL[key]} Training is capped at +${cap}: the dice in its two pools (PHB 2.2.1).`);
      return;
    }
    const ok = await this._spend(trainingCost(total), { [`system.skills.${key}.training`]: Number(s?.trainingBase ?? 0) + 1 });
    if (ok) this.render();
  }

  static async _learn(target, packName) {
    const id = target.closest(".adv-pick-row")?.querySelector("select")?.value;
    if (!id) return;
    const doc = await game.packs.get(packName)?.getDocument(id);
    if (!doc) return;
    const ok = await this._spend(Number(doc.system.xpCost ?? 0));
    if (!ok) return;
    await this.actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    this.render();
  }

  static async _onLearnTechnique(event, target) { return FoilAdvancement._learn.call(this, target, "foil.techniques"); }
  static async _onLearnFeat(event, target) { return FoilAdvancement._learn.call(this, target, "foil.feats"); }
}
