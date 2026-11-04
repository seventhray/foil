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
 *   askOppose(data)                          the Oppose dialog; returns its answers { skill, other, guard, exposed0.. } or null. data.guarded
 *                                            names a Guarded mark that adds its Guard by itself; data.guards lists the defender's own
 *                                            ready Guarding Instruments that cover the Attribute, for a Guard now (answer.guard: an id),
 *                                            which costs its Quick Action (the host spends it) and marks it Guarded for 1 round.
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
import { stressFor, landStress } from "./stress.js";
import { conditionFlags, conditionMods, harmFlags, harmNames, incomingMods, kindOf, skillFormula, skillMath, targetFlags } from "./combat.js";
import { scopedResistance } from "./resist.js";
import { driveAsync } from "./flow.js";
import { isReady } from "./roll.js";
import { kindsOf, meetsRequirement } from "./types.js";

export const PLAIN = { esc: s => String(s ?? ""), br: "\n", arrow: "→" };

const habitOf = note => String(note).replace(/;? by .*$/, "");
const clone = o => JSON.parse(JSON.stringify(o));
const potentialOf = (actor, k) => Number(actor.system.attributes?.[k]?.potential?.current ?? 0);
const foilTokens = actor => Number(actor.system.foilTokens ?? 0);
const hasToken = actor => actor.type === "character" && foilTokens(actor) > 0;

// ---- Guard (PHB 6.5.1, 6.5.2) ----

/** The Attributes a Guard covers, by the kind its Guarding Instrument harms (PHB 6.5.2). "arcane" is an older mark's word for mental. */
export const GUARD_COVERS = { physical: ["might", "finesse"], mental: ["wit", "presence"], arcane: ["wit", "presence"] };

/**
 * A character's ready Guarding Instruments (PHB 6.5.2). Each guards its user or one ally within its Range and covers the kinds of
 * Attribute it harms: Might and Finesse for a shield or a sword, Wit and Presence for an Incorporeal ward. Its +N adds to the guarded
 * Oppose (PHB 5.2.1). A Shield stored as Equipment before 2026-11-02 guards Might and Finesse at Range 1.
 */
export function guardsOf(actor) {
  return (actor?.items ?? []).filter(i => isReady(i) && ((i.type === "instrument" && meetsRequirement(i.system.types, ["guarding"]))
    || (i.type === "equipment" && i.system.category === "shield")))
    .map(i => {
      const inst = i.type === "instrument";
      const kinds = inst ? kindsOf(i.system.types) : ["physical"];
      return { id: i.id, name: i.name, kinds: kinds.length ? kinds : ["physical"], band: (inst && i.system.rangeBand) || "close",
        bonus: inst ? Math.max(0, Number(i.system.bonus ?? 0)) : 0 };
    });
}

/** The Guard a Guarding Instrument gives: +2, and its +N on top (PHB 6.5.1, 5.2.1). */
export const guardValue = guard => 2 + Number(guard?.bonus ?? 0);

/** A Guarded mark's note, which names what it covers and gives so it reads back: "Longsword +2, physical guard +4, by Ulik". */
export const guardNote = (kinds, name, guarderName, value = 2) =>
  `${name}, ${[kinds].flat().join(" and ")} guard${value !== 2 ? ` +${value}` : ""}, by ${guarderName}`;

/**
 * The kinds a Guarded mark covers, from its note: "mental", or an older "arcane block", covers Wit and Presence; "physical and mental"
 * covers all four; any other, a blank one too, covers Might and Finesse.
 */
export function guardKinds(note) {
  const n = String(note ?? "");
  const mental = /\b(mental|arcane)\b/i.test(n);
  return mental && /\bphysical\b/i.test(n) ? ["physical", "mental"] : mental ? ["mental"] : ["physical"];
}

/** The Guard a mark gives (PHB 6.5.1): the "+N" its note states after "guard", else +2. */
export const markValue = mark => Number(String(mark?.note ?? "").match(/\bguard \+(\d+)/i)?.[1] ?? 2);

/** The Guarded mark that covers an Attribute, or null (PHB 6.5.1). */
export function guardFor(conditions, attr) {
  return (conditions ?? []).find(c => c.name === "Guarded" && guardKinds(c.note).some(k => GUARD_COVERS[k].includes(attr))) ?? null;
}

