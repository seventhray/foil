/**
 * rules/oppose.js
 * A target answering a Technique (PHB 6.5.0, 6.7.0, 3.2.0): the attack total against the target's Conditions, the
 * Oppose roll and its modifiers, a Foil Token reroll, then a Condition applied or Stress worked out and laid on.
 * Pure: it works on plain actors ({ id, name, type, system, items }) and a card payload (`flag`), and asks the
 * table for its choices and effects, so the Foundry card flow and the companion app run the same code.
 *
 * The flow is a generator (resolveOpposeSteps) that yields [name, ...args]; rules/flow.js has the drivers. resolveOppose(...)
 * is the async form and takes an `io` with a method per name.
 *
 * io (each may be async when driven with driveAsync):
 *   askOppose(data)                          the Oppose dialog; returns its answers { skill, other, parry, exposed0.. } or null. data.guarded
 *                                            names a Guarded mark that adds +2 by itself; data.canParry says whether a Parry may be asked.
 *   updateConditions(list)                   replace the target's Conditions
 *   rollOppose({ formula, math, skill, flags })   roll it and show it; returns { total, formula, dice: [{ faces, value }] }
 *   askReroll({ title, total, dice, tokens })      { die } or null: the die index to reroll with a Foil Token
 *   rollDie(faces)                           one die
 *   setFoilTokens(n)
 *   card(kind, data)                         a chat card: fail, lands, noHabit, alreadyExposed, conditionApplied, stress, stressApplied, reroll
 *   askCondition(data)                       the Condition dialog; returns its answers or null
 *   askApplyStress(data)                     the Apply Stress dialog; returns { amount, halve } or null
 *   askOverflow({ attr, left, room, potentialOf })   { attr } or null
 *   askDisarm({ defenderName, instruments })  { itemId }: which Instrument a Disarmed defender used last, when several could drop
 *   dropInstrument(itemId)                   a Disarm drops it: it becomes carried, and readying it costs the Quick Action (PHB 4.2.1)
 *   takeStress(attr, amount)                 lower a Potential; returns { before, after }
 *   log(type, data)                          the playtest log; data.attacker and data.defender are actors
 * fmt: { br, arrow }  how text is written; PLAIN by default.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_LABEL, PRIMARY_SKILLS, CONDITION_PRESETS, FOIL_AXES, conditionAttr } from "./constants.js";
import { stressFor, alwaysTypes, landStress } from "./stress.js";
import { conditionFlags, conditionMods, harmFlags, harmNames, incomingMods, kindOf, skillFormula, skillMath, targetFlags } from "./combat.js";
import { scopedResistance } from "./resist.js";
import { driveAsync } from "./flow.js";
import { isReady } from "./roll.js";

export const PLAIN = { esc: s => String(s ?? ""), br: "\n", arrow: "→" };

const habitOf = note => String(note).replace(/;? by .*$/, "");
const clone = o => JSON.parse(JSON.stringify(o));
const potentialOf = (actor, k) => Number(actor.system.attributes?.[k]?.potential?.current ?? 0);
const foilTokens = actor => Number(actor.system.foilTokens ?? 0);
const hasToken = actor => actor.type === "character" && foilTokens(actor) > 0;

// ---- Guard and Parry (PHB 6.5.1, 6.5.2) ----

/** The Attributes each kind of block covers (PHB 6.5.1). */
export const BLOCK_COVERS = { physical: ["might", "finesse"], arcane: ["wit", "presence"] };

/**
 * A character's ready blocks (PHB 6.5.1): its Blocking Instruments, Shields and Wards. A Ward or an arcane Instrument is an arcane block,
 * so its Guard covers only Wit and Presence, the mental attacks; any other is physical. A Shield or Ward states no Range, so it reaches
 * Range 1 (user, 2026-10-29).
 */
