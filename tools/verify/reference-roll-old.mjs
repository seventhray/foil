/**
 * tools/verify/reference-roll-old.mjs
 * The rolling methods of src/actor/actor-sheet.js exactly as they were before they moved to rules/roll.js
 * (copied verbatim, lines 211 to 535 of the sheet at commit 5041093), with fakes for the Foundry pieces
 * they touch. capture-roll-vectors.mjs runs it to record what the old code did; do not edit the methods.
 * One deliberate rule change is carried into this copy, marked RULE 2026-10-23: Weakened is resisted with the
 * Attribute it names (PHB 6.8.4), so it carries that Attribute and its target Opposes it (conditionAttr).
 */
import {
  ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_ATTRS, SKILL_LABEL, MARGIN_CAP, marginCap, CONDITION_OPPOSE, CONDITION_ATTR, EFFECT_CONDITION, conditionAttr
} from "../../rules/constants.js";
import { isAlwaysType } from "../../rules/stress.js";
import { allowedAims, conditionFlags, skillFormula, skillMath, targetFlags } from "../../rules/combat.js";
import { familiesOf } from "../../rules/resist.js";
import { reachBand, reachLine, rangeWarning } from "../../rules/range.js";

/** What the fakes record and what the next dialogs answer. Reset it between cases. */
export const env = { answers: [], targets: [], events: [], posted: [], warnings: [], asked: [] };
export const reset = (answers = [], targets = []) => { env.answers = [...answers]; env.targets = targets; env.events = []; env.posted = []; env.warnings = []; env.asked = []; };

const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ask = async (title, content, label) => { env.asked.push(title); return env.answers.length ? env.answers.shift() : null; };
const logEvent = (type, data) => env.events.push({ type, data });
const who = a => ({ id: a?.id, name: a?.name });
const game = { get user() { return { targets: env.targets }; } };
const ui = { notifications: { warn: m => env.warnings.push(m) } };
const ChatMessage = { getSpeaker: () => ({}) };
class Roll {
  constructor(formula) { this.formula = formula; this.total = 17; this.dice = []; }
  async evaluate() { return this; }
  async toMessage({ flavor, flags }) { env.posted.push({ formula: this.formula, flavor, flags }); return {}; }
}
function bespokeBonus(effect) {
  const m = String(effect ?? "").match(/Deals Stress[^.]*?,\s*\+(\d+)/i);
  return m ? Number(m[1]) : 0;
}

export class RefSheet {
  constructor(actor) { this.actor = actor; }


  /** A Skill formula with the carrying penalty and Conditions folded in, plus any weight dice. */
  _skillFormula(skill, extra = 0, dice = "") {
    return skillFormula(this.actor.system, skill, extra, dice);
  }

  /** The roll's math, every source named (shown on every roll card). */
  _math(skill, extra = 0, dice = "") {
    return esc(skillMath(this.actor.system, skill, extra, dice));
  }

  /** An Instrument's own roll bonuses as named sources: its +N and an Enchantment on this Skill. */
  _instrumentExtras(inst, skill) {
    if (!inst) return [];
    const out = [];
    const own = Number(inst.system.bonusRoll ?? 0) - Number(inst.system.enchantRoll ?? 0);
    if (own) out.push({ label: inst.name, value: own });
    if (inst.system.enchantRoll) out.push({ label: `${inst.name} Enchantment`, value: Number(inst.system.enchantRoll) });
    if (inst.system.enchantSkill?.skill === skill && inst.system.enchantSkill.n) out.push({ label: `${inst.name} Enchantment`, value: Number(inst.system.enchantSkill.n) });
    return out;
  }

  _rollNotes(skill, technique = false) {
    const sys = this.actor.system;
    const notes = [];
    const dropped = SKILL_ATTRS[skill].filter(ak => sys.attributes?.[ak]?.down).map(ak => ATTR_LABEL[ak]);
    if (dropped.length) notes.push(`${dropped.join(" and ")} Incapacitated: no dice from it.`);
    notes.push(...conditionFlags(sys.conditions, { skill, technique }));
    return notes;
  }

  static async _onRollSkill(event, target) {
    const key = target.dataset.key;
    await this._postRoll(this._skillFormula(key), `${SKILL_LABEL[key]}`, [this._math(key), ...this._rollNotes(key)].join("<br>"));
  }

