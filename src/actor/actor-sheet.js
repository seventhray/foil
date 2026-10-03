/**
 * src/actor/actor-sheet.js
 * FoilCharacterSheet / FoilCreatureSheet (Foilbound 0.6.0). A faithful sheet
 * and dice roller. Three automations, each by explicit request:
 *   - Strain lands on the Instrument's Primary Attribute when a Technique is
 *     rolled (PHB 4.2.3).
 *   - A landed Technique's chat card computes its Stress once the target's
 *     Oppose total is entered (PHB 6.7.0). Applying it to the target stays manual.
 *   - Foil Token spends: halve one source's Stress, or reroll one die of a posted
 *     roll (PHB 3.2.0).
 * Everything else (opposed rolls, Conditions, Habits) stays with the table.
 */

import {
  ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_ATTRS, SKILL_KEYS, SKILL_LABEL, SKILL_ABBR, FOIL_AXES,
  FOIL_TOKEN_MAX, CONDITIONS, EQUIPMENT_CATEGORY_LABEL, ITEM_LOCATIONS, LOCATION_LABEL,
  REST_BLOCK_HOURS, REST_RATION_HOURS, MARGIN_CAP, marginCap, CONDITION_OPPOSE
} from "../constants.js";
import { equipmentSummary } from "../registry.js";
import { stressFor } from "../stress.js";

const LOCATION_ICON = { equipped: "fa-hand", carried: "fa-suitcase", stored: "fa-box-archive" };
const locationView = loc => ({ key: loc, icon: LOCATION_ICON[loc] ?? "fa-suitcase", label: LOCATION_LABEL[loc] ?? loc });

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2Base = foundry.applications.sheets.ActorSheetV2;

const dialogApi = () => foundry.applications?.api?.DialogV2;
const formData = form => new (foundry.applications?.ux?.FormDataExtended ?? FormDataExtended)(form).object;

/** Ask a question with a small form; resolves to the form's values, or null. */
async function ask(title, content, label = "OK") {
  const D = dialogApi();
  if (!D) return null;
  return D.prompt({
    window: { title }, content,
    ok: { label, callback: (event, button) => formData(button.form) },
    rejectClose: false
  }).catch(() => null);
}

/** "Deals Stress to Might or Finesse, +1." -> 1 (a built-in Technique's bespoke bonus). */
function bespokeBonus(effect) {
  const m = String(effect ?? "").match(/Deals Stress[^.]*?,\s*\+(\d+)/i);
  return m ? Number(m[1]) : 0;
}

class FoilActorSheet extends HandlebarsApplicationMixin(ActorSheetV2Base) {

  static DEFAULT_OPTIONS = {
    classes: ["foil", "sheet", "actor"],
    window: { resizable: true },
    position: { width: 880, height: 720 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollSkill:        FoilActorSheet._onRollSkill,
      rollKit:          FoilActorSheet._onRollKit,
      rollTechnique:    FoilActorSheet._onRollTechnique,
      rollEnchantment:  FoilActorSheet._onRollEnchantment,
      earnToken:        FoilActorSheet._onEarnToken,
      absorbStress:     FoilActorSheet._onAbsorbStress,
      addCondition:     FoilActorSheet._onAddCondition,
      removeCondition:  FoilActorSheet._onRemoveCondition,
      cycleLocation:    FoilActorSheet._onCycleLocation,
      toggleEquipped:   FoilActorSheet._onToggleEquipped,
      rest:             FoilActorSheet._onRest,
      generateCharacter: FoilActorSheet._onGenerateCharacter,
      openAdvancement:  FoilActorSheet._onOpenAdvancement,
      createItem:       FoilActorSheet._onCreateItem,
      editItem:         FoilActorSheet._onEditItem,
      deleteItem:       FoilActorSheet._onDeleteItem
    }
  };

  // ─── Context ────────────────────────────────────────────────────────────────

  _attributeRows() {
    const attrs = this.actor.system.attributes ?? {};
    return ATTRIBUTE_KEYS.map(key => {
      const a = attrs[key] ?? {};
      return {
        key, label: ATTR_LABEL[key], dice: a.dice ?? {}, diceFormula: a.diceFormula ?? "",
        potentialMax: a.potential?.max ?? 0,
        // Stored as current Potential; the sheet shows and edits the Stress taken.
        stress: Math.max(0, (a.potential?.max ?? 0) - (a.potential?.current ?? 0)),
        recoverStress: Math.floor((a.potential?.max ?? 0) / 2),
        kind: a.kind ?? "", incapacitated: !!a.down,
        resistanceExtra: a.resistanceExtra ?? 0, resistanceTotal: a.resistanceTotal ?? 0,
        resistanceFromLabel: a.resistanceFromLabel ?? "",
        validPool: a.validPool !== false
      };
    });
  }