export function blocksOf(actor) {
  return (actor?.items ?? []).filter(i => isReady(i) && ((i.type === "instrument" && (i.system.types ?? []).includes("blocking"))
    || (i.type === "equipment" && ["shield", "ward"].includes(i.system.category))))
    .map(i => ({ id: i.id, name: i.name, kind: (i.type === "instrument" && i.system.category === "arcane") || i.system.category === "ward" ? "arcane" : "physical",
      band: i.system.rangeBand || "close" }));
}

/** A Guarded mark's note, which names the block's kind so it reads back: "Round Shield, physical block, by Kessen". */
export const guardNote = (kind, blockName, guarderName) => `${blockName}, ${kind} block, by ${guarderName}`;

/**
 * The Guarded mark that covers an Attribute, or null (PHB 6.5.1). A note that says "arcane block", or only "arcane", covers Wit and
 * Presence; any other, a blank one too, covers Might and Finesse.
 */
export const guardKind = note => (/\barcane block\b|^\s*arcane\s*$/i.test(note ?? "") ? "arcane" : "physical");
export function guardFor(conditions, attr) {
  return (conditions ?? []).find(c => c.name === "Guarded" && BLOCK_COVERS[guardKind(c.note)].includes(attr)) ?? null;
}

/**
 * Whether a defender may Parry (PHB 6.5.2): it has a ready Parry Instrument, and the Technique is a Melee or Ranged one, by the families
 * of the Instrument it went through, that deals physical Stress, since Parry is Physical Resistance. A card with no families counts as either.
 */
export function canParry(actor, flag, kind) {
  const parryInstrument = (actor?.items ?? []).some(i => i.type === "instrument" && isReady(i) && (i.system.types ?? []).includes("parry"));
  const families = flag.attackInfo?.families;
  return parryInstrument && kind === "physical" && (!families || families.includes("melee") || families.includes("ranged"));
}

/** The Oppose roll's extra modifiers, from the dialog's answers (PHB 6.5.0, 3.2.0). */
export function opposeExtras({ conditionParts = [], block = 0, guard = false, exposedSpent = [], other = 0 }) {
  const extras = [...conditionParts];
  if (block) extras.push({ label: "Blocking Instrument", value: block });
  if (guard) extras.push({ label: "Guard", value: 2 });
  for (const c of exposedSpent) extras.push({ label: `Foil Exposed (${habitOf(c.note)})`, value: -2 });
  if (other) extras.push({ label: "Other", value: other });
  return extras;
}

/** A character may spend a Foil Token to reroll one die of its Oppose; the new result stands (PHB 3.2.0). */
function* offerReroll(actor, roll, title) {
  if (!hasToken(actor)) return roll.total;
  const dice = roll.dice;
  if (!dice.length) return roll.total;
  const answer = (yield ["askReroll", { title, total: roll.total, dice, tokens: foilTokens(actor) }]);
  if (!answer || answer.die === "" || answer.die === undefined) return roll.total;
  const die = dice[Number(answer.die)];
  const again = (yield ["rollDie", die.faces]);
  (yield ["setFoilTokens", foilTokens(actor) - 1]);
  const total = roll.total - die.value + again;
  (yield ["card", "reroll", { title, total, die, again }]);
  return total;
}

/** The Instruments a creature still fights with (GMG 9.8.2): ready ones, not tools, whose Primary Attribute isn't Incapacitated. */
export const fightingInstruments = actor => [...(actor.items ?? [])].filter(i => i.type === "instrument" && isReady(i)
  && i.system.category !== "tool" && !actor.system.attributes?.[i.system.primaryAttribute]?.down);

/**
 * Lay Stress on an Attribute; what it cannot hold overflows where the defender chooses (PHB 6.7.0). With { secondWind: true } the
 * defender's unspent Second Wind holds the first Attribute this would Incapacitate 1 short (GMG 9.5.1, rules/stress.js landStress);
 * the log and the card name that Attribute in `secondWind`, so the host can mark it spent. With { spread: true } a creature's
 * overflow is placed by GMG 9.8.2 and nothing is asked; a character's is still asked.
 */
