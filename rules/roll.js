/**
 * rules/roll.js
 * Preparing a roll (PHB 4.1.0, 4.2.2, 5.3.4, 6.4.0): which Instrument and Skill carry a Technique, the formula
 * and the math behind it, the notes on the card, Strain, and the Stress payload a hit carries. Pure: each flow
 * works on a plain actor ({ id, name, system, items }) and asks the table for its choices, so the Foundry sheet and
 * the companion app run the same code. Nothing here touches the DOM, a Roll or a ChatMessage.
 *
 * Each flow is a generator (rollTechniqueSteps, ...) that yields [name, ...args] for what only the host can do; rules/flow.js
 * has the drivers. rollTechnique(...) and the others are the async form: they take an `io` with a method per name.
 *
 * io (each may be async when driven with driveAsync):
 *   warn(message)                                        a refusal the player should see
 *   pickSkill({ tech, choices })                         one Skill key from `choices`, or null to cancel
 *   pickInstrument({ tech, valid, inst, skill, skillsOf })   { instrumentId, skill } or null
 *   pickEnchantSkill({ inst })                           a Skill key, or null
 *   aim({ inst, name, text, requires })                  { targets, notes, aim, typeIndex, other } or null; { targets: [] } with no target
 *   rangeNotes({ band, min, extend })                    reach notes for the card
 *   takeStress(attr, amount)                             lower a Potential (Strain); returns { before, after }
 *   log(type, data)                                      the playtest log
 *   post({ formula, title, note, payload })              roll it; payload says which buttons the card carries
 * fmt: { esc, br, arrow }  how text is written: Foundry passes HTML escaping, "<br>" and "&rarr;".
 */

import {
  ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_ATTRS, SKILL_LABEL, MARGIN_CAP, marginCap, CONDITION_OPPOSE, EFFECT_CONDITION, conditionAttr
} from "./constants.js";
import { conditionFlags, skillFormula, skillMath } from "./combat.js";
import { familiesOf } from "./resist.js";
import { driveAsync } from "./flow.js";

export const PLAIN = { esc: s => String(s ?? ""), br: "\n", arrow: "→" };

const items = actor => [...(actor.items ?? [])];
const itemById = (actor, id) => items(actor).find(i => i.id === id);

/** "Deals Stress to Might or Finesse, +1." -> 1 (a built-in Technique's bespoke bonus). */
export function bespokeBonus(effect) {
  const m = String(effect ?? "").match(/Deals Stress[^.]*?,\s*\+(\d+)/i);
  return m ? Number(m[1]) : 0;
}

/** An Instrument's own roll bonuses as named sources: its +N and an Enchantment on this Skill. */
export function instrumentExtras(inst, skill) {
  if (!inst) return [];
  const out = [];
  const own = Number(inst.system.bonusRoll ?? 0) - Number(inst.system.enchantRoll ?? 0);
  if (own) out.push({ label: inst.name, value: own });   // the value carries the +N, so the name stands alone
  if (inst.system.enchantRoll) out.push({ label: `${inst.name} Enchantment`, value: Number(inst.system.enchantRoll) });
  if (inst.system.enchantSkill?.skill === skill && inst.system.enchantSkill.n) out.push({ label: `${inst.name} Enchantment`, value: Number(inst.system.enchantSkill.n) });
  return out;
}

/** What a roll's card says about the roller's Incapacitated Attributes and Conditions. */
export function rollNotes(sys, skill, technique = false) {
  const notes = [];
  const dropped = SKILL_ATTRS[skill].filter(ak => sys.attributes?.[ak]?.down).map(ak => ATTR_LABEL[ak]);
  if (dropped.length) notes.push(`${dropped.join(" and ")} Incapacitated: no dice from it.`);
  notes.push(...conditionFlags(sys.conditions, { skill, technique }));
  return notes;
}