  _skillRows() {
    const skills = this.actor.system.skills ?? {};
    return SKILL_KEYS.map(key => {
      const s = skills[key] ?? {};
      const pair = SKILL_ATTRS[key];
      const avg = s.rollAvg ?? 0;
      return {
        key, label: SKILL_LABEL[key], abbr: SKILL_ABBR[key],
        pairLabel: `${ATTR_LABEL[pair[0]]} + ${ATTR_LABEL[pair[1]]}`,
        training: s.trainingBase ?? 0, trainingBonus: s.trainingBonus ?? 0, skillBonus: s.skillBonus ?? 0,
        trainingCap: s.trainingCap ?? 0, overCap: !!s.overCap,
        rollMin: s.rollMin ?? 0, rollAvg: Number.isInteger(avg) ? avg : avg.toFixed(1), rollMax: s.rollMax ?? 0,
        passive: s.passive ?? 0, usable: s.usable !== false
      };
    });
  }

  _foilRows() {
    const foil = this.actor.system.foil ?? {};
    return FOIL_AXES.map(axis => {
      const v = foil[axis.key] ?? {};
      return {
        ...axis, lean: v.lean ?? "", habit: v.habit ?? "",
        leanOptions: [
          { value: "", label: "Undeclared" }, { value: "low", label: axis.low },
          { value: "neutral", label: "Neutral" }, { value: "high", label: axis.high }
        ].map(o => ({ ...o, selected: o.value === (v.lean ?? "") }))
      };
    });
  }

  _conditionRows() {
    return (this.actor.system.conditions ?? []).map((c, idx) => ({ idx, ...c }));
  }

  _itemGroups() {
    const groups = { origin: [], background: [], instrument: [], technique: [], feat: [], equipment: [], builtin: [] };
    for (const item of this.actor.items) {
      if (!(item.type in groups)) continue;
      const s = item.system;
      const view = { id: item.id, name: item.name, img: item.img, system: s };
      if (item.type === "instrument") {
        view.primaryLabel = ATTR_LABEL[s.primaryAttribute] ?? "";
        view.kit = (s.kit ?? []).map((k, idx) => ({ idx, name: k.name, skillLabel: SKILL_LABEL[k.skill] ?? k.skill, effect: k.effect }));
        if (!s.innate) view.place = locationView(s.location);
        view.stowable = !s.innate && s.location !== "equipped";
        // An Instrument's built-in Techniques join the Techniques tab, with their source (PHB 7.2.0).
        for (const k of view.kit) groups.builtin.push({ ...k, id: item.id, source: item.name, ready: s.innate || s.location === "equipped" });
      } else if (item.type === "technique") {
        view.effectDisplay = s.effectSummary;
        const valid = this._validInstruments(item);
        view.usableWith = s.innate ? "Innate (no Instrument)"
          : valid.length ? valid.map(i => i.system.location === "equipped" || i.system.innate ? i.name : `${i.name} (${LOCATION_LABEL[i.system.location].toLowerCase()})`).join(", ")
          : "no Instrument it has";
        view.unusable = !s.innate && !valid.length;
      } else if (item.type === "equipment") {
        view.categoryLabel = EQUIPMENT_CATEGORY_LABEL[s.category] ?? "";
        view.effectSummary = equipmentSummary(s);
        view.place = locationView(s.location);
        view.stowable = s.location !== "equipped";
      }
      groups[item.type].push(view);
    }
    // A Heavy Instrument takes both hands: nothing else in hand while it's ready (PHB 4.1.1).
    const inHand = [...this.actor.items].filter(i => (i.type === "instrument" && !i.system.innate && i.system.location === "equipped")
      || (i.type === "equipment" && i.system.category === "shield" && i.system.location === "equipped"));
    for (const v of groups.instrument) {
      if (v.system.twoHanded && v.system.location === "equipped" && inHand.length > 1) {
        v.handsWarning = "Heavy: takes both hands, but another Instrument or a shield is also equipped (PHB 4.1.1).";
      }
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.name.localeCompare(b.name));
    groups.builtin.sort((a, b) => (b.ready - a.ready) || a.source.localeCompare(b.source) || a.idx - b.idx);
    return groups;
  }