export function* applyStressSteps(actor, aim, amount, halved, from, fmt = PLAIN, { secondWind = false, spread = false } = {}) {
  const lines = halved ? [`Foil Token: ${from} / 2, rounded down = ${amount}`] : [];
  const applied = [];
  const fighting = spread && actor.type === "creature" ? fightingInstruments(actor) : null;
  const last = fighting ? [...new Set(fighting.map(i => i.system.primaryAttribute))] : null;
  const run = landStress({ potentials: Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, potentialOf(actor, k)])), aim, amount, secondWind, spread: last });
  const held = attr => `Second Wind: ${ATTR_LABEL[attr]} stops 1 short of its Potential (GMG 9.5.1)`;
  // Named once the aimed Attribute has taken its share: an Instrument on an Attribute this Incapacitated no longer fights.
  const lastLine = (kept = last.filter(k => potentialOf(actor, k) > 0)) => `GMG 9.8.2: the overflow spreads short of Incapacitation${kept.length ? `, with ${kept.map(k =>
    `${ATTR_LABEL[k]} (${fighting.filter(i => i.system.primaryAttribute === k).map(i => i.name).join(", ")})`).join(" and ")} last` : ""}`;
  let step = run.next(), said = false, spreadSaid = false;
  while (!step.done) {
    const ev = step.value;
    if (ev.type === "take") {
      if (ev.overflow && last && !spreadSaid) { lines.push(lastLine()); spreadSaid = true; }
      const { before, after } = (yield ["takeStress", ev.attr, ev.amount]);
      const max = Number(actor.system.attributes?.[ev.attr]?.potential?.max ?? 0);
      lines.push(`${ev.overflow ? "overflow to " : ""}${ATTR_LABEL[ev.attr]} takes ${ev.amount}: Stress ${max - before} ${fmt.arrow} ${max - after} of ${max}`);
      if (ev.secondWind) { lines.push(held(ev.attr)); said = true; }
      applied.push({ attr: ev.attr, amount: ev.amount });
      step = run.next();
    } else {
      const answer = (yield ["askOverflow", { attr: ev.attr, left: ev.left, room: ev.room, potentialOf: k => potentialOf(actor, k) }]);
      step = run.next(answer?.attr);
    }
  }
  const windAttr = step.value.secondWind ?? null;
  if (windAttr && !said) lines.push(held(windAttr));      // it held an Attribute that had room for only 1, so took nothing
  let destroyed = step.value.destroyed;
  if (actor.system.destroyed) destroyed = true;
  const notes = [];
  for (const k of ATTRIBUTE_KEYS) if (actor.system.attributes?.[k]?.down) notes.push(`${ATTR_LABEL[k]} is Incapacitated (PHB 6.8.1).`);
  if (destroyed) notes.push(`${actor.name} is Destroyed (PHB 6.8.2).`);
  notes.push(...harmFlags(actor.system.conditions));
  (yield ["log", "stress-applied", { actor, aimed: aim, amount, halvedByToken: halved, applied,
    incapacitated: ATTRIBUTE_KEYS.filter(k => actor.system.attributes?.[k]?.down), destroyed, ...(windAttr ? { secondWind: windAttr } : {}) }]);
  const note = notes.length ? `${fmt.br}${notes.join(fmt.br)}` : "";
  (yield ["card", "stressApplied", { amount, lines, note, halved, applied, ends: harmNames(actor.system.conditions), ...(windAttr ? { secondWind: windAttr } : {}) }]);
}

/**
 * One target answers a card.
 * @param {object} a
 * @param {object} a.defender  the target: { id, name, type, system, items }
 * @param {object|null} a.attacker  the roller: { id, name, ... }, or null if gone
 * @param {object} a.flag      the card's payload (stressPayload / condition payload in rules/roll.js). A host may add named parts for
 *                             this target: `attackParts` on the attack and `opposeParts` on the Oppose roll, such as a creature's
 *                             Pack Tactics or Dread Presence (Hilt); `also`, a Condition that lands with the Stress (rollTechniqueSteps).
 * @param {boolean} [a.secondWind]  the defender's Second Wind is unspent this conflict (applyStressSteps)
 * @param {boolean} [a.spread]  place a creature defender's overflow by GMG 9.8.2 (applyStressSteps)
 * @param {string} [a.lastInstrument]  the id of the Instrument the defender used last, when the host knows it (a Disarm drops it)
 */