/** What a hit through this Instrument counts as for narrow Resistance (GMG 9.5.1). */
export function attackInfo(inst) {
  const types = inst.system.types ?? [];
  return { types, families: familiesOf(types), materials: inst.system.materials ?? "" };
}

/** The Skills an Instrument (or a shield) rolls: the ones its Primary Attribute reaches (PHB 4.1.0). */
export const skillsOf = i => i.type === "instrument" ? i.system.primarySkills : ["prowess", "discipline", "assertiveness"];

/** A stored Instrument works where it is stored (user, 2026-10-25). */
const storedNote = (inst, esc) => `${esc(inst.name)} is stored${inst.system.storedAt ? ` at ${esc(inst.system.storedAt)}` : ""}: using it means being there.`;

/** Instruments able to deliver a Technique: any one of its required Types; equipped ones first, stored ones last. */
export function validInstruments(actor, tech) {
  const req = tech.system.requires ?? [];
  const ready = i => (i.system.innate || i.system.location === "equipped") ? 0 : i.system.location === "stored" ? 2 : 1;
  return items(actor).filter(i => {
    if (i.type === "instrument") return req.length === 0 || req.some(k => i.system.types?.includes(k));
    if (i.type === "equipment" && i.system.category === "shield") return req.includes("blocking");
    return false;
  }).sort((a, b) => ready(a) - ready(b));
}

/**
 * The payload the Stress button on a card reads. The margin cap follows the Instrument's weight (PHB 6.7.0).
 * The caller adds what only it knows (the roll's total).
 */
export function stressPayload(actor, inst, name, total, { bespoke = [], pierce = [], aim = { targets: [] } } = {}) {
  const primary = inst.system.primaryAttribute;
  const a = actor.system.attributes?.[primary];
  const potential = Number(a?.potential?.max ?? 0);
  const weight = inst.system.weight || inst.system.weightClass || "light";
  const label = key => `${MARGIN_CAP[key][2]} ${ATTR_LABEL[primary] ?? ""} Potential`;
  return {
    stress: {
      actorId: actor.id, name, attackTotal: total, instrument: inst.name,
      cap: marginCap(potential, weight), capLabel: label(weight),
      mult: Number(inst.system.marginMultiplier ?? 1), multLabel: inst.system.weightLabel || weight,
      types: inst.system.stressTypes ?? [],
      bespoke: bespoke.reduce((n, p) => n + p.value, 0), bespokeParts: bespoke.filter(p => p.value),
      pierce: pierce.reduce((n, p) => n + p.value, 0), pierceParts: pierce.filter(p => p.value), attackInfo: attackInfo(inst),
      melee: !!inst.system.isMelee, targets: aim.targets, aim: aim.aim, typeIndex: aim.typeIndex, other: aim.other
    }
  };
}

const enchantPierceParts = inst => [
  { label: `${inst.name} +${inst.system.bonus}`, value: Number(inst.system.bonusPierce ?? 0) - Number(inst.system.enchantPierce ?? 0) },
  { label: `${inst.name} Enchantment`, value: Number(inst.system.enchantPierce ?? 0) }
];

/** Roll a Skill on its own. */
export function* rollSkillSteps({ actor, skill, fmt = PLAIN }) {
  const sys = actor.system;
  (yield ["post", {
    formula: skillFormula(sys, skill, 0, ""), title: `${SKILL_LABEL[skill]}`,
    note: [fmt.esc(skillMath(sys, skill, 0, "")), ...rollNotes(sys, skill)].join(fmt.br), payload: null
  }]);
}