  _commonContext() {
    const sys = this.actor.system;
    return {
      actor: this.actor,
      system: sys,
      attributes: this._attributeRows(),
      skills: this._skillRows(),
      foil: this._foilRows(),
      conditions: this._conditionRows(),
      conditionNames: CONDITIONS,
      resistance: sys.resistance ?? {},
      tokens: { value: sys.foilTokens ?? 0, max: FOIL_TOKEN_MAX },
      items: this._itemGroups()
    };
  }

  // ─── Rolling ────────────────────────────────────────────────────────────────

  /** A Skill formula with the carrying penalty folded in (PHB 5.2.6), plus any weight dice (PHB 4.1.1). */
  _skillFormula(skill, extra = 0, dice = "") {
    const sys = this.actor.system;
    const parts = [sys.skills?.[skill]?.formula || "0"];
    if (dice) parts.push(dice);
    const flat = Number(extra || 0) - Number(sys.carry?.penalty ?? 0);
    if (flat) parts.push(String(flat));
    return parts.join(" + ").replace("+ -", "- ");
  }

  _rollNotes(skill) {
    const sys = this.actor.system;
    const notes = [];
    const dropped = SKILL_ATTRS[skill].filter(ak => sys.attributes?.[ak]?.down).map(ak => ATTR_LABEL[ak]);
    if (dropped.length) notes.push(`${dropped.join(" and ")} Incapacitated: no dice from it.`);
    if (sys.carry?.penalty) notes.push(`Mass ${sys.carry.weight} lbs: -${sys.carry.penalty}.`);
    return notes;
  }

  static async _onRollSkill(event, target) {
    const key = target.dataset.key;
    await this._postRoll(this._skillFormula(key), `${SKILL_LABEL[key]}`, this._rollNotes(key).join(" "));
  }

  /** Roll one of an Instrument's three built-in Techniques (PHB 7.2.0). */
  static async _onRollKit(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const inst = this.actor.items.get(id);
    const kit = inst?.system.kit?.[Number(target.dataset.index)];
    if (!inst || !kit) return;
    const notes = this._rollNotes(kit.skill);
    notes.unshift(`${inst.name}: ${kit.effect}`);
    if (!inst.system.innate && inst.system.location !== "equipped") notes.push(`${inst.name} isn't equipped: switching to it costs the Quick Action (PHB 4.1.0).`);
    if (inst.system.quick) notes.push("Light: after an Action through a Light Instrument, the Quick Action can pay for this (PHB 4.2.2).");
    if (inst.system.doublesMargin) notes.push("Heavy: costs the Action and the Quick Action; the margin doubles (PHB 4.1.1).");
    if (inst.system.reload) notes.push(`Reload: ${inst.system.reload === "quick" ? "Quick Action" : "Action"}.`);
    const stress = /Deals Stress/i.test(kit.effect);
    const applied = !stress && kit.effect.match(/^Applies (\w+)/i)?.[1];
    if (applied && CONDITION_OPPOSE[applied]) notes.push(`The target resists with ${CONDITION_OPPOSE[applied].map(k => SKILL_LABEL[k]).join(" or ")} (PHB 6.5.0).`);
    const targeted = stress || /^Applies\b/i.test(kit.effect);
    if (targeted && inst.system.weightDice) notes.push(`${inst.system.weightLabel}: +${inst.system.weightDice}.`);
    await this._postRoll(this._skillFormula(kit.skill, inst.system.bonusRoll, targeted ? inst.system.weightDice : ""), `${kit.name} (${SKILL_LABEL[kit.skill]})`,
      notes.join("<br>"), stress ? roll => this._stressFlag(inst, kit.name, roll.total, {
        bespoke: bespokeBonus(kit.effect), pierce: inst.system.bonusPierce
      }) : null);
  }

  /** Instruments able to deliver a Technique: any one of its required Types; equipped ones first, stored ones never. */
  _validInstruments(tech) {
    const req = tech.system.requires ?? [];
    const ready = i => (i.system.innate || i.system.location === "equipped") ? 0 : 1;
    return this.actor.items.filter(i => {
      if (i.system.location === "stored") return false;
      if (i.type === "instrument") return req.length === 0 || req.some(k => i.system.types?.includes(k));
      if (i.type === "equipment" && i.system.category === "shield") return req.includes("blocking");
      return false;
    }).sort((a, b) => ready(a) - ready(b));
  }