export function* resolveOpposeSteps({ defender: actor, attacker, flag, fmt = PLAIN, secondWind = false, spread = false, lastInstrument = "" }) {
  const sys = actor.system;
  const cnd = flag.condition ?? null;
  const aim = flag.aim;
  const kind = cnd ? "mental" : kindOf(aim);
  const fromConditions = incomingMods(sys.conditions, { melee: !!flag.melee }), host = (flag.attackParts ?? []).filter(p => p.value);
  const incoming = { total: fromConditions.total + host.reduce((n, p) => n + p.value, 0), parts: [...fromConditions.parts, ...host] };
  const attack = Number(flag.attackTotal) + incoming.total;
  const skills = cnd ? (PRIMARY_SKILLS[conditionAttr(cnd)] ?? PRIMARY_SKILLS.wit) : PRIMARY_SKILLS[aim];
  const best = skills.reduce((a, k) => ((sys.skills?.[k]?.rollAvg ?? 0) > (sys.skills?.[a]?.rollAvg ?? 0) ? k : a), skills[0]);

  const attackerName = attacker?.name ?? "";
  const exposed = (sys.conditions ?? []).map((c, i) => ({ ...c, i })).filter(c => c.name === "Foil Exposed" && attackerName && String(c.note).endsWith(`by ${attackerName}`));
  const flags = [...targetFlags(sys.conditions), ...conditionFlags(sys.conditions, { skill: best })];
  // Guard is a mark the guarder put on before (PHB 6.5.1), so it adds by itself when it covers the Attribute under attack; Parry is
  // the defender's choice, asked only when it may Parry (PHB 6.5.2).
  const guarded = guardFor(sys.conditions, cnd ? conditionAttr(cnd) : aim);
  const parryable = !cnd && canParry(actor, flag, kind);
  const answer = (yield ["askOppose", { actor, flag, attack, incoming, cnd, aim, kind, skills, best, flags, attackerName, exposed,
    guarded: guarded ? guarded.note || "physical block" : "", canParry: parryable }]);
  if (!answer) return;

  const skill = skills.includes(answer.skill) ? answer.skill : best;
  const cm = conditionMods(sys.conditions, { skill, oppose: true });
  const block = actor.items.reduce((n, i) => (i.type === "instrument" && i.system.location === "equipped" ? Math.max(n, Number(i.system.bonusOppose ?? 0)) : n), 0);
  const other = Math.trunc(Number(answer.other) || 0);
  const spent = exposed.filter((c, n) => answer[`exposed${n}`]);
  const extras = [...opposeExtras({ conditionParts: cm.parts, block, guard: !!guarded, exposedSpent: spent, other }), ...(flag.opposeParts ?? []).filter(p => p.value)];
  const parried = parryable && !!answer.parry;
  const oppFlags = [...targetFlags(sys.conditions), ...conditionFlags(sys.conditions, { skill })];
  if (spent.length) {
    const left = clone(actor.system.conditions ?? []).filter((c, i) => !spent.some(s => s.i === i));
    (yield ["updateConditions", left]);
  }
  // The Conditions are already in extras, so the roll doesn't add them twice.
  const own = extras.filter(p => !cm.parts.includes(p));
  const formula = skillFormula(sys, skill, own, "", { oppose: true });
  const math = skillMath(sys, skill, own, "", { oppose: true });
  const roll = (yield ["rollOppose", { formula, math, skill, flags: oppFlags }]);
  const oppose = yield* offerReroll(actor, roll, `Oppose: ${SKILL_LABEL[skill]}`);
  const logBase = {
    attacker, defender: actor, technique: flag.name, instrument: flag.instrument ?? null,
    aim: aim ?? null, condition: cnd?.name ?? null, attackRolled: Number(flag.attackTotal), attack,
    attackMods: incoming.parts, opposeSkill: skill, opposeFormula: roll.formula, opposeRolled: roll.total, oppose,
    opposeMods: extras, tokenReroll: oppose !== roll.total, flags: oppFlags
  };

  if (cnd) {
    const versus = `${attack} against ${oppose}`;
    (yield ["log", "oppose", { ...logBase, landed: oppose <= attack }]);
    if (oppose > attack) {
      return (yield ["card", "fail", { flagName: flag.name, defenderName: actor.name, versus }]);
    }
    if (cnd.disarm) return yield* disarmSteps(actor, flag, versus, lastInstrument);
    (yield ["card", "lands", { flagName: flag.name, defenderName: actor.name, conditionName: cnd.name, versus }]);
    return yield* landConditionSteps(actor, cnd, attackerName);
  }

  const scoped = scopedResistance({ narrowResistance: sys.narrowResistance }, { ...(flag.attackInfo ?? {}), kind });
  const resistance = Number(sys.attributes?.[aim]?.resistanceTotal ?? sys.resistance?.[`${kind}Total`] ?? 0) + (parried ? 1 : 0) + scoped.net;
  // Every source of that Resistance, named on the card.
  const kindLabel = kind === "physical" ? "Physical" : "Mental";
  const resistanceParts = [
    `${kindLabel} ${Number(sys.resistance?.[`${kind}Total`] ?? 0)}${sys.resistance?.[`${kind}FromLabel`] ? ` (${sys.resistance[`${kind}FromLabel`]})` : ""}`,
    ...(sys.attributes?.[aim]?.resistanceExtra ? [`${ATTR_LABEL[aim]} only +${sys.attributes[aim].resistanceExtra}${sys.attributes[aim].resistanceFromLabel ? ` (${sys.attributes[aim].resistanceFromLabel})` : ""}`] : []),
    ...(parried ? ["Parry +1"] : []),
    ...scoped.parts
  ];
  const type = flag.typeIndex === "" || flag.typeIndex === undefined || flag.typeIndex === null ? null : flag.types?.[Number(flag.typeIndex)] ?? null;
  const r = stressFor({
    attack, oppose, name: flag.name, cap: flag.cap, capLabel: flag.capLabel, mult: Number(flag.mult ?? 1), multLabel: flag.multLabel ?? "",
    kind, resistance, resistanceParts, type, always: alwaysTypes(flag.types, type), bespoke: Number(flag.bespoke ?? 0), bespokeParts: flag.bespokeParts ?? null,
    other: Number(flag.other ?? 0), pierce: Number(flag.pierce ?? 0), pierceParts: flag.pierceParts ?? null
  });
  (yield ["log", "oppose", { ...logBase, landed: r.landed, margin: r.margin, cappedMargin: r.capped, stress: r.stress,
    cap: flag.cap, mult: Number(flag.mult ?? 1), resistance, kind, scopedResistance: scoped.parts, declaredType: type?.label ?? null,
    bespoke: Number(flag.bespoke ?? 0), pierce: Number(flag.pierce ?? 0), other: Number(flag.other ?? 0), breakdown: r.parts }]);
  const versus = `${attack} against ${oppose}`;
  if (!r.landed) {
    return (yield ["card", "fail", { flagName: flag.name, defenderName: actor.name, versus }]);
  }
  (yield ["card", "stress", { defenderName: actor.name, aim, r, versus }]);
  if (r.stress) {
    const cur = potentialOf(actor, aim);
    const go = (yield ["askApplyStress", { defenderName: actor.name, aim, amount: r.stress, cur, max: sys.attributes?.[aim]?.potential?.max ?? cur, tokens: hasToken(actor) ? foilTokens(actor) : 0 }]);
    let amount = Math.max(0, Math.trunc(Number(go?.amount) || 0));
    const from = amount;
    const halved = !!go?.halve && hasToken(actor);
    if (go?.halve && hasToken(actor)) {
      amount = Math.floor(amount / 2);
      (yield ["setFoilTokens", foilTokens(actor) - 1]);
    }
    if (go && amount) yield* applyStressSteps(actor, aim, amount, halved, from, fmt, { secondWind, spread });
  }
  // A Stress Technique's Condition lands with it, on the same Oppose (rollTechniqueSteps `conditions`).
  if (flag.also) yield* landConditionSteps(actor, flag.also, attackerName);
}

