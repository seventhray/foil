/**
 * src/oppose.js
 * Targeted Techniques (PHB 6.5.0, 6.7.0). A Technique rolled with tokens targeted
 * prompts each target's owner (else the GM) to Oppose. The margin, Conditions,
 * Resistance and Stress follow from the two rolls, and the owner confirms
 * before the Stress lands.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_LABEL, PRIMARY_SKILLS, CONDITION_OPPOSE, CONDITION_PRESETS, FOIL_AXES } from "./constants.js";
import { stressFor, alwaysTypes, landStress } from "./stress.js";
import { conditionFlags, conditionMods, harmFlags, harmNames, incomingMods, kindOf, signedParts, skillFormula, skillMath, targetFlags } from "./combat.js";
import { ask, esc } from "./dialogs.js";
import { resolveActor } from "./chat-actions.js";
import { logEvent, who } from "./playtest-log.js";
import { scopedResistance } from "./resist.js";
import { opposeExtras, opposeDialog, failCard, landsCard, noHabitCard, alreadyExposedCard, conditionAppliedCard, stressCard, stressAppliedCard,
         rerollCard, conditionDialog, applyStressDialog, rerollDialog, overflowDialog } from "./oppose-text.js";

const targetActor = resolveActor;

/** The user who answers for a defender: an active non-GM owner, else the active GM. */
function defenderUser(actor) {
  const owner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return owner ?? game.users.activeGM ?? null;
}

const hasToken = actor => actor.type === "character" && actor.foilTokens > 0;

/** A character may spend a Foil Token to reroll one die of its Oppose; the new result stands (PHB 3.2.0). */
async function offerReroll(actor, roll, title) {
  if (!hasToken(actor)) return roll.total;
  const dice = roll.dice.flatMap(d => d.results.map(r => ({ faces: d.faces, value: r.result })));
  if (!dice.length) return roll.total;
  const answer = await ask(`${actor.name}: Foil Token (${actor.foilTokens})`, rerollDialog({ title, total: roll.total, dice }), "Confirm");
  if (!answer || answer.die === "" || answer.die === undefined) return roll.total;
  const die = dice[Number(answer.die)];
  const again = await new Roll(`1d${die.faces}`).evaluate();
  await actor.setFoilTokens(actor.foilTokens - 1);
  const total = roll.total - die.value + again.total;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: rerollCard(title, total, die, again.total) });
  return total;
}


/** Lay Stress on an Attribute; what it cannot hold overflows where the defender chooses (PHB 6.7.0). */
async function applyStress(actor, aim, amount, halved = false, from = amount) {
  // The math of what lands: the Foil Token halving, then each Attribute it fills or overflows onto.
  const lines = halved ? [`Foil Token: ${from} / 2, rounded down = ${amount}`] : [];
  const applied = [];
  // The rule is landStress (rules/stress.js); this applies each step to the actor and asks where the overflow goes.
  const run = landStress({ potentials: Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, actor.potentialOf(k)])), aim, amount });
  let step = run.next();
  while (!step.done) {
    const ev = step.value;
    if (ev.type === "take") {
      const { before, after } = await actor.takeStress(ev.attr, ev.amount);
      const max = actor.system.attributes?.[ev.attr]?.potential?.max ?? "";
      lines.push(`${ev.overflow ? "overflow to " : ""}${ATTR_LABEL[ev.attr]} takes ${ev.amount}: Potential left ${before} &rarr; ${after} of ${max}`);
      applied.push({ attr: ev.attr, amount: ev.amount });
      step = run.next();
    } else {
      const answer = await ask(`${actor.name}: overflow`, overflowDialog({ attr: ev.attr, left: ev.left, room: ev.room, potentialOf: k => actor.potentialOf(k) }), "Place");
      step = run.next(answer?.attr);
    }
  }
  let destroyed = step.value.destroyed;
  if (actor.system.destroyed) destroyed = true;
  const notes = [];
  for (const k of ATTRIBUTE_KEYS) if (actor.system.attributes?.[k]?.down) notes.push(`${ATTR_LABEL[k]} is Incapacitated (PHB 6.8.1).`);
  if (destroyed) notes.push(`${actor.name} is Destroyed (PHB 6.8.2).`);
  notes.push(...harmFlags(actor.system.conditions));
  logEvent("stress-applied", { actor: who(actor), aimed: aim, amount, halvedByToken: halved, applied,
    incapacitated: ATTRIBUTE_KEYS.filter(k => actor.system.attributes?.[k]?.down), destroyed });
  const note = notes.length ? `<br>${notes.join("<br>")}` : "";
  const self = { uuid: actor.uuid, actorId: actor.id, actorName: actor.name };
  const flags = { foil: {
    ...(halved ? {} : { halve: { ...self, applied } }),
    cond: { actorUuid: actor.uuid, actorId: actor.id, actorName: actor.name, targets: [],
            ends: harmNames(actor.system.conditions).map(name => ({ ...self, name })) }
  } };
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), flags,
    content: stressAppliedCard(amount, lines, note) });
}