  static async _onRollTechnique(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const tech = this.actor.items.get(id);
    if (!tech) return;
    const sys = tech.system;

    let inst = null, skill = sys.skill || "";
    if (!sys.innate) {
      const valid = this._validInstruments(tech);
      if (!valid.length) {
        ui.notifications?.warn(`No Instrument carries what ${tech.name} requires (${sys.requiresLabel}).`);
        return;
      }
      inst = valid[0];
      const skillsOf = i => i.type === "instrument" ? i.system.primarySkills : ["prowess", "discipline", "assertiveness"];
      const needPick = valid.length > 1 || !skill;
      if (needPick) {
        let content = `<p><strong>${tech.name}</strong></p>`;
        content += valid.length > 1
          ? `<div class="form-group"><label>Instrument</label><select name="instrumentId">${valid.map(i =>
              `<option value="${i.id}">${i.name}${i.system.primaryAttribute ? ` (${ATTR_LABEL[i.system.primaryAttribute]})` : ""}</option>`).join("")}</select></div>`
          : `<input type="hidden" name="instrumentId" value="${inst.id}" />`;
        if (!skill) {
          const opts = SKILL_KEYS.map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
          content += `<div class="form-group"><label>Skill <em>(one the Instrument's Primary Attribute allows)</em></label><select name="skill">${opts}</select></div>`;
        }
        const answer = await ask(`Use ${tech.name}`, content, "Roll");
        if (!answer) return;
        inst = this.actor.items.get(answer.instrumentId) ?? inst;
        skill = skill || answer.skill;
        const allowed = skillsOf(inst);
        if (!allowed.includes(skill)) {
          ui.notifications?.warn(`${inst.name} rolls ${allowed.map(k => SKILL_LABEL[k]).join(", ")}, not ${SKILL_LABEL[skill]} (PHB 4.1.0).`);
          return;
        }
      }
    }
    skill ||= "prowess";

    const bonus = Number(sys.rollBonus ?? 0) + Number(inst?.system.bonusRoll ?? 0);
    const notes = this._rollNotes(skill);
    notes.unshift(`${inst ? `Through ${inst.name}` : "Innate"}. ${sys.effectSummary}`);
    if (sys.quick) notes.push("Quick: may be paid with the Quick Action.");
    if (inst?.system.doublesMargin) notes.push("Heavy: costs the Action and the Quick Action; the margin doubles (PHB 4.1.1).");

    // Strain lands on the Instrument's Primary Attribute, ignoring Resistance (PHB 4.2.3).
    if (sys.strain > 0) {
      const attr = inst?.system.primaryAttribute ?? SKILL_ATTRS[skill][0];
      const { before, after } = await this.actor.takeStress(attr, sys.strain);
      notes.push(`Strain ${sys.strain} on ${ATTR_LABEL[attr]} (${before} &rarr; ${after}).`);
    }

    const gem = inst?.system.gemActive ? inst.system.gem : null;
    const gemPierce = gem?.type === "emerald" && sys.pierceTotal ? Number(gem.tier) : 0;
    const wdice = sys.offensive && inst?.type === "instrument" ? (inst.system.weightDice ?? "") : "";
    if (wdice) notes.push(`${inst.system.weightLabel}: +${wdice}.`);
    await this._postRoll(this._skillFormula(skill, bonus, wdice), `${tech.name} (${SKILL_LABEL[skill]})`, notes.join("<br>"),
      sys.dealsStress && inst ? roll => this._stressFlag(inst, tech.name, roll.total, {
        bespoke: Number(sys.stressRider ?? 0), pierce: Number(sys.pierceTotal ?? 0) + Number(inst.system.bonusPierce ?? 0) + gemPierce,
        quick: !!sys.quick
      }) : null);
  }

  /** Use an Instrument's bound Enchantment (GMG 8.2.0): no Technique known, Strain still applies. */
  static async _onRollEnchantment(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const inst = this.actor.items.get(id);
    const ench = inst?.system?.enchantment;
    if (!inst || !ench?.enabled) return;
    const opts = inst.system.primarySkills.map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
    const answer = await ask(`Use ${inst.name}`, `<div class="form-group"><label>Skill</label><select name="skill">${opts}</select></div>`, "Roll");
    if (!answer) return;
    const notes = this._rollNotes(answer.skill);
    notes.unshift(`Enchantment: ${ench.effectSummary}`);
    if (ench.strain > 0) {
      const { before, after } = await this.actor.takeStress(inst.system.primaryAttribute, ench.strain);
      notes.push(`Strain ${ench.strain} on ${ATTR_LABEL[inst.system.primaryAttribute]} (${before} &rarr; ${after}).`);
    }
    await this._postRoll(this._skillFormula(answer.skill, inst.system.bonusRoll), `${inst.name} (${SKILL_LABEL[answer.skill]})`, notes.join("<br>"));
  }