/** The Oppose roll's extra modifiers, from the dialog's answers (PHB 6.5.0, 3.2.0). `guard` is the Guard's value, +2 and any +N. */
export function opposeExtras({ conditionParts = [], guard = 0, exposedSpent = [], other = 0 }) {
  const extras = [...conditionParts];
  if (guard) extras.push({ label: "Guard", value: guard === true ? 2 : Number(guard) });
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
  // A Guarded mark put on before adds by itself when it covers the Attribute under attack (PHB 6.5.1). Without one, the defender may
  // Guard now through its own ready Guarding Instrument that covers it: the Quick Action, which the host spends from the answer.
  const under = cnd ? conditionAttr(cnd) : aim;
  const guarded = guardFor(sys.conditions, under);
  const guards = guarded ? [] : guardsOf(actor).filter(g => g.kinds.some(k => GUARD_COVERS[k].includes(under)));
  const answer = (yield ["askOppose", { actor, flag, attack, incoming, cnd, aim, kind, skills, best, flags, attackerName, exposed,
    guarded: guarded ? guarded.note || "physical guard" : "", guards: guards.map(g => ({ id: g.id, name: g.name, value: guardValue(g) })) }]);
  if (!answer) return;

  const skill = skills.includes(answer.skill) ? answer.skill : best;
  const cm = conditionMods(sys.conditions, { skill, oppose: true });
  const other = Math.trunc(Number(answer.other) || 0);
  const spent = exposed.filter((c, n) => answer[`exposed${n}`]);
  const guardNow = answer.guard ? guards.find(g => g.id === answer.guard) ?? (answer.guard === true ? guards[0] : null) ?? null : null;
  const guard = guarded ? markValue(guarded) : guardNow ? guardValue(guardNow) : 0;
  const extras = [...opposeExtras({ conditionParts: cm.parts, guard, exposedSpent: spent, other }), ...(flag.opposeParts ?? []).filter(p => p.value)];
  const oppFlags = [...targetFlags(sys.conditions), ...conditionFlags(sys.conditions, { skill })];
  if (spent.length || guardNow) {
    const left = clone(actor.system.conditions ?? []).filter((c, i) => !spent.some(s => s.i === i)).filter(c => !guardNow || c.name !== "Guarded");
    if (guardNow) left.push({ name: "Guarded", rounds: "1 round", note: guardNote(guardNow.kinds, guardNow.name, actor.name, guardValue(guardNow)) });
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
  const resistance = Number(sys.attributes?.[aim]?.resistanceTotal ?? sys.resistance?.[`${kind}Total`] ?? 0) + scoped.net;
  // Every source of that Resistance, named on the card.
  const kindLabel = kind === "physical" ? "Physical" : "Mental";
  const resistanceParts = [
    `${kindLabel} ${Number(sys.resistance?.[`${kind}Total`] ?? 0)}${sys.resistance?.[`${kind}FromLabel`] ? ` (${sys.resistance[`${kind}FromLabel`]})` : ""}`,
    ...(sys.attributes?.[aim]?.resistanceExtra ? [`${ATTR_LABEL[aim]} only +${sys.attributes[aim].resistanceExtra}${sys.attributes[aim].resistanceFromLabel ? ` (${sys.attributes[aim].resistanceFromLabel})` : ""}`] : []),
    ...scoped.parts
  ];
  const type = flag.typeIndex === "" || flag.typeIndex === undefined || flag.typeIndex === null ? null : flag.types?.[Number(flag.typeIndex)] ?? null;
  const r = stressFor({
    attack, oppose, name: flag.name, cap: flag.cap, capLabel: flag.capLabel, mult: Number(flag.mult ?? 1), multLabel: flag.multLabel ?? "",
    kind, resistance, resistanceParts, bespoke: Number(flag.bespoke ?? 0), bespokeParts: flag.bespokeParts ?? null,
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
  // A Stress Technique's or signature's Condition lands with it, on the same Oppose (rollTechniqueSteps, rollKitSteps `conditions`).
  // A Disarm drops an Instrument (PHB 4.2.1).
  if (flag.also?.disarm) yield* disarmSteps(actor, flag, versus, lastInstrument);
  else if (flag.also) yield* landConditionSteps(actor, flag.also, attackerName);
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