/** Roll one target's Oppose for a Stress card, work out the Stress, and offer to apply it. */
export async function resolveOppose(message, index) {
  const flag = message.getFlag("foil", "stress");
  const t = flag?.targets?.[index];
  const actor = t ? await targetActor(t) : null;
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications?.warn(`Only ${actor.name}'s owner or the GM can Oppose for it.`);

  const sys = actor.system;
  const cnd = flag.condition ?? null;
  const aim = flag.aim;
  const kind = cnd ? "mental" : kindOf(aim);
  const incoming = incomingMods(sys.conditions, { melee: !!flag.melee });
  const attack = Number(flag.attackTotal) + incoming.total;
  const skills = cnd ? (CONDITION_OPPOSE[cnd.name] ?? PRIMARY_SKILLS.wit) : PRIMARY_SKILLS[aim];
  const best = skills.reduce((a, k) => ((sys.skills?.[k]?.rollAvg ?? 0) > (sys.skills?.[a]?.rollAvg ?? 0) ? k : a), skills[0]);
  const opts = skills.map(k => `<option value="${k}" ${k === best ? "selected" : ""}>${SKILL_LABEL[k]} (${sys.skills?.[k]?.formula || "no dice"})</option>`).join("");
  const attackLine = incoming.parts.length
    ? `${flag.attackTotal} ${signedParts(incoming.parts)} = <strong>${attack}</strong>` : `<strong>${attack}</strong> (no modifiers from ${esc(actor.name)}'s Conditions)`;

  const attackerName = game.actors.get(flag.actorId)?.name ?? "";
  const exposed = (sys.conditions ?? []).map((c, i) => ({ ...c, i })).filter(c => c.name === "Foil Exposed" && attackerName && String(c.note).endsWith(`by ${attackerName}`));
  const flags = [...targetFlags(sys.conditions), ...conditionFlags(sys.conditions, { skill: best })];
  const flagHtml = flags.length ? `<p><em>${flags.join("<br>")}</em></p>` : "";
  const answer = await ask(`${actor.name} Opposes ${flag.name}`, opposeDialog({ flagName: flag.name, attackLine, defenderName: actor.name,
    conditionName: cnd?.name ?? null, aim, skills, flagHtml, opts, attackerName, exposed, kind }), "Roll Oppose");
  if (!answer) return;

  const skill = skills.includes(answer.skill) ? answer.skill : best;
  const cm = conditionMods(sys.conditions, { skill, oppose: true });
  const block = actor.items.reduce((n, i) => (i.type === "instrument" && i.system.location === "equipped" ? Math.max(n, Number(i.system.bonusOppose ?? 0)) : n), 0);
  const other = Math.trunc(Number(answer.other) || 0);
  const spent = exposed.filter((c, n) => answer[`exposed${n}`]);
  const extras = opposeExtras({ conditionParts: cm.parts, block, guard: !!answer.guard, exposedSpent: spent, other });
  const oppFlags = [...targetFlags(sys.conditions), ...conditionFlags(sys.conditions, { skill })];
  if (spent.length) {
    const left = foundry.utils.deepClone(actor.system.conditions ?? []).filter((c, i) => !spent.some(s => s.i === i));
    await actor.update({ "system.conditions": left });
  }
  // The Conditions are already in extras, so the roll doesn't add them twice.
  const own = extras.filter(p => !cm.parts.includes(p));
  const roll = await new Roll(skillFormula(sys, skill, own, "", { oppose: true })).evaluate();
  const math = skillMath(sys, skill, own, "", { oppose: true });
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="foil-flavor"><strong>Oppose: ${SKILL_LABEL[skill]}</strong><br><em>${esc(math)}</em>${oppFlags.length ? `<br><em>${oppFlags.join("<br>")}</em>` : ""}</div>` });
  const oppose = await offerReroll(actor, roll, `Oppose: ${SKILL_LABEL[skill]}`);
  const logBase = {
    attacker: who(game.actors.get(flag.actorId)), defender: who(actor), technique: flag.name, instrument: flag.instrument ?? null,
    aim: aim ?? null, condition: cnd?.name ?? null, attackRolled: Number(flag.attackTotal), attack,
    attackMods: incoming.parts, opposeSkill: skill, opposeFormula: roll.formula, opposeRolled: roll.total, oppose,
    opposeMods: extras, tokenReroll: oppose !== roll.total, flags: oppFlags
  };

  if (cnd) {
    const speaker = ChatMessage.getSpeaker({ actor: game.actors.get(flag.actorId) });
    const versus = `${attack} against ${oppose}`;
    logEvent("oppose", { ...logBase, landed: oppose <= attack });
    if (oppose > attack) {
      return ChatMessage.create({ speaker, content: failCard(flag.name, actor.name, versus) });
    }
    await ChatMessage.create({ speaker, content: landsCard(flag.name, actor.name, cnd.name, versus) });
    const exposedHabits = cnd.name === "Foil Exposed"
      ? FOIL_AXES.filter(a => ["low", "high"].includes(sys.foil?.[a.key]?.lean)).map(a => ({ key: a.key, label: `${a.label}: ${sys.foil[a.key].habit || (sys.foil[a.key].lean === "high" ? a.high : a.low)}` }))
      : [];
    if (cnd.name === "Foil Exposed" && !exposedHabits.length) {
      return ChatMessage.create({ speaker, content: noHabitCard(actor.name) });
    }
    const go = await ask(`Apply ${cnd.name} to ${actor.name}`, conditionDialog({ conditionName: cnd.name, exposedHabits, rounds: cnd.rounds || CONDITION_PRESETS[cnd.name] || "", note: cnd.note ?? "" }), "Apply");
    if (!go) return;
    const list = foundry.utils.deepClone(actor.system.conditions ?? []);
    const byWho = cnd.name === "Foil Exposed" ? `${go.habit}; by ${attackerName}` : "";
    if (byWho && list.some(c => c.name === "Foil Exposed" && c.note === byWho)) {
      return ChatMessage.create({ speaker, content: alreadyExposedCard(actor.name, attackerName) });
    }
    list.push({ name: cnd.name, rounds: go.rounds?.trim() ?? "", note: byWho || (go.note?.trim() ?? "") });
    await actor.update({ "system.conditions": list });
    return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
      content: conditionAppliedCard(actor.name, cnd.name, go) });
  }

  const scoped = scopedResistance({ narrowResistance: sys.narrowResistance }, { ...(flag.attackInfo ?? {}), kind });
  const resistance = Number(sys.attributes?.[aim]?.resistanceTotal ?? sys.resistance?.[`${kind}Total`] ?? 0) + (answer.parry ? 1 : 0) + scoped.net;
  // Every source of that Resistance, named on the card.
  const kindLabel = kind === "physical" ? "Physical" : "Mental";
  const resistanceParts = [
    `${kindLabel} ${Number(sys.resistance?.[`${kind}Total`] ?? 0)}${sys.resistance?.[`${kind}FromLabel`] ? ` (${sys.resistance[`${kind}FromLabel`]})` : ""}`,
    ...(sys.attributes?.[aim]?.resistanceExtra ? [`${ATTR_LABEL[aim]} only +${sys.attributes[aim].resistanceExtra}${sys.attributes[aim].resistanceFromLabel ? ` (${sys.attributes[aim].resistanceFromLabel})` : ""}`] : []),
    ...(answer.parry ? ["Parry +1"] : []),
    ...scoped.parts
  ];
  const type = flag.typeIndex === "" || flag.typeIndex === undefined || flag.typeIndex === null ? null : flag.types?.[Number(flag.typeIndex)] ?? null;
  const r = stressFor({
    attack, oppose, name: flag.name, cap: flag.cap, capLabel: flag.capLabel, mult: Number(flag.mult ?? 1), multLabel: flag.multLabel ?? "",
    kind, resistance, resistanceParts, type, always: alwaysTypes(flag.types, type), bespoke: Number(flag.bespoke ?? 0), bespokeParts: flag.bespokeParts ?? null,
    other: Number(flag.other ?? 0), pierce: Number(flag.pierce ?? 0), pierceParts: flag.pierceParts ?? null
  });
  logEvent("oppose", { ...logBase, landed: r.landed, margin: r.margin, cappedMargin: r.capped, stress: r.stress,
    cap: flag.cap, mult: Number(flag.mult ?? 1), resistance, kind, scopedResistance: scoped.parts, type: type?.label ?? null,
    bespoke: Number(flag.bespoke ?? 0), pierce: Number(flag.pierce ?? 0), other: Number(flag.other ?? 0), breakdown: r.parts });
  const speaker = ChatMessage.getSpeaker({ actor: game.actors.get(flag.actorId) });
  const versus = `${attack} against ${oppose}`;
  if (!r.landed) {
    return ChatMessage.create({ speaker, content: failCard(flag.name, actor.name, versus) });
  }
  await ChatMessage.create({ speaker, content: stressCard(actor.name, aim, r, versus) });
  if (!r.stress) return;

  const cur = actor.potentialOf(aim);
  const go = await ask(`Apply Stress to ${actor.name}`, applyStressDialog({ defenderName: actor.name, aim, amount: r.stress, cur, max: sys.attributes?.[aim]?.potential?.max ?? cur, tokens: hasToken(actor) ? actor.foilTokens : 0 }), "Apply");
  let amount = Math.max(0, Math.trunc(Number(go?.amount) || 0));
  const from = amount;
  const halved = !!go?.halve && hasToken(actor);
  if (go?.halve && hasToken(actor)) {
    amount = Math.floor(amount / 2);
    await actor.setFoilTokens(actor.foilTokens - 1);
  }
  if (go && amount) await applyStress(actor, aim, amount, halved, from);
}

Hooks.on("createChatMessage", async message => {
  const flag = message.getFlag("foil", "stress");
  if (!flag?.targets?.length || flag.rerolled || !game.user) return;
  for (let i = 0; i < flag.targets.length; i++) {
    const actor = await targetActor(flag.targets[i]);
    if (actor && defenderUser(actor)?.id === game.user.id) await resolveOppose(message, i);
  }
});