  /**
   * The chat-card payload the Stress button reads. The margin cap follows the
   * Instrument's weight (PHB 6.7.0).
   */
  _stressFlag(inst, name, total, { bespoke = 0, pierce = 0, quick = false } = {}) {
    const primary = inst.system.primaryAttribute;
    const a = this.actor.system.attributes?.[primary];
    const potential = Number(a?.potential?.max ?? 0);
    const weight = inst.system.weight || inst.system.weightClass || "light";
    const label = key => `${MARGIN_CAP[key][2]} ${ATTR_LABEL[primary] ?? ""} Potential`;
    return {
      stress: {
        actorId: this.actor.id, name, attackTotal: total, instrument: inst.name,
        cap: marginCap(potential, weight), capLabel: label(weight),
        mult: Number(inst.system.marginMultiplier ?? 1),
        types: inst.system.stressTypes ?? [], bespoke, pierce
      }
    };
  }

  /**
   * Evaluate a formula and post it. Every roll carries its dice so a Foil Token
   * can reroll one of them (PHB 3.2.0); a Technique's roll also carries its
   * Stress payload. Flags are set at creation, before the card renders.
   */
  async _postRoll(formula, title, note, makeFlags = null) {
    const roll = new Roll(formula);
    await roll.evaluate();
    const flavor = `<div class="foil-flavor"><strong>${title}</strong>${note ? `<br><em>${note}</em>` : ""}</div>`;
    const dice = roll.dice.flatMap(d => d.results.map(r => ({ faces: d.faces, value: r.result })));
    const flags = { foil: { reroll: { actorId: this.actor.id, title, total: roll.total, dice }, ...(makeFlags?.(roll) ?? {}) } };
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor, flags });
  }

  // ─── Foil Tokens (PHB 3.2.0) ────────────────────────────────────────────────

  static async _onEarnToken(event, target) {
    const delta = Number(target.dataset.delta ?? 1);
    await this.actor.setFoilTokens(this.actor.foilTokens + delta);
  }

  /** Spend a Token: halve the Stress one source dealt, rounded down (PHB 3.2.0). */
  static async _onAbsorbStress() {
    if (this.actor.foilTokens < 1) return ui.notifications?.warn("No Foil Tokens to spend.");
    const attrs = this.actor.system.attributes ?? {};
    const rows = ATTRIBUTE_KEYS.map(k => {
      const a = attrs[k];
      return `<div class="form-group"><label>${ATTR_LABEL[k]} (${a.potential.current}/${a.potential.max})</label>`
        + `<input type="number" name="${k}" value="0" min="0" /></div>`;
    }).join("");
    const answer = await ask("Spend a Foil Token",
      `<p>Enter the Stress one source put on each Attribute. The token halves it, rounded down.</p>${rows}`, "Halve");
    if (!answer) return;
    const amounts = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, Math.max(0, Math.trunc(Number(answer[k]) || 0))]));
    const total = Object.values(amounts).reduce((n, v) => n + v, 0);
    if (!total) return;
    let back = total - Math.floor(total / 2);
    const lines = [];
    for (const k of ATTRIBUTE_KEYS) {
      if (!amounts[k] || !back) continue;
      const take = Math.min(amounts[k], back);
      back -= take;
      const { before, after } = await this.actor.heal(k, take);
      lines.push(`${ATTR_LABEL[k]} ${before} &rarr; ${after}`);
    }
    await this.actor.setFoilTokens(this.actor.foilTokens - 1);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="foil-flavor"><strong>Foil Token spent: ${total} Stress halved to ${Math.floor(total / 2)}</strong><br><em>${lines.join(", ")}</em></div>` });
  }

  // ─── Conditions, gear, rest ─────────────────────────────────────────────────

  static async _onAddCondition() {
    const opts = CONDITIONS.map(c => `<option value="${c}">${c}</option>`).join("");
    const answer = await ask("Add a Condition",
      `<div class="form-group"><label>Condition</label><select name="name">${opts}</select></div>`
      + `<div class="form-group"><label>Rounds</label><input type="text" name="rounds" placeholder="blank = one scene" /></div>`
      + `<div class="form-group"><label>Note</label><input type="text" name="note" placeholder="source, amount" /></div>`, "Add");
    if (!answer?.name) return;
    const list = foundry.utils.deepClone(this.actor.system.conditions ?? []);
    list.push({ name: answer.name, rounds: answer.rounds ?? "", note: answer.note ?? "" });
    await this.actor.update({ "system.conditions": list });
  }

  static async _onRemoveCondition(event, target) {
    const list = foundry.utils.deepClone(this.actor.system.conditions ?? []);
    list.splice(Number(target.dataset.index), 1);
    await this.actor.update({ "system.conditions": list });
  }

  /** The row's checkbox: equipped when checked, carried when not (PHB 4.1.0). */
  static async _onToggleEquipped(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item || item.system.innate) return;
    await this._setLocation(item, item.system.location === "equipped" ? "carried" : "equipped");
  }

  /** An unequipped item is carried or stored; the icon swaps the two (PHB 5.2.6). */
  static async _onCycleLocation(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item || item.system.innate) return;
    await this._setLocation(item, item.system.location === "carried" ? "stored" : "carried");
  }

  async _setLocation(item, next) {
    // One worn armor and one Ward at a time (PHB 6.6.0): equipping one carries the other.
    const cat = item.system.category;
    if (next === "equipped" && ["armor", "ward"].includes(cat)) {
      const others = this.actor.items.filter(i => i.id !== item.id && i.type === "equipment"
        && i.system.category === cat && i.system.location === "equipped");
      if (others.length) await this.actor.updateEmbeddedDocuments("Item", others.map(i => ({ _id: i.id, "system.location": "carried" })));
    }
    await item.update({ "system.location": next });
  }

  /**
   * Rest (PHB 6.10.0): 1d4 Stress off one Attribute per 2 hours, eating one
   * ration per 8 hours. Without a ration to spend, the time passes but heals
   * nothing. A long rest may pour every roll into one Attribute.
   */
  static async _onRest() {
    const attrs = this.actor.system.attributes ?? {};
    const hurt = ATTRIBUTE_KEYS.filter(k => Number(attrs[k]?.potential?.current ?? 0) < Number(attrs[k]?.potential?.max ?? 0));
    if (!hurt.length) return ui.notifications?.info(`${this.actor.name} has nothing to recover.`);
    const tracksRations = this.actor.type === "character";
    const opts = hurt.map(k => `<option value="${k}">${ATTR_LABEL[k]} (${attrs[k].potential.current}/${attrs[k].potential.max})</option>`).join("");
    const answer = await ask(`${this.actor.name} rests`,
      `<p>Each 2 hours of rest removes 1d4 Stress from one Attribute. One ration feeds 8 hours.</p>`
      + `<div class="form-group"><label>Attribute</label><select name="key">${opts}</select></div>`
      + `<div class="form-group"><label>Hours</label><input type="number" name="hours" value="8" min="${REST_BLOCK_HOURS}" step="${REST_BLOCK_HOURS}" /></div>`
      + (tracksRations ? `<p>Rations on hand: ${this.actor.system.rations}</p>` : ""), "Rest");
    if (!answer) return;
    const hours = Math.max(0, Math.trunc(Number(answer.hours) || 0));
    let blocks = Math.floor(hours / REST_BLOCK_HOURS);
    let rations = 0;
    if (tracksRations) {
      const needed = Math.ceil(hours / REST_RATION_HOURS);
      rations = Math.min(needed, this.actor.system.rations);
      blocks = Math.min(blocks, Math.floor(rations * REST_RATION_HOURS / REST_BLOCK_HOURS));
    }
    const lines = [];
    if (blocks > 0) {
      const roll = await new Roll(`${blocks}d4`).evaluate();
      const { before, after } = await this.actor.heal(answer.key, roll.total);
      lines.push(`${ATTR_LABEL[answer.key]} ${before} &rarr; ${after} (${blocks}d4 = ${roll.total})`);
    } else {
      lines.push("No ration to eat: the time passes, but heals nothing.");
    }
    if (rations) {
      await this.actor.update({ "system.rations": this.actor.system.rations - rations });
      lines.push(`${rations} ration${rations === 1 ? "" : "s"} eaten`);
    }
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="foil-flavor"><strong>${this.actor.name} rests ${hours} hours</strong><br><em>${lines.join("; ")}</em></div>` });
  }

  // ─── Embedded item CRUD ─────────────────────────────────────────────────────

  static async _onCreateItem(event, target) {
    const type = target.dataset.type;
    const label = { instrument: "Instrument", technique: "Technique", feat: "Feat", equipment: "Equipment", background: "Background", origin: "Ancestry" }[type] ?? "Item";
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name: `New ${label}`, type }]);
    item?.sheet?.render(true);
  }

  static _onEditItem(event, target) {
    this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId)?.sheet?.render(true);
  }

  static async _onDeleteItem(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    const D = dialogApi();
    const ok = D ? await D.confirm({ window: { title: "Delete" }, content: `<p>Delete <strong>${item.name}</strong>?</p>` }) : true;
    if (ok) await item.delete();
  }

  static async _onGenerateCharacter() {
    const { FoilChargen } = await import("../apps/chargen.js");
    new FoilChargen({ actor: this.actor }).render(true);
  }

  static async _onOpenAdvancement() {
    const { FoilAdvancement } = await import("../apps/advancement.js");
    new FoilAdvancement({ actor: this.actor }).render(true);
  }

  /** Make window-content the scroll container so re-renders keep scroll position. */
  async _onRender(context, options) {
    // The base class binds drag-and-drop here; skipping it breaks dropping Items on the sheet.
    await super._onRender(context, options);
    this.element.querySelector(".window-content")?.classList.add("foil-sheet", this.actor.type);
    // A Stress field writes back current Potential: max minus the Stress entered.
    for (const input of this.element.querySelectorAll("input[data-stress]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const key = input.dataset.stress;
        const max = Number(this.actor.system.attributes?.[key]?.potential?.max ?? 0);
        const stress = Math.max(0, Math.trunc(Number(input.value)) || 0);
        this.actor.update({ [`system.attributes.${key}.potential.current`]: Math.max(0, max - stress) });
      });
    }
  }

  /** A character has one Ancestry and one Background (PHB 2.5.0): dropping one replaces the old. */
  async _onDropItem(event, item) {
    const single = this.actor.type === "character" && ["origin", "background"].includes(item.type)
      && this.actor.uuid !== item.parent?.uuid;
    if (!single) return super._onDropItem(event, item);
    const old = this.actor.items.filter(i => i.type === item.type).map(i => i.id);
    if (old.length) await this.actor.deleteEmbeddedDocuments("Item", old);
    const created = await super._onDropItem(event, item);
    if (created) {
      await this.actor.update({ [`system.${item.type === "origin" ? "ancestry" : "background"}`]: created.name });
      ui.notifications?.info(`${created.name} added. Its Training applies now; Create applies its dice, Feats, coin, and kit.`);
    }
    return created;
  }
}