  /** Roll one of an Instrument's three built-in Techniques (PHB 7.4.0). */
  static async _onRollKit(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const inst = this.actor.items.get(id);
    const kit = inst?.system.kit?.[Number(target.dataset.index)];
    if (!inst || !kit) return;
    const notes = this._rollNotes(kit.skill, true);
    notes.unshift(`${esc(inst.name)}: ${esc(kit.effect)}`);
    if (!inst.system.innate && inst.system.location !== "equipped") notes.push(`${esc(inst.name)} isn't equipped: switching to it costs the Quick Action (PHB 4.1.0).`);
    if (inst.system.quick) notes.push("Light: after an Action through a Light Instrument, the Quick Action can pay for this (PHB 4.2.2).");
    if (inst.system.doublesMargin) notes.push("Heavy: costs the Action and the Quick Action; the margin doubles (PHB 4.1.1).");
    if (inst.system.reload) notes.push(`Reload: ${inst.system.reload === "quick" ? "Quick Action" : "Action"}.`);
    const stress = /Deals Stress/i.test(kit.effect);
    // RULE 2026-10-23: Weakened [Attribute] is resisted with that Attribute.
    const match = !stress ? kit.effect.match(/^Applies (Foil Exposed|\w+)(?: \[(\w+)\])?/i) : null;
    const applied = match?.[1];
    const named = ATTRIBUTE_KEYS.find(k => ATTR_LABEL[k].toLowerCase() === String(match?.[2] ?? "").toLowerCase()) ?? "";
    const kitCond = applied === "Weakened" ? { name: applied, note: named ? ATTR_LABEL[named] : "", attr: named } : applied ? { name: applied, note: "" } : null;
    const kitResist = kitCond ? conditionAttr(kitCond) : "";
    if (kitResist) notes.push(`The target resists with any ${ATTR_LABEL[kitResist]} Skill (PHB 6.8.0).`);
    const targeted = stress || /^Applies\b/i.test(kit.effect);
    if (targeted && inst.system.weightDice) notes.push(`${inst.system.weightLabel}: +${inst.system.weightDice}.`);
    notes.push(...this._rangeNotes({ band: inst.system.rangeBand, min: inst.system.minRange }));
    const aim = stress ? await this._aimAtTargets(inst, kit.name, kit.effect) : { targets: [] };
    if (!aim) return;
    notes.push(...(aim.notes ?? []));
    const kitExtras = this._instrumentExtras(inst, kit.skill);
    const kitDice = targeted && inst.system.weightDice ? [{ label: inst.system.weightLabel || "Weight", dice: inst.system.weightDice }] : [];
    notes.unshift(this._math(kit.skill, kitExtras, kitDice));
    await this._postRoll(this._skillFormula(kit.skill, kitExtras, kitDice), `${kit.name} (${SKILL_LABEL[kit.skill]})`,
      notes.join("<br>"), roll => ({
        cond: this._condFlag(),
        ...(kitResist ? this._conditionFlag(kit.name, roll.total, kitCond, { melee: !!inst.system.isMelee }) : {}),
        ...(stress ? this._stressFlag(inst, kit.name, roll.total, { aim,
          bespoke: [{ label: kit.name, value: bespokeBonus(kit.effect) }, { label: `${inst.name} Enchantment`, value: Number(inst.system.enchantStress ?? 0) }],
          pierce: [{ label: `${inst.name} +${inst.system.bonus}`, value: Number(inst.system.bonusPierce ?? 0) - Number(inst.system.enchantPierce ?? 0) }, { label: `${inst.name} Enchantment`, value: Number(inst.system.enchantPierce ?? 0) }] }) : {})
      }));
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

  /** Instruments able to deliver a Technique: any one of its required Types; equipped ones first. */
  _validInstruments(tech) {
    const req = tech.system.requires ?? [];
    const ready = i => (i.system.innate || i.system.location === "equipped") ? 0 : 1;
    return this.actor.items.filter(i => {
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
    if (!skill && sys.skillChoices?.length) {
      const opts = sys.skillChoices.map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
      const pick = await ask(`Use ${esc(tech.name)}`, `<div class="form-group"><label>Skill</label><select name="skill">${opts}</select></div>`, "Roll");
      if (!pick) return;
      skill = sys.skillChoices.includes(pick.skill) ? pick.skill : sys.skillChoices[0];
    }
    if (!sys.innate) {
      let valid = this._validInstruments(tech);
      if (!valid.length) {
        ui.notifications?.warn(`No Instrument carries what ${tech.name} requires (${sys.requiresLabel}).`);
        return;
      }
      // The Skills an Instrument rolls are the ones its Primary Attribute reaches (PHB 4.1.0).
      const skillsOf = i => i.type === "instrument" ? i.system.primarySkills : ["prowess", "discipline", "assertiveness"];
      if (skill) {
        const fit = valid.filter(i => skillsOf(i).includes(skill));
        if (!fit.length) {
          ui.notifications?.warn(`${tech.name} rolls ${SKILL_LABEL[skill]}, which ${valid.map(i => i.name).join(", ")} can't (PHB 4.1.0).`);
          return;
        }
        valid = fit;
      }
      inst = valid[0];
      if (valid.length > 1 || !skill) {
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

    const bonus = [{ label: tech.name, value: Number(sys.rollBonus ?? 0) }, ...this._instrumentExtras(inst, skill)];
    const notes = this._rollNotes(skill, true);
    notes.unshift(`${inst ? `Through ${esc(inst.name)}` : "Innate"}. ${esc(sys.effectSummary)}`);
    if (inst?.system.enchantBonus) notes.push(`Enchantment: ${inst.system.enchantBonus.label}${inst.system.enchantBonus.applies ? "" : " (apply at the table)"}.`);
    if (sys.quick) notes.push("Quick: may be paid with the Quick Action.");
    if (inst?.system.doublesMargin) notes.push("Heavy: costs the Action and the Quick Action; the margin doubles (PHB 4.1.1).");

    const extend = (sys.effects ?? []).filter(e => e.key === "extend-range").reduce((n, e) => n + Number(e.bands || 1), 0);
    notes.push(...this._rangeNotes({ band: inst ? inst.system.rangeBand : sys.range, min: sys.minRange || inst?.system.minRange, extend }));
    // RULE 2026-10-23: a Technique that only weakens is aimed; the Attribute aimed at is weakened and resists.
    const applied = !sys.dealsStress ? (sys.effects ?? []).find(e => CONDITION_OPPOSE[EFFECT_CONDITION[e.key]] || EFFECT_CONDITION[e.key] === "Weakened") : null;
    const weakens = EFFECT_CONDITION[applied?.key] === "Weakened";
    const aim = (sys.dealsStress || weakens) && inst ? await this._aimAtTargets(inst, tech.name, "", sys.requires ?? []) : { targets: [] };
    if (!aim) return;
    notes.push(...(aim.notes ?? []));

    // Strain lands on the Instrument's Primary Attribute, ignoring Resistance (PHB 4.2.3).
    if (sys.strain > 0) {
      const attr = inst?.system.primaryAttribute ?? SKILL_ATTRS[skill][0];
      const { before, after } = await this.actor.takeStress(attr, sys.strain);
      logEvent("strain", { actor: who(this.actor), source: tech.name, attribute: attr, amount: sys.strain, before, after });
      const xp = Number(sys.xpCost ?? 0) - (sys.perTarget ? 8 : 0);
      const max = Number(this.actor.system.attributes?.[attr]?.potential?.max ?? 0);
      notes.push(`Strain ${sys.strain} on ${ATTR_LABEL[attr]} (Stress ${max - before} &rarr; ${max - after} of ${max}): (${xp} XP${sys.perTarget ? " before the Selective premium" : ""} - 24) / 8, rounded down (PHB 4.2.3).`);
    }

    const gem = inst?.system.gemActive ? inst.system.gem : null;
    const gemPierce = gem?.type === "emerald" && sys.pierceTotal ? Number(gem.tier) : 0;
    if (gem && gem.type !== "emerald") notes.push(`Focus Gem: ${esc(inst.system.gemSummary)} (1 per Tier x Tier ${gem.tier}; apply at the table, PHB 5.2.3).`);
    else if (gem && !gemPierce) notes.push(`Focus Gem: ${esc(inst.system.gemSummary)} (adds nothing: this Technique has no Pierce).`);
    const wdice = sys.offensive && inst?.type === "instrument" && inst.system.weightDice ? [{ label: inst.system.weightLabel || "Weight", dice: inst.system.weightDice }] : [];
    notes.unshift(this._math(skill, bonus, wdice));
    const rounds = applied ? applied.duration || (applied.key.endsWith("-minute") ? "1 minute" : "") : "";
    const condition = !applied ? null
      : weakens ? { name: "Weakened", note: `${aim.aim ? `${ATTR_LABEL[aim.aim]} ` : ""}${applied.magnitude ?? 1}`, rounds, attr: aim.aim ?? "" }
      : { name: EFFECT_CONDITION[applied.key], note: applied.key.startsWith("reeling") ? `${applied.magnitude ?? 1}` : "", rounds };
    const resistAttr = condition ? conditionAttr(condition) : "";
    if (resistAttr) notes.push(`The target resists with any ${ATTR_LABEL[resistAttr]} Skill (PHB 6.8.0).`);
    else if (condition) notes.push("The target resists with any Skill built on the Attribute aimed at (PHB 6.8.4).");
    await this._postRoll(this._skillFormula(skill, bonus, wdice), `${esc(tech.name)} (${SKILL_LABEL[skill]})`, notes.join("<br>"), roll => ({
      cond: this._condFlag(),
      ...(condition ? this._conditionFlag(tech.name, roll.total, condition, { melee: !!inst?.system.isMelee }) : {}),
      ...(sys.dealsStress && inst ? this._stressFlag(inst, tech.name, roll.total, {
        bespoke: [{ label: tech.name, value: Number(sys.stressRider ?? 0) }, { label: `${inst.name} Enchantment`, value: Number(inst.system.enchantStress ?? 0) }],
        pierce: [{ label: tech.name, value: Number(sys.pierceTotal ?? 0) }, { label: `${inst.name} +${inst.system.bonus}`, value: Number(inst.system.bonusPierce ?? 0) - Number(inst.system.enchantPierce ?? 0) }, { label: `${inst.name} Enchantment`, value: Number(inst.system.enchantPierce ?? 0) }, { label: "Emerald", value: gemPierce }], aim
      }) : {})
    }));
  }

  /** Use an Instrument's bound Enchantment (PHB 5.3.4): no Technique known, Strain still applies. */
  static async _onRollEnchantment(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const inst = this.actor.items.get(id);
    const ench = inst?.system?.enchantment;
    if (!inst || !ench?.enabled) return;
    const opts = inst.system.primarySkills.map(k => `<option value="${k}">${SKILL_LABEL[k]}</option>`).join("");
    const answer = await ask(`Use ${esc(inst.name)}`, `<div class="form-group"><label>Skill</label><select name="skill">${opts}</select></div>`, "Roll");
    if (!answer) return;
    const notes = this._rollNotes(answer.skill, true);
    notes.unshift(`Enchantment: ${esc(ench.effectSummary)}`);
    if (ench.strain > 0) {
      const { before, after } = await this.actor.takeStress(inst.system.primaryAttribute, ench.strain);
      logEvent("strain", { actor: who(this.actor), source: `${inst.name} (Enchantment)`, attribute: inst.system.primaryAttribute, amount: ench.strain, before, after });
      const max = Number(this.actor.system.attributes?.[inst.system.primaryAttribute]?.potential?.max ?? 0);
      notes.push(`Strain ${ench.strain} on ${ATTR_LABEL[inst.system.primaryAttribute]} (Stress ${max - before} &rarr; ${max - after} of ${max}).`);
    }
    const enchExtras = this._instrumentExtras(inst, answer.skill);
    notes.unshift(this._math(answer.skill, enchExtras));
    await this._postRoll(this._skillFormula(answer.skill, enchExtras), `${esc(inst.name)} (${SKILL_LABEL[answer.skill]})`, notes.join("<br>"), () => ({ cond: this._condFlag() }));
  }

  /**
   * The chat-card payload the Stress button reads. The margin cap follows the
   * Instrument's weight (PHB 6.7.0).
   */
  /** What a hit through this Instrument counts as for narrow Resistance (GMG 9.5.1). */
  _attackInfo(inst) {
    const types = inst.system.types ?? [];
    return { types, families: familiesOf(types), materials: inst.system.materials ?? "" };
  }

  _stressFlag(inst, name, total, { bespoke = [], pierce = [], aim = { targets: [] } } = {}) {
    const primary = inst.system.primaryAttribute;
    const a = this.actor.system.attributes?.[primary];
    const potential = Number(a?.potential?.max ?? 0);
    const weight = inst.system.weight || inst.system.weightClass || "light";
    const label = key => `${MARGIN_CAP[key][2]} ${ATTR_LABEL[primary] ?? ""} Potential`;
    return {
      stress: {
        actorId: this.actor.id, name, attackTotal: total, instrument: inst.name,
        cap: marginCap(potential, weight), capLabel: label(weight),
        mult: Number(inst.system.marginMultiplier ?? 1), multLabel: inst.system.weightLabel || weight,
        types: inst.system.stressTypes ?? [],
        bespoke: bespoke.reduce((n, p) => n + p.value, 0), bespokeParts: bespoke.filter(p => p.value),
        pierce: pierce.reduce((n, p) => n + p.value, 0), pierceParts: pierce.filter(p => p.value), attackInfo: this._attackInfo(inst),
        melee: !!inst.system.isMelee, targets: aim.targets, aim: aim.aim, typeIndex: aim.typeIndex, other: aim.other
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

}
