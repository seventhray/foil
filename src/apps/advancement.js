/**
 * src/apps/advancement.js
 * General-purpose character advancement (PHB §4.0.0 XP & Advancement): spend
 * XP to grow an Attribute's dice, raise an Aptitude's Training, or learn a
 * Technique or Feat from the compendium, any time after character creation
 * (the one-time starting-pool/Origin/Background wizard is src/apps/chargen.js).
 * Stays open across purchases — re-renders after each one — so a player can
 * spend a session's XP award in one sitting, watching XP available count down.
 *
 * Costs (PHB §4.0.0): advance an Attribute die one size 8 XP (d12→d20 is 36 XP
 * as a named exception); add a new 1d4 to an Attribute's pool 18 XP; +1
 * Aptitude Training 4 XP, capped at +4 in any one Aptitude; a Technique or
 * Feat costs its own listed XP.
 */

import { ATTRIBUTE_KEYS, APTITUDE_KEYS } from "../constants.js";
import { DIE_SIZES } from "../dice.js";

const ATTR_LABEL = { might: "Might", finesse: "Finesse", wit: "Wit", presence: "Presence" };
const APT_LABEL = {
  prowess: "Prowess", fortitude: "Fortitude", command: "Command",
  acuity: "Acuity", guile: "Guile", resonance: "Resonance"
};

const DIE_STEP_COST = size => size >= 12 ? 36 : 8;
const NEW_DIE_COST = 18;
const TRAINING_COST = 4;
const TRAINING_CAP  = 4;   // PHB §2.2.1: drilling sharpens a discipline only so far

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
    position: { width: 480, height: "auto" },
    actions: {
      advanceDie: FoilAdvancement._onAdvanceDie,
      addDie:     FoilAdvancement._onAddDie,
      train:      FoilAdvancement._onTrain,
      learnTechnique: FoilAdvancement._onLearnTechnique,
      learnFeat:      FoilAdvancement._onLearnFeat
    }
  };

  static PARTS = { main: { template: "systems/foil/templates/apps/advancement.hbs" } };

  /** @override */
  get title() { return `Advancement — ${this.actor?.name ?? ""}`; }

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
          return { size, next, cost: DIE_STEP_COST(size), label: `d${size} → d${next}` };
        });
      return { key, label: ATTR_LABEL[key], diceFormula: a.diceFormula || "—", steps, newDieCost: NEW_DIE_COST };
    });

    const apts = sys.aptitudes ?? {};
    const aptitudeRows = APTITUDE_KEYS.map(key => ({
      key, label: APT_LABEL[key],
      training: apts[key]?.trainingBase ?? apts[key]?.training ?? 0,
      cost: TRAINING_COST
    }));

    const owned = new Set(this.actor.items.map(i => i.name.toLowerCase()));

    const techPack = game.packs.get("foil.techniques");
    const techDocs = techPack ? await techPack.getDocuments() : [];
    const techniques = techDocs
      .filter(t => !owned.has(t.name.toLowerCase()))
      .map(t => ({
        id: t.id, name: t.name, xp: t.system.xpCost,
        gate: t.system.potentialGate?.value ?? 0
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const featPack = game.packs.get("foil.feats");
    const featDocs = featPack ? await featPack.getDocuments() : [];
    const feats = featDocs
      .filter(f => f.system.featKind === "learned" && !owned.has(f.name.toLowerCase()))
      .map(f => ({ id: f.id, name: f.name, xp: f.system.xpCost, requirements: f.system.requirements }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      actorName: this.actor.name,
      xp: sys.xp ?? { total: 0, spent: 0, available: 0 },
      attributeRows, aptitudeRows, techniques, feats
    };
  }

  /**
   * Spend XP against system.xp.spent if enough is available, merging any
   * additional update data into the same actor.update() call. Returns false
   * (and warns) without writing anything if the character can't afford it.
   */
  async _spend(cost, updateData = {}) {
    const sys = this.actor.system;
    const available = Number(sys.xp?.available ?? 0);
    if (cost > available) {
      ui.notifications?.warn(`Not enough XP: needs ${cost}, has ${available} available.`);
      return false;
    }
    const spent = Number(sys.xp?.spent ?? 0) + cost;
    await this.actor.update({ "system.xp.spent": spent, ...updateData });
    return true;
  }

  static async _onAdvanceDie(event, target) {
    const key  = target.dataset.attr;
    const size = Number(target.dataset.size);
    const next = Number(target.dataset.next);
    const cost = Number(target.dataset.cost);
    const dice = this.actor.system.attributes?.[key]?.dice ?? {};
    const current = Number(dice[`d${size}`] ?? 0);
    if (!current) return;
    const ok = await this._spend(cost, {
      [`system.attributes.${key}.dice.d${size}`]: current - 1,
      [`system.attributes.${key}.dice.d${next}`]: Number(dice[`d${next}`] ?? 0) + 1
    });
    if (ok) this.render();
  }

  static async _onAddDie(event, target) {
    const key = target.dataset.attr;
    const dice = this.actor.system.attributes?.[key]?.dice ?? {};
    const ok = await this._spend(NEW_DIE_COST, {
      [`system.attributes.${key}.dice.d4`]: Number(dice.d4 ?? 0) + 1
    });
    if (ok) this.render();
  }

  static async _onTrain(event, target) {
    const key = target.dataset.apt;
    const apt = this.actor.system.aptitudes?.[key];
    const current = Number(apt?.trainingBase ?? apt?.training ?? 0);
    if (current >= TRAINING_CAP) {
      ui.notifications?.warn(`Training in one Aptitude stops at +${TRAINING_CAP} (PHB §2.2.1).`);
      return;
    }
    const ok = await this._spend(TRAINING_COST, { [`system.aptitudes.${key}.training`]: current + 1 });
    if (ok) this.render();
  }

  static async _onLearnTechnique(event, target) {
    const select = target.closest(".adv-pick-row")?.querySelector("select");
    const id = select?.value;
    if (!id) return;
    const pack = game.packs.get("foil.techniques");
    const doc = await pack?.getDocument(id);
    if (!doc) return;
    const gate = Number(doc.system.potentialGate?.value ?? 0);
    if (gate) {
      const met = ATTRIBUTE_KEYS.some(k => (this.actor.system.attributes?.[k]?.potential?.max ?? 0) >= gate);
      if (!met) ui.notifications?.warn(`${doc.name} needs Potential ${gate} in one Attribute of the Aptitude it rolls — learning anyway.`);
    }
    const ok = await this._spend(Number(doc.system.xpCost ?? 0));
    if (!ok) return;
    await this.actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    this.render();
  }

  static async _onLearnFeat(event, target) {
    const select = target.closest(".adv-pick-row")?.querySelector("select");
    const id = select?.value;
    if (!id) return;
    const pack = game.packs.get("foil.feats");
    const doc = await pack?.getDocument(id);
    if (!doc) return;
    const ok = await this._spend(Number(doc.system.xpCost ?? 0));
    if (!ok) return;
    await this.actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    this.render();
  }
}