export class FoilCharacterSheet extends FoilActorSheet {
  static DEFAULT_OPTIONS = { classes: ["foil", "sheet", "actor", "character"] };

  static PARTS = {
    header:     { template: "systems/foil/templates/actor/character-header.hbs" },
    attributes: { template: "systems/foil/templates/actor/character-attributes.hbs",
      templates: ["systems/foil/templates/actor/partials/dice-pool.hbs"] },
    body:       { template: "systems/foil/templates/actor/character-body.hbs",
      templates: ["systems/foil/templates/actor/partials/skills-table.hbs", "systems/foil/templates/actor/partials/conditions.hbs"] },
    items:      { template: "systems/foil/templates/actor/character-items.hbs",
      templates: ["systems/foil/templates/actor/partials/item-list.hbs"] },
    biography:  { template: "systems/foil/templates/actor/character-biography.hbs" }
  };

  async _prepareContext(options) {
    const ctx = this._commonContext();
    const sys = this.actor.system;
    return {
      ...ctx,
      xp: sys.xp ?? { total: 0, spent: 0, available: 0 },
      carry: sys.carry ?? { weight: 0, limit: 0, penalty: 0 },
      ancestryName: this.actor.items.find(i => i.type === "origin")?.name ?? "",
      backgroundName: this.actor.items.find(i => i.type === "background")?.name ?? ""
    };
  }
}