/** Roll one of an Instrument's three built-in Techniques (PHB 7.4.0). */
export function* rollKitSteps({ actor, inst, index, fmt = PLAIN }) {
  const { esc, br } = fmt;
  const sys = actor.system;
  const kit = inst?.system.kit?.[Number(index)];
  if (!inst || !kit) return;
  const notes = rollNotes(sys, kit.skill, true);
  notes.unshift(`${esc(inst.name)}: ${esc(kit.effect)}`);
  if (inst.system.location === "stored") notes.push(storedNote(inst, esc));
  else if (!inst.system.innate && inst.system.location !== "equipped") notes.push(`${esc(inst.name)} isn't equipped: switching to it costs the Quick Action (PHB 4.1.0).`);
  if (inst.system.quick) notes.push("Light: after an Action through a Light Instrument, the Quick Action can pay for this (PHB 4.2.2).");
  if (inst.system.doublesMargin) notes.push("Heavy: costs the Action and the Quick Action; the margin doubles (PHB 4.1.1).");
  if (inst.system.reload) notes.push(`Reload: ${inst.system.reload === "quick" ? "Quick Action" : "Action"}.`);
  const stress = /Deals Stress/i.test(kit.effect);
  // "Applies Reeling.", or "Applies Weakened [Finesse]." naming the Attribute it weakens and is resisted with (PHB 6.8.4).
  const match = !stress ? kit.effect.match(/^Applies (Foil Exposed|\w+)(?: \[(\w+)\])?/i) : null;
  const applied = match?.[1];
  const named = ATTRIBUTE_KEYS.find(k => ATTR_LABEL[k].toLowerCase() === String(match?.[2] ?? "").toLowerCase()) ?? "";
  const kitCond = applied === "Weakened" ? { name: applied, note: named ? ATTR_LABEL[named] : "", attr: named } : applied ? { name: applied, note: "" } : null;
  const kitResist = kitCond ? conditionAttr(kitCond) : "";
  if (kitResist) notes.push(`The target resists with any ${ATTR_LABEL[kitResist]} Skill (PHB 6.8.0).`);
  const targeted = stress || /^Applies\b/i.test(kit.effect);
  if (targeted && inst.system.weightDice) notes.push(`${inst.system.weightLabel}: +${inst.system.weightDice}.`);
  notes.push(...(yield ["rangeNotes", { band: inst.system.rangeBand, min: inst.system.minRange }]));
  const aim = stress ? (yield ["aim", { inst, name: kit.name, text: kit.effect, requires: [] }]) : { targets: [] };
  if (!aim) return;
  notes.push(...(aim.notes ?? []));
  const kitExtras = instrumentExtras(inst, kit.skill);
  const kitDice = targeted && inst.system.weightDice ? [{ label: inst.system.weightLabel || "Weight", dice: inst.system.weightDice }] : [];
  notes.unshift(esc(skillMath(sys, kit.skill, kitExtras, kitDice)));
  (yield ["post", {
    formula: skillFormula(sys, kit.skill, kitExtras, kitDice), title: `${kit.name} (${SKILL_LABEL[kit.skill]})`, note: notes.join(br),
    payload: {
      cond: true,
      condition: kitResist ? { name: kit.name, condition: kitCond, melee: !!inst.system.isMelee } : null,
      stress: stress ? { inst, name: kit.name, aim,
        bespoke: [{ label: kit.name, value: bespokeBonus(kit.effect) }, { label: `${inst.name} Enchantment`, value: Number(inst.system.enchantStress ?? 0) }],
        pierce: enchantPierceParts(inst) } : null
    }
  }]);
}

