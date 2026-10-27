/**
 * src/actor/actor-sheet.js
 * FoilCharacterSheet / FoilCreatureSheet (Foilbound 0.6.0). A faithful sheet
 * and dice roller. Automations, each by explicit request:
 *   - Strain lands on the Instrument's Primary Attribute when a Technique is
 *     rolled (PHB 4.2.3).
 *   - A Technique rolled with tokens targeted prompts each target's Oppose, works
 *     out the margin and Stress, and asks before applying it (src/oppose.js).
 *     With no target, the chat card computes Stress from a typed Oppose total.
 *   - Conditions that modify rolls (Weakened, Reeling, Blinded, Prone, Invisible)
 *     are added to rolls (src/combat.js).
 *   - Foil Token spends: halve one source's Stress, or reroll one die of a posted
 *     roll (PHB 3.2.0).
 * Everything else (other Conditions, Habits) stays with the table.
 */

import { annotateVars } from "../var-tips.js";
import {
  ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_ATTRS, SKILL_KEYS, SKILL_LABEL, SKILL_ABBR, FOIL_AXES,
  FOIL_TOKEN_MAX, CONDITIONS, EQUIPMENT_CATEGORY_LABEL, LOCATION_LABEL,
  REST_BLOCK_HOURS, REST_RATION_HOURS
} from "../constants.js";
import { consumableSummary, equipmentSummary } from "../registry.js";
import { stressFor, alwaysTypes, isAlwaysType } from "../stress.js";
import { ask, dialogApi, addButton, esc } from "../dialogs.js";
import "../chat-actions.js";
import { allowedAims, targetFlags } from "../combat.js";
import { rollSkill, rollKit, rollTechnique, rollEnchantment, stressPayload, validInstruments } from "../../rules/roll.js";
import { resolveOppose } from "../oppose.js";
import { restPlan } from "../rest.js";
import { toilStretch } from "../toil.js";
import { reachBand, reachLine, rangeWarning } from "../range.js";
import { logEvent, who } from "../playtest-log.js";
import { glossarize, bindTerms, lookup } from "../glossary-ui.js";

const LOCATION_ICON = { equipped: "fa-hand", carried: "fa-suitcase", stored: "fa-box-archive" };
const locationView = loc => ({ key: loc, icon: LOCATION_ICON[loc] ?? "fa-suitcase", label: LOCATION_LABEL[loc] ?? loc });

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2Base = foundry.applications.sheets.ActorSheetV2;