export class FoilCreatureSheet extends FoilActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["foil", "sheet", "actor", "creature"],
    position: { width: 840, height: 660 }
  };

  static PARTS = {
    header:    { template: "systems/foil/templates/actor/creature-header.hbs" },
    body:      { template: "systems/foil/templates/actor/creature-body.hbs",
      templates: ["systems/foil/templates/actor/partials/dice-pool.hbs", "systems/foil/templates/actor/partials/skills-table.hbs",
                  "systems/foil/templates/actor/partials/conditions.hbs"] },
    items:     { template: "systems/foil/templates/actor/creature-items.hbs",
      templates: ["systems/foil/templates/actor/partials/item-list.hbs"] },
    biography: { template: "systems/foil/templates/actor/creature-biography.hbs" }
  };

  async _prepareContext(options) {
    return { ...this._commonContext(), health: this.actor.system.health ?? 0 };
  }
}

// ─── Chat card buttons ────────────────────────────────────────────────────────

function addButton(html, label, cls, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  (html.querySelector(".message-content") ?? html).appendChild(btn);
}

/**
 * Computed Stress for a landed Technique (PHB 6.7.0; math in src/stress.js).
 * Applying it to the target stays with the table.
 */
async function computeStress(flag) {
  const typeOpts = [`<option value="">None</option>`, ...(flag.types ?? []).map((t, i) =>
    `<option value="${i}" ${i === 0 ? "selected" : ""}>${t.label}</option>`)].join("");
  const answer = await ask(`${flag.name}: Stress`,
    `<p>${flag.name} rolled <strong>${flag.attackTotal}</strong>.</p>`
    + `<div class="form-group"><label>Target's Oppose total</label><input type="number" name="oppose" autofocus /></div>`
    + `<div class="form-group"><label>Attribute aimed at</label><select name="kind"><option value="physical">Might or Finesse</option><option value="mental">Wit or Presence</option></select></div>`
    + `<div class="form-group"><label>Target's Resistance of that kind <em>(negative for Vulnerable)</em></label><input type="number" name="resistance" value="0" /></div>`
    + ((flag.types ?? []).length ? `<div class="form-group"><label>Type effect <em>(one, your choice)</em></label><select name="type">${typeOpts}</select></div>` : "")
    + `<div class="form-group"><label>Other Stress bonus <em>(a Feat such as Heavy Hand)</em></label><input type="number" name="other" value="0" /></div>`,
    "Compute");
  if (!answer) return;
  const oppose = Number(answer.oppose);
  if (answer.oppose === "" || answer.oppose === null || Number.isNaN(oppose)) return;
  const speaker = ChatMessage.getSpeaker({ actor: game.actors.get(flag.actorId) });
  const r = stressFor({
    attack: flag.attackTotal, oppose, name: flag.name,
    cap: flag.cap, capLabel: flag.capLabel, capAttr: flag.capAttr,
    mult: Number(flag.mult ?? (flag.double ? 2 : 1)),
    kind: answer.kind === "mental" ? "mental" : "physical",
    resistance: Number(answer.resistance) || 0,
    type: answer.type === "" || answer.type === undefined ? null : flag.types?.[Number(answer.type)] ?? null,
    bespoke: Number(flag.bespoke ?? 0), other: Number(answer.other) || 0, pierce: Number(flag.pierce ?? 0)
  });
  if (!r.landed) {
    return ChatMessage.create({ speaker, content: `<div class="foil-flavor"><strong>${flag.name} fails.</strong><br><em>The Oppose beat it (PHB 6.5.0).</em></div>` });
  }
  return ChatMessage.create({ speaker, content:
    `<div class="foil-flavor"><strong>${r.stress} Stress</strong> to the Attribute aimed at<br><em>${r.parts.join("; ")}.</em></div>` });
}