/** Roll a Technique: choose its Skill and Instrument, take its Strain, and post the roll. */
export function* rollTechniqueSteps({ actor, tech, fmt = PLAIN }) {
  const { esc, br, arrow } = fmt;
  const sys = tech.system;
  const asys = actor.system;

  let inst = null, skill = sys.skill || "";
  if (!skill && sys.skillChoices?.length) {
    const pick = (yield ["pickSkill", { tech, choices: sys.skillChoices }]);
    if (!pick) return;
    skill = sys.skillChoices.includes(pick) ? pick : sys.skillChoices[0];
  }
  if (!sys.innate) {
    let valid = validInstruments(actor, tech);
    if (!valid.length) {
      (yield ["warn", `No Instrument carries what ${tech.name} requires (${sys.requiresLabel}).`]);
      return;
    }
    if (skill) {
      const fit = valid.filter(i => skillsOf(i).includes(skill));
      if (!fit.length) {
        (yield ["warn", `${tech.name} rolls ${SKILL_LABEL[skill]}, which ${valid.map(i => i.name).join(", ")} can't (PHB 4.1.0).`]);
        return;
      }
      valid = fit;
    }
    inst = valid[0];
    if (valid.length > 1 || !skill) {
      const answer = (yield ["pickInstrument", { tech, valid, inst, skill, skillsOf }]);
      if (!answer) return;
      inst = itemById(actor, answer.instrumentId) ?? inst;
      skill = skill || answer.skill;
      const allowed = skillsOf(inst);
      if (!allowed.includes(skill)) {
        (yield ["warn", `${inst.name} rolls ${allowed.map(k => SKILL_LABEL[k]).join(", ")}, not ${SKILL_LABEL[skill]} (PHB 4.1.0).`]);
        return;
      }
    }
  }
  skill ||= "prowess";

  const bonus = [{ label: tech.name, value: Number(sys.rollBonus ?? 0) }, ...instrumentExtras(inst, skill)];
  const notes = rollNotes(asys, skill, true);
  notes.unshift(`${inst ? `Through ${esc(inst.name)}` : "Innate"}. ${esc(sys.effectSummary)}`);
  if (inst?.system.location === "stored") notes.push(storedNote(inst, esc));
  if (inst?.system.enchantBonus) notes.push(`Enchantment: ${inst.system.enchantBonus.label}.`);
  if (sys.quick) notes.push("Quick: may be paid with the Quick Action.");
  if (inst?.system.doublesMargin) notes.push("Heavy: costs the Action and the Quick Action; the margin doubles (PHB 4.1.1).");

  const extend = (sys.effects ?? []).filter(e => e.key === "extend-range").reduce((n, e) => n + Number(e.bands || 1), 0);
  notes.push(...(yield ["rangeNotes", { band: inst ? inst.system.rangeBand : sys.range, min: sys.minRange || inst?.system.minRange, extend }]));
  // The Condition it applies, if it deals no Stress. Weakened -N [target Attribute] is aimed like Stress: the Attribute
  // aimed at is the one weakened, and the one the target resists with (PHB 6.8.4).
  const applied = !sys.dealsStress ? (sys.effects ?? []).find(e => CONDITION_OPPOSE[EFFECT_CONDITION[e.key]] || EFFECT_CONDITION[e.key] === "Weakened") : null;
  const weakens = EFFECT_CONDITION[applied?.key] === "Weakened";
  const aim = (sys.dealsStress || weakens) && inst ? (yield ["aim", { inst, name: tech.name, text: "", requires: sys.requires ?? [] }]) : { targets: [] };
  if (!aim) return;
  notes.push(...(aim.notes ?? []));

  // Strain lands on the Instrument's Primary Attribute, ignoring Resistance (PHB 4.2.3).
  if (sys.strain > 0) {
    const attr = inst?.system.primaryAttribute ?? SKILL_ATTRS[skill][0];
    const { before, after } = (yield ["takeStress", attr, sys.strain]);
    (yield ["log", "strain", { source: tech.name, attribute: attr, amount: sys.strain, before, after }]);
    const xp = Number(sys.xpCost ?? 0) - (sys.perTarget ? 8 : 0);
    const max = Number(asys.attributes?.[attr]?.potential?.max ?? 0);
    notes.push(`Strain ${sys.strain} on ${ATTR_LABEL[attr]} (Stress ${max - before} ${arrow} ${max - after} of ${max}): (${xp} XP${sys.perTarget ? " before the Selective premium" : ""} - 24) / 8, rounded down (PHB 4.2.3).`);
  }

  const wdice = sys.offensive && inst?.type === "instrument" && inst.system.weightDice ? [{ label: inst.system.weightLabel || "Weight", dice: inst.system.weightDice }] : [];
  notes.unshift(esc(skillMath(asys, skill, bonus, wdice)));
  const rounds = applied ? applied.duration || (applied.key.endsWith("-minute") ? "1 minute" : "") : "";
  const condition = !applied ? null
    : weakens ? { name: "Weakened", note: `${aim.aim ? `${ATTR_LABEL[aim.aim]} ` : ""}${applied.magnitude ?? 1}`, rounds, attr: aim.aim ?? "" }
    : { name: EFFECT_CONDITION[applied.key], note: applied.key.startsWith("reeling") ? `${applied.magnitude ?? 1}` : "", rounds };
  const resistAttr = condition ? conditionAttr(condition) : "";
  if (resistAttr) notes.push(`The target resists with any ${ATTR_LABEL[resistAttr]} Skill (PHB 6.8.0).`);
  else if (condition) notes.push("The target resists with any Skill built on the Attribute aimed at (PHB 6.8.4).");
  (yield ["post", {
    formula: skillFormula(asys, skill, bonus, wdice), title: `${esc(tech.name)} (${SKILL_LABEL[skill]})`, note: notes.join(br),
    payload: {
      cond: true,
      condition: condition ? { name: tech.name, condition, melee: !!inst?.system.isMelee } : null,
      stress: sys.dealsStress && inst ? { inst, name: tech.name, aim,
        bespoke: [{ label: tech.name, value: Number(sys.stressRider ?? 0) }, { label: `${inst.name} Enchantment`, value: Number(inst.system.enchantStress ?? 0) }],
        pierce: [{ label: tech.name, value: Number(sys.pierceTotal ?? 0) }, ...enchantPierceParts(inst)] } : null
    }
  }]);
}