/** The Instruments a Disarm can make the defender drop (PHB 4.2.1): ready ones it holds, so not innate or Immobile. */
export const droppable = actor => [...(actor.items ?? [])].filter(i => i.type === "instrument" && isReady(i) && !i.system.innate
  && !(i.system.types ?? []).includes("immobile"));

/**
 * A landed Disarm (PHB 4.2.1): the defender drops the Instrument it used last, and readying it again costs the Quick Action. With one
 * it could drop, that one; else the one the host knows it used last; else the defender says which.
 */
function* disarmSteps(actor, flag, versus, lastInstrument) {
  const can = droppable(actor);
  if (!can.length) return (yield ["card", "noDrop", { flagName: flag.name, defenderName: actor.name, versus }]);
  let inst = can.length === 1 ? can[0] : can.find(i => i.id === lastInstrument) ?? null;
  if (!inst) {
    const answer = (yield ["askDisarm", { defenderName: actor.name, instruments: can.map(i => ({ id: i.id, name: i.name })) }]);
    inst = can.find(i => i.id === answer?.itemId) ?? can[0];
  }
  (yield ["dropInstrument", inst.id]);
  return (yield ["card", "disarmed", { flagName: flag.name, defenderName: actor.name, itemName: inst.name, versus }]);
}

/** A landed Condition: the GM confirms its rounds and note, and it goes on the defender's sheet (PHB 6.8.0). */
function* landConditionSteps(actor, cnd, attackerName) {
  const sys = actor.system;
  const exposedHabits = cnd.name === "Foil Exposed"
    ? FOIL_AXES.filter(a => ["low", "high"].includes(sys.foil?.[a.key]?.lean)).map(a => ({ key: a.key, label: `${a.label}: ${sys.foil[a.key].habit || (sys.foil[a.key].lean === "high" ? a.high : a.low)}` }))
    : [];
  if (cnd.name === "Foil Exposed" && !exposedHabits.length) {
    return (yield ["card", "noHabit", { defenderName: actor.name }]);
  }
  const go = (yield ["askCondition", { conditionName: cnd.name, exposedHabits, rounds: cnd.rounds || CONDITION_PRESETS[cnd.name] || "", note: cnd.note ?? "", defenderName: actor.name }]);
  if (!go) return;
  const list = clone(actor.system.conditions ?? []);
  const byWho = cnd.name === "Foil Exposed" ? `${go.habit}; by ${attackerName}` : "";
  if (byWho && list.some(c => c.name === "Foil Exposed" && c.note === byWho)) {
    return (yield ["card", "alreadyExposed", { defenderName: actor.name, attackerName }]);
  }
  list.push({ name: cnd.name, rounds: go.rounds?.trim() ?? "", note: byWho || (go.note?.trim() ?? "") });
  (yield ["updateConditions", list]);
  return (yield ["card", "conditionApplied", { defenderName: actor.name, conditionName: cnd.name, go }]);
}

// The same flows for a host that can wait: Foundry, with dialogs. A reducer drives the *Steps generators with driveSync.
export const applyStress = (actor, aim, amount, halved, from, io, fmt) => driveAsync(applyStressSteps(actor, aim, amount, halved, from, fmt), io);
export const resolveOppose = ({ io, ...a }) => driveAsync(resolveOpposeSteps(a), io);