/** Spend a Foil Token to reroll one die of a posted Skill roll; the new result stands (PHB 3.2.0). */
async function rerollDie(message, flag) {
  const actor = game.actors.get(flag.actorId);
  if (!actor?.isOwner) return ui.notifications?.warn("Only this roll's owner can spend its Foil Token.");
  if (actor.foilTokens < 1) return ui.notifications?.warn(`${actor.name} has no Foil Tokens.`);
  if (!flag.dice?.length) return;
  const opts = flag.dice.map((d, i) => `<option value="${i}">d${d.faces}: ${d.value}</option>`).join("");
  const answer = await ask("Spend a Foil Token: reroll one die", `<div class="form-group"><label>Die</label><select name="die">${opts}</select></div>`, "Reroll");
  if (!answer) return;
  const i = Number(answer.die);
  const die = flag.dice[i];
  const roll = await new Roll(`1d${die.faces}`).evaluate();
  const total = flag.total - die.value + roll.total;
  const dice = flag.dice.map((d, j) => j === i ? { faces: d.faces, value: roll.total } : d);
  await actor.setFoilTokens(actor.foilTokens - 1);
  const flags = { foil: { reroll: { ...flag, total, dice } } };
  const stress = message.getFlag("foil", "stress");
  if (stress) flags.foil.stress = { ...stress, attackTotal: total };
  await ChatMessage.create({ speaker: message.speaker, flags, content:
    `<div class="foil-flavor"><strong>${flag.title}: ${total}</strong><br><em>Foil Token spent. d${die.faces} rerolled ${die.value} &rarr; ${roll.total}.</em></div>` });
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  const stress = message.getFlag("foil", "stress");
  if (stress) addButton(html, `Stress: ${stress.name}`, "foil-stress-followup", () => computeStress(stress));
  const reroll = message.getFlag("foil", "reroll");
  const owner = game.actors.get(reroll?.actorId);
  // Only characters hold Foil Tokens (PHB 3.2.0).
  if (reroll && owner?.isOwner && owner.type === "character") {
    addButton(html, "Foil Token: reroll a die", "foil-token-reroll", () => rerollDie(message, reroll));
  }
});