/** Use an Instrument's bound Enchantment (PHB 5.3.4): no Technique known, Strain still applies. */
export function* rollEnchantmentSteps({ actor, inst, fmt = PLAIN }) {
  const { esc, br, arrow } = fmt;
  const ench = inst?.system?.enchantment;
  if (!inst || !ench?.enabled) return;
  const skill = (yield ["pickEnchantSkill", { inst }]);
  if (!skill) return;
  const notes = rollNotes(actor.system, skill, true);
  notes.unshift(`Enchantment: ${esc(ench.effectSummary)}`);
  if (ench.strain > 0) {
    const { before, after } = (yield ["takeStress", inst.system.primaryAttribute, ench.strain]);
    (yield ["log", "strain", { source: `${inst.name} (Enchantment)`, attribute: inst.system.primaryAttribute, amount: ench.strain, before, after }]);
    const max = Number(actor.system.attributes?.[inst.system.primaryAttribute]?.potential?.max ?? 0);
    notes.push(`Strain ${ench.strain} on ${ATTR_LABEL[inst.system.primaryAttribute]} (Stress ${max - before} ${arrow} ${max - after} of ${max}).`);
  }
  const enchExtras = instrumentExtras(inst, skill);
  notes.unshift(esc(skillMath(actor.system, skill, enchExtras)));
  (yield ["post", { formula: skillFormula(actor.system, skill, enchExtras), title: `${esc(inst.name)} (${SKILL_LABEL[skill]})`, note: notes.join(br), payload: { cond: true, condition: null, stress: null } }]);
}

// The same flows for a host that can wait: Foundry, with dialogs. A reducer drives the *Steps generators with driveSync.
export const rollSkill = ({ io, ...a }) => driveAsync(rollSkillSteps(a), io);
export const rollKit = ({ io, ...a }) => driveAsync(rollKitSteps(a), io);
export const rollTechnique = ({ io, ...a }) => driveAsync(rollTechniqueSteps(a), io);
export const rollEnchantment = ({ io, ...a }) => driveAsync(rollEnchantmentSteps(a), io);