/** How rules/roll.js writes text for Foundry: HTML-escaped, with <br> between lines. */
const FOUNDRY_TEXT = { esc, br: "<br>", arrow: "&rarr;" };

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
      adjustRations:    FoilActorSheet._onAdjustRations,
      invokeHabit:      FoilActorSheet._onInvokeHabit,
      absorbStress:     FoilActorSheet._onAbsorbStress,
      addCondition:     FoilActorSheet._onAddCondition,
      removeCondition:  FoilActorSheet._onRemoveCondition,
      toggleEquipped:   FoilActorSheet._onToggleEquipped,
      rest:             FoilActorSheet._onRest,
      toil:             FoilActorSheet._onToil,
      editActorImage:   FoilActorSheet._onEditImage,
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
      // The readouts' math: each live pool's dice range, then Training and gear (Mass and Conditions apply on the roll).
      const attrs = this.actor.system.attributes ?? {};
      const live = pair.filter(ak => attrs[ak] && !attrs[ak].down && attrs[ak].diceFormula);
      const dice = live.map(ak => `${ATTR_LABEL[ak]} ${attrs[ak].diceFormula} (${attrs[ak].min}-${attrs[ak].max}, avg ${attrs[ak].avg})`);
      const dropped = pair.filter(ak => attrs[ak]?.down).map(ak => `${ATTR_LABEL[ak]} Incapacitated, no dice`);
      const readoutMath = [...dice, ...dropped, `Training ${s.trainingBase ?? 0}`, ...(s.trainingBonus ? [`Training from Feats ${s.trainingBonus}`] : []),
        ...(s.skillBonus ? [`gear ${s.skillBonus}`] : [])].join(" + ")
        + `. Passive: half of ${s.rollMax ?? 0}, rounded down, = ${s.passive ?? 0}. Training cap ${s.trainingCap ?? 0} (dice in both pools). On a roll, Mass and Conditions also apply.`;
      return {
        readoutMath,
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
        ...axis, lean: v.lean ?? "", habit: v.habit ?? "", canInvoke: v.lean === "low" || v.lean === "high",
        leanOptions: [
          { value: "", label: "Neutral" }, { value: "low", label: axis.low }, { value: "high", label: axis.high }
        ].map(o => ({ ...o, selected: o.value === (v.lean ?? "") }))
      };
    });
  }

  /** The character's one Origin or Background, for the header. */
  _identity(type, help) {
    const item = this.actor.items.find(i => i.type === type);
    return item ? { id: item.id, name: item.name, help: help(item) } : null;
  }

  _conditionRows() {
    return (this.actor.system.conditions ?? []).map((c, idx) => ({ idx, ...c, known: CONDITIONS.includes(c.name), help: lookup(c.name)?.text ?? "" }));
  }

  _itemGroups() {
    const groups = { origin: [], background: [], instrument: [], technique: [], feat: [], equipment: [], consumable: [], builtin: [] };
    for (const item of this.actor.items) {
      if (!(item.type in groups)) continue;
      const s = item.system;
      const view = { id: item.id, name: item.name, img: item.img, system: s };
      if (item.type === "instrument") {
        view.primaryLabel = ATTR_LABEL[s.primaryAttribute] ?? "";
        view.kit = (s.kit ?? []).map((k, idx) => ({ idx, name: k.name, skillLabel: SKILL_LABEL[k.skill] ?? k.skill, effect: k.effect, effectHtml: glossarize(k.effect) }));
        view.typesHtml = glossarize(s.typesLabel);
        if (!s.innate) view.place = locationView(s.location);
        // An Instrument's built-in Techniques join the Techniques tab, with their source (PHB 7.4.0).
        for (const k of view.kit) groups.builtin.push({ ...k, id: item.id, source: item.name, ready: s.innate || s.location === "equipped" });
      } else if (item.type === "technique") {
        view.effectDisplay = glossarize(s.effectSummary);
        view.skillLabel = s.skill ? SKILL_LABEL[s.skill] : "Any Skill";
        const valid = validInstruments(this.actor, item);
        view.usableWith = s.innate ? "Innate (no Instrument)"
          : valid.length ? valid.map(i => i.system.location === "equipped" || i.system.innate ? i.name : `${i.name} (${LOCATION_LABEL[i.system.location].toLowerCase()})`).join(", ")
          : "no Instrument it has";
        view.unusable = !s.innate && !valid.length;
      } else if (item.type === "feat") {
        view.effectHtml = glossarize(s.effect);
      } else if (item.type === "equipment") {
        view.categoryLabel = EQUIPMENT_CATEGORY_LABEL[s.category] ?? "";
        view.effectSummary = glossarize(equipmentSummary(s));
        view.place = locationView(s.location);
      } else if (item.type === "consumable") {
        view.effectSummary = glossarize(consumableSummary(s));
        view.place = locationView(s.location);
      }
      groups[item.type].push(view);
    }
    // A Heavy Instrument takes both hands: nothing else in hand while it's ready (PHB 4.1.1).
    const inHand = [...this.actor.items].filter(i => (i.type === "instrument" && !i.system.innate && i.system.location === "equipped")
      || (i.type === "equipment" && i.system.category === "shield" && i.system.location === "equipped"));
    const heldInst = inHand.filter(i => i.type === "instrument");
    const tooMany = heldInst.length > 2 || (heldInst.length === 2 && heldInst.some(i => i.system.weight !== "light"));
    for (const v of groups.instrument) {
      if (tooMany && v.system.location === "equipped" && !v.system.innate) v.handsWarning = "Only one Instrument can be equipped, or two Light ones.";
      else if (v.system.twoHanded && v.system.location === "equipped" && inHand.length > 1) {
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
  // ─── Rolling ────────────────────────────────────────────────────────────────

  /**
   * What a roll is (which Instrument and Skill, the formula and its math, Strain, the Stress payload) is decided
   * in rules/roll.js, the same code the companion app runs. The sheet supplies what only Foundry has: the dialogs,
   * the targeted tokens, the range on the canvas, the log, and the chat message.
   */
  _rollIO() {
    return {
      warn: message => ui.notifications?.warn(message),
      pickSkill: async ({ tech, choices }) => {
        const opts = choices.map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
        const pick = await ask(`Use ${esc(tech.name)}`, `<div class="form-group"><label>Skill</label><select name="skill">${opts}</select></div>`, "Roll");
        return pick ? (pick.skill || choices[0]) : null;
      },
      pickInstrument: async ({ tech, valid, inst, skill, skillsOf }) => {
        const skillOptions = i => skillsOf(i).map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
        let content = `<p><strong>${esc(tech.name)}</strong></p>`;
        content += valid.length > 1
          ? `<div class="form-group"><label>Instrument</label><select name="instrumentId">${valid.map(i =>
              `<option value="${i.id}" data-skills="${skillsOf(i).join(",")}">${esc(i.name)}${i.system.primaryAttribute ? ` (${ATTR_LABEL[i.system.primaryAttribute]})` : ""}</option>`).join("")}</select></div>`
          : `<input type="hidden" name="instrumentId" value="${inst.id}" />`;
        if (!skill) {
          content += `<div class="form-group"><label>Skill <em>(one ${esc(valid.length > 1 ? "the chosen" : inst.name + "'s")} Primary Attribute allows)</em></label><select name="skill">${skillOptions(inst)}</select></div>`;
        }
        const onRender = root => {
          const pick = root.querySelector('select[name="instrumentId"]'), sk = root.querySelector('select[name="skill"]');
          if (!pick || !sk) return;
          pick.addEventListener("change", () => {
            const allowed = pick.selectedOptions[0]?.dataset.skills?.split(",") ?? [];
            sk.innerHTML = allowed.map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
          });
        };
        const answer = await ask(`Use ${tech.name}`, content, "Roll", onRender);
        return answer ?? null;
      },
      pickEnchantSkill: async ({ inst }) => {
        const opts = inst.system.primarySkills.map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
        const answer = await ask(`Use ${esc(inst.name)}`, `<div class="form-group"><label>Skill</label><select name="skill">${opts}</select></div>`, "Roll");
        return answer ? answer.skill : null;
      },
      aim: ({ inst, name, text, requires }) => this._aimAtTargets(inst, name, text, requires),
      rangeNotes: opts => this._rangeNotes(opts),
      takeStress: (key, amount) => this.actor.takeStress(key, amount),
      log: (type, data) => logEvent(type, { actor: who(this.actor), ...data }),
      post: ({ formula, title, note, payload }) => this._postRoll(formula, title, note, !payload ? null : roll => ({
        ...(payload.cond ? { cond: this._condFlag() } : {}),
        ...(payload.condition ? this._conditionFlag(payload.condition.name, roll.total, payload.condition.condition, { melee: payload.condition.melee }) : {}),
        ...(payload.stress ? stressPayload(this.actor, payload.stress.inst, payload.stress.name, roll.total, payload.stress) : {})
      }))
    };
  }

  static async _onRollSkill(event, target) {
    await rollSkill({ actor: this.actor, skill: target.dataset.key, io: this._rollIO(), fmt: FOUNDRY_TEXT });
  }

  /** Roll one of an Instrument's three built-in Techniques (PHB 7.4.0). */
  static async _onRollKit(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    await rollKit({ actor: this.actor, inst: this.actor.items.get(id), index: target.dataset.index, io: this._rollIO(), fmt: FOUNDRY_TEXT });
  }

  static async _onRollTechnique(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const tech = this.actor.items.get(id);
    if (tech) await rollTechnique({ actor: this.actor, tech, io: this._rollIO(), fmt: FOUNDRY_TEXT });
  }

  /** Use an Instrument's bound Enchantment (PHB 5.3.4): no Technique known, Strain still applies. */
  static async _onRollEnchantment(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    await rollEnchantment({ actor: this.actor, inst: this.actor.items.get(id), io: this._rollIO(), fmt: FOUNDRY_TEXT });
  }

  /** A Condition-applying Technique's card payload: each target Opposes with the Condition's two Skills (PHB 6.5.0). */
  _conditionFlag(name, total, condition, { melee = false } = {}) {
    const tokens = [...(game.user?.targets ?? [])];
    if (!tokens.length) return {};
    return { stress: {
      actorId: this.actor.id, name, attackTotal: total, condition, melee,
      targets: tokens.map(t => ({ uuid: t.document.uuid, actorId: t.actor?.id ?? "", name: t.name }))
    } };
  }

  /** The roller, the targeted tokens, and the roller's Conditions that end on use, for the card's Condition buttons. */
  _condFlag() {
    const a = this.actor;
    const ends = (a.system.conditions ?? []).some(c => c.name === "Invisible")
      ? [{ uuid: a.uuid, actorId: a.id, actorName: a.name, name: "Invisible" }] : [];
    return {
      actorUuid: a.uuid, actorId: a.id, actorName: a.name, ends,
      targets: [...(game.user?.targets ?? [])].map(t => ({ uuid: t.document.uuid, actorId: t.actor?.id ?? "", name: t.name }))
    };
  }

  /**
   * With tokens targeted, the attacker names the Attribute aimed at and the Type used (PHB 6.4.0, 6.7.0).
   * Resolves to null if cancelled, and to no targets when nothing is targeted.
   */
  async _aimAtTargets(inst, name, text = "", requires = []) {
    const tokens = [...(game.user?.targets ?? [])];
    if (!tokens.length) return { targets: [], notes: [] };
    const notes = tokens.flatMap(t => targetFlags(t.actor?.system?.conditions).map(f => `${esc(t.name)}: ${f}`));
    const types = inst.system.stressTypes ?? [];
    const allowed = allowedAims({ text, stressTypes: inst.system.stressTypes ?? [], requires });
    const attrs = (allowed.length ? allowed : ATTRIBUTE_KEYS).map(k => `<option value="${k}">${ATTR_LABEL[k]}</option>`).join("");
    const typeOpts = [...types.map((t, i) => isAlwaysType(t) ? "" : `<option value="${i}">${esc(t.label)}</option>`), `<option value="">None</option>`].join("");
    const answer = await ask(`${name}: aim`,
      `<p>Target${tokens.length > 1 ? "s" : ""}: ${tokens.map(t => esc(t.name)).join(", ")}</p>${notes.length ? `<p><em>${notes.join("<br>")}</em></p>` : ""}`
      + `<div class="form-group"><label>Attribute aimed at</label><select name="aim">${attrs}</select></div>`
      + (types.some(t => !isAlwaysType(t)) ? `<div class="form-group"><label>Type used <em>(one for this Technique; Drawn and Fired always add)</em></label><select name="type">${typeOpts}</select></div>` : "")
      + `<div class="form-group"><label>Other Stress bonus <em>(a Feat such as Heavy Hand)</em></label><input type="number" name="other" value="0" /></div>`,
      "Roll");
    if (!answer) return null;
    return {
      notes,
      targets: tokens.map(t => ({ uuid: t.document.uuid, actorId: t.actor?.id ?? "", name: t.name })),
      aim: (allowed.length ? allowed : ATTRIBUTE_KEYS).includes(answer.aim) ? answer.aim : (allowed[0] ?? "might"),
      typeIndex: types.some(t => !isAlwaysType(t)) ? (answer.type ?? "") : "",
      other: Math.trunc(Number(answer.other) || 0)
    };
  }

  /**
   * Reach notes for a roll's card. With no target they say how far the Technique reaches;
   * with targets they warn about any outside it. They never block the roll.
   */
  _rangeNotes({ band = "", min = "", extend = 0 } = {}) {
    const reach = reachBand(band, extend);
    const targets = [...(game.user?.targets ?? [])];
    if (!targets.length) {
      const line = reachLine(reach, min);
      return line ? [line] : [];
    }
    const me = this.actor.getActiveTokens()[0];
    const grid = globalThis.canvas?.grid;
    if (!me || !grid || (grid.units && !/^(ft|feet|foot)/i.test(grid.units))) return [];
    return targets.map(t => {
      const apart = grid.measurePath([me.center, t.center]).distance;
      const gap = Math.max(0, apart - ((me.document.width + t.document.width) / 2) * grid.distance);
      return rangeWarning(t.name, gap, reach, min);
    }).filter(Boolean);
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
    const st = flags.foil.stress;
    logEvent("roll", {
      actor: who(this.actor), title, formula, total: roll.total, dice,
      notes: note ? String(note).replace(/<br>/g, " ").replace(/<[^>]+>/g, "") : "",
      attack: st ? { name: st.name, instrument: st.instrument, aim: st.aim, condition: st.condition?.name ?? null,
        targets: (st.targets ?? []).map(t => t.name), cap: st.cap, mult: st.mult, bespoke: st.bespoke, pierce: st.pierce,
        melee: st.melee, type: st.typeIndex === "" || st.typeIndex === undefined ? null : st.types?.[Number(st.typeIndex)]?.label ?? null } : null
    });
    return roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor, flags });
  }

  // ─── Foil Tokens (PHB 3.2.0) ────────────────────────────────────────────────

  /** Ask the table to award a Foil Token for a held Habit (PHB 3.2.0): the GM approves from the card. */
  static async _onInvokeHabit(event, target) {
    const axis = FOIL_AXES.find(a => a.key === target.dataset.axis);
    const v = this.actor.system.foil?.[axis?.key];
    if (!axis || !["low", "high"].includes(v?.lean)) return ui.notifications?.warn("A Neutral axis can't be invoked.");
    const habit = v.habit || (v.lean === "high" ? axis.high : axis.low);
    logEvent("invoke", { actor: who(this.actor), axis: axis.key, habit, lean: v.lean });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flags: { foil: { invoke: { actorId: this.actor.id, axis: axis.key, habit, awarded: false } } },
      content: `<div class="foil-flavor"><strong>${esc(this.actor.name)} invokes ${esc(axis.label)}: ${esc(habit)}</strong><br><em>Waiting for GM approval.</em></div>` });
  }

  static async _onAdjustRations(event, target) {
    const next = Math.max(0, Number(this.actor.system.rations ?? 0) + Number(target.dataset.delta ?? 1));
    await this.actor.update({ "system.rations": next });
  }

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

  async _setLocation(item, next) {
    // One worn armor and one Ward at a time (PHB 6.6.0): equipping one carries the other.
    const cat = item.system.category;
    if (next === "equipped" && ["armor", "ward"].includes(cat)) {
      const others = this.actor.items.filter(i => i.id !== item.id && i.type === "equipment"
        && i.system.category === cat && i.system.location === "equipped");
      if (others.length) await this.actor.updateEmbeddedDocuments("Item", others.map(i => ({ _id: i.id, "system.location": "carried" })));
    }
    // One Instrument in hand, or two Light ones: equipping another puts down what no longer fits.
    if (next === "equipped" && item.type === "instrument" && !item.system.innate) {
      const held = this.actor.items.filter(i => i.id !== item.id && i.type === "instrument" && !i.system.innate && i.system.location === "equipped");
      const keep = item.system.weight === "light" ? held.filter(i => i.system.weight === "light").slice(-1) : [];
      const drop = held.filter(i => !keep.includes(i));
      if (drop.length) {
        await this.actor.updateEmbeddedDocuments("Item", drop.map(i => ({ _id: i.id, "system.location": "carried" })));
        ui.notifications?.info(`${drop.map(i => i.name).join(" and ")} put away: one Instrument in hand, or two Light ones.`);
      }
    }
    await item.update({ "system.location": next });
  }

  /**
   * Rest (PHB 6.10.0): 1d4 Stress off one Attribute per 2 hours, eating one
   * ration per 8 hours. The hours are split among Attributes in 2-hour blocks.
   * Without rations the time passes but the unfed blocks heal nothing.
   */
  static _onEditImage() {
    const FP = foundry.applications?.apps?.FilePicker?.implementation
            ?? foundry.applications?.apps?.FilePicker ?? FilePicker;
    new FP({ type: "image", current: this.actor.img, callback: path => this.actor.update({ img: path }) }).render(true);
  }

  /** One stretch of Toil (PHB 6.11.0): Strain on every Attribute, more past 8 hours and when overloaded (PHB 5.2.6). */
  static async _onToil() {
    const penalty = Number(this.actor.system.carry?.penalty ?? 0);
    const content = `<p>A stretch is about 8 hours of travel, labor, or other Toil. It costs 1 Strain on every Attribute, 2 on a failure, and 1 more for each 2 hours past 8 without a rest${penalty ? `. ${this.actor.name} is overloaded, for ${penalty} more` : ""}.</p>`
      + `<div class="form-group"><label>The stretch roll</label><select name="result"><option value="pass">Succeeded</option><option value="fail">Failed</option></select></div>`
      + `<div class="form-group"><label>Hours past 8 without a rest</label><input type="number" name="overtime" value="0" min="0" step="2" /></div>`;
    const answer = await ask(`${this.actor.name} toils a stretch`, content, "Toil");
    if (!answer) return;
    const failed = answer.result === "fail";
    const hours = Math.max(0, Number(answer.overtime) || 0);
    const t = toilStretch({ failed, overtimeHours: hours, massPenalty: penalty });
    // Strain never overflows (PHB 4.2.3): no Toil while it would take an Attribute past its Potential.
    const short = ATTRIBUTE_KEYS.filter(key => Number(this.actor.system.attributes?.[key]?.potential?.max)
      && this.actor.potentialOf(key) < t.stress);
    if (short.length) return ui.notifications?.warn(`${this.actor.name} can't Toil: ${t.stress} Strain would take ${short.map(k => ATTR_LABEL[k]).join(", ")} past its Potential. Rest first.`);
    const lines = [];
    for (const key of ATTRIBUTE_KEYS) {
      if (!Number(this.actor.system.attributes?.[key]?.potential?.max)) continue;
      const { before, after } = await this.actor.takeStress(key, t.stress);
      const max = Number(this.actor.system.attributes[key].potential.max);
      lines.push(`${ATTR_LABEL[key]} Stress ${max - before} &rarr; ${max - after} of ${max}`);
    }
    const note = `${t.stress} Strain each: ${t.base} (${failed ? "failed stretch" : "stretch"}) + ${t.overtime} (${hours} h past 8, 1 per 2 h) + ${t.extra} (Mass penalty) = ${t.stress}`;
    logEvent("toil", { actor: who(this.actor), failed, overtimeHours: hours, stress: t.stress, overtime: t.overtime, massExtra: t.extra, summary: lines });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="foil-flavor"><strong>${this.actor.name} toils a stretch</strong><br><em>${note}<br>${lines.join("<br>")}</em></div>` });
  }

  static async _onRest() {
    const attrs = this.actor.system.attributes ?? {};
    const hurt = ATTRIBUTE_KEYS.filter(k => Number(attrs[k]?.potential?.current ?? 0) < Number(attrs[k]?.potential?.max ?? 0))
      .map(k => ({ key: k, cur: Number(attrs[k].potential.current), max: Number(attrs[k].potential.max) }));
    if (!hurt.length) return ui.notifications?.info(`${this.actor.name} has nothing to recover.`);
    const rationsOn = this.actor.type === "character" ? Number(this.actor.system.rations ?? 0) : null;
    const f = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    const rows = hurt.map(a => `<tr data-key="${a.key}"><th>${ATTR_LABEL[a.key]}</th>`
      + `<td><div class="rest-stepper"><button type="button" data-step="-1">-</button><span class="rest-value"><span data-c="hours">0</span> h</span><button type="button" data-step="1">+</button></div>`
      + `<input type="hidden" name="${a.key}" value="0" /></td>`
      + `<td>${a.cur}/${a.max}</td><td data-c="avg">0</td><td data-c="max">0</td><td data-c="expected">${a.cur}/${a.max}</td><td data-c="best">${a.cur}/${a.max}</td></tr>`).join("");
    const content = `<p>Each ${REST_BLOCK_HOURS} hours of rest removes 1d4 Stress from one Attribute. One ration feeds ${REST_RATION_HOURS} hours.</p>`
      + `<table class="rest-table"><thead><tr><th></th><th>Hours</th><th>Now</th><th>Avg Stress off</th><th>Max Stress off</th><th>Expected</th><th>Best case</th></tr></thead>`
      + `<tbody>${rows}</tbody>`
      + `<tfoot><tr><th>Total</th><td data-t="hours">0 h</td><td></td><td data-t="avg">0</td><td data-t="max">0</td><td colspan="2" data-t="rations"></td></tr></tfoot></table>`;
    const refresh = el => {
      const blocks = {};
      for (const tr of el.querySelectorAll("tr[data-key]")) blocks[tr.dataset.key] = Number(tr.querySelector("input").value) / REST_BLOCK_HOURS;
      const plan = restPlan(hurt, blocks, rationsOn);
      for (const r of plan.rows) {
        const tr = el.querySelector(`tr[data-key="${r.key}"]`);
        const set = (c, v) => { tr.querySelector(`[data-c="${c}"]`).textContent = v; };
        set("hours", r.hours); set("avg", f(r.avgRec)); set("max", f(r.maxRec));
        set("expected", `${f(r.expected)}/${r.max}`); set("best", `${f(r.best)}/${r.max}`);
      }
      const t = k => el.querySelector(`[data-t="${k}"]`);
      t("hours").textContent = `${plan.hours} h`; t("avg").textContent = f(plan.avgRec); t("max").textContent = f(plan.maxRec);
      t("rations").textContent = rationsOn === null ? "No rations tracked"
        : `Rations: ${plan.used} of ${rationsOn}${plan.short ? `, ${plan.short} short (${plan.unfedHours} h heal nothing)` : ""}`;
    };
    const answer = await ask(`${this.actor.name} rests`, content, "Rest", el => {
      refresh(el);
      el.querySelectorAll("button[data-step]").forEach(btn => btn.addEventListener("click", () => {
        const input = btn.closest("tr").querySelector("input");
        input.value = Math.max(0, Number(input.value) + Number(btn.dataset.step) * REST_BLOCK_HOURS);
        refresh(el);
      }));
    }, 680);
    if (!answer) return;
    const blocks = Object.fromEntries(hurt.map(a => [a.key, Math.floor(Math.max(0, Number(answer[a.key]) || 0) / REST_BLOCK_HOURS)]));
    const plan = restPlan(hurt, blocks, rationsOn);
    if (!plan.hours) return;
    const lines = [];
    for (const r of plan.rows) {
      if (r.fed <= 0) continue;
      const roll = await new Roll(`${r.fed}d4`).evaluate();
      const { before, after } = await this.actor.heal(r.key, roll.total);
      const faces = roll.dice.flatMap(d => d.results.map(x => x.result)).join(", ");
      lines.push(`${ATTR_LABEL[r.key]}: ${r.fed} x ${REST_BLOCK_HOURS} h = ${r.fed}d4 [${faces}] = ${roll.total} off, Stress ${r.max - before} &rarr; ${r.max - after} of ${r.max}`);
    }
    if (!lines.length) lines.push("No ration to eat: the time passes, but heals nothing");
    else if (plan.unfedHours) lines.push(`${plan.unfedHours} hours unfed heal nothing`);
    if (plan.used) {
      await this.actor.update({ "system.rations": rationsOn - plan.used });
      lines.push(`${plan.hours} h / ${REST_RATION_HOURS} h per ration, rounded up = ${plan.needed}; ${plan.used} ration${plan.used === 1 ? "" : "s"} eaten (${rationsOn} &rarr; ${rationsOn - plan.used})`);
    }
    logEvent("rest", { actor: who(this.actor), hours: plan.hours, rationsUsed: plan.used, unfedHours: plan.unfedHours,
      attributes: plan.rows.filter(r => r.chosen).map(r => ({ attribute: r.key, blocks: r.chosen, fed: r.fed, from: r.cur })), summary: lines });
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="foil-flavor"><strong>${this.actor.name} rests ${plan.hours} hours</strong><br><em>${lines.join("<br>")}</em></div>` });
  }

  // ─── Embedded item CRUD ─────────────────────────────────────────────────────

  static async _onCreateItem(event, target) {
    const type = target.dataset.type;
    const label = { instrument: "Instrument", technique: "Technique", feat: "Feat", equipment: "Equipment", background: "Background", origin: "Origin" }[type] ?? "Item";
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
    const ok = D ? await D.confirm({ window: { title: "Delete" }, content: `<p>Delete <strong>${esc(item.name)}</strong>?</p>` }) : true;
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
    if (!this._termsBound) { bindTerms(this.element); this._termsBound = true; }
    annotateVars(this.element);
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

  /** A character has one Origin and one Background (PHB 2.5.0): dropping one replaces the old. */
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
      origin: this._identity("origin", i => [i.system.talentSummary, ...(i.system.feats ?? [])].filter(Boolean).join(" | ")),
      background: this._identity("background", i => [i.system.grantsSummary, i.system.knowHowSummary, i.system.coin].filter(Boolean).join(" | "))
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

/**
 * Computed Stress for a landed Technique (PHB 6.7.0; math in src/stress.js).
 * Applying it to the target stays with the table.
 */
async function computeStress(flag) {
  const pick = (flag.types ?? []).findIndex(t => !isAlwaysType(t));
  const typeOpts = [`<option value="">None</option>`, ...(flag.types ?? []).map((t, i) => isAlwaysType(t) ? "" :
    `<option value="${i}" ${i === pick ? "selected" : ""}>${esc(t.label)}</option>`)].join("");
  const answer = await ask(`${flag.name}: Stress`,
    `<p>${esc(flag.name)} rolled <strong>${flag.attackTotal}</strong>.</p>`
    + `<div class="form-group"><label>Target's Oppose total</label><input type="number" name="oppose" autofocus /></div>`
    + `<div class="form-group"><label>Attribute aimed at</label><select name="kind"><option value="physical">Might or Finesse</option><option value="mental">Wit or Presence</option></select></div>`
    + `<div class="form-group"><label>Target's Resistance of that kind</label><input type="number" name="resistance" value="0" /></div>`
    + (pick >= 0 ? `<div class="form-group"><label>Type used <em>(one for this Technique; Drawn and Fired always add)</em></label><select name="type">${typeOpts}</select></div>` : "")
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
    always: alwaysTypes(flag.types),
    bespoke: Number(flag.bespoke ?? 0), other: Number(answer.other) || 0, pierce: Number(flag.pierce ?? 0)
  });
  if (!r.landed) {
    return ChatMessage.create({ speaker, content: `<div class="foil-flavor"><strong>${esc(flag.name)} fails.</strong><br><em>The Oppose beat it (PHB 6.5.0).</em></div>` });
  }
  return ChatMessage.create({ speaker, content:
    `<div class="foil-flavor"><strong>${r.stress} Stress</strong> to the Attribute aimed at<br><em>${r.parts.map(esc).join("<br>")}</em></div>` });
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
  const cond = message.getFlag("foil", "cond");
  if (cond) flags.foil.cond = cond;
  if (stress) flags.foil.stress = { ...stress, attackTotal: total, rerolled: true };
  await ChatMessage.create({ speaker: message.speaker, flags, content:
    `<div class="foil-flavor"><strong>${esc(flag.title)}: ${total}</strong><br><em>Foil Token spent. d${die.faces} rerolled ${die.value} &rarr; ${roll.total}.</em></div>` });
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  const stress = message.getFlag("foil", "stress");
  if (stress?.targets?.length) {
    stress.targets.forEach((t, i) => addButton(html, `Oppose: ${t.name}`, "foil-oppose", () => resolveOppose(message, i)));
  } else if (stress && !stress.condition) addButton(html, `Stress: ${stress.name}`, "foil-stress-followup", () => computeStress(stress));
  const reroll = message.getFlag("foil", "reroll");
  const owner = game.actors.get(reroll?.actorId);
  // Only characters hold Foil Tokens (PHB 3.2.0).
  if (reroll && owner?.isOwner && owner.type === "character") {
    addButton(html, "Foil Token: reroll a die", "foil-token-reroll", () => rerollDie(message, reroll));
  }
});

