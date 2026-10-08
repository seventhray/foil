/**
 * src/oppose.js
 * Targeted Techniques (PHB 6.5.0, 6.7.0). A Technique rolled with tokens targeted
 * prompts each target's owner (else the GM) to Oppose. The margin, Conditions,
 * Resistance and Stress follow from the two rolls, and the owner confirms
 * before the Stress lands.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_LABEL, PRIMARY_SKILLS } from "./constants.js";
import { stressFor } from "./stress.js";
import { conditionFlags, conditionMods, harmFlags, incomingMods, kindOf, signedParts, skillFormula, targetFlags } from "./combat.js";
import { ask } from "./dialogs.js";

/** The Actor a stored target points at (a token's own actor when the token is unlinked). */
export async function targetActor(t) {
  const doc = t.uuid ? await fromUuid(t.uuid).catch(() => null) : null;
  return doc?.actor ?? game.actors.get(t.actorId) ?? null;
}

/** The user who answers for a defender: an active non-GM owner, else the active GM. */
function defenderUser(actor) {
  const owner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return owner ?? game.users.activeGM ?? null;
}

const signed = n => (n > 0 ? `+${n}` : `${n}`);

/** Lay Stress on an Attribute; what it cannot hold overflows where the defender chooses (PHB 6.7.0). */
async function applyStress(actor, aim, amount) {
  const lines = [];
  let left = amount, attr = aim, destroyed = false;
  while (left > 0) {
    const take = Math.min(left, actor.potentialOf(attr));
    if (take > 0) {
      const { before, after } = await actor.takeStress(attr, take);
      lines.push(`${ATTR_LABEL[attr]} ${before} &rarr; ${after}`);
      left -= take;
    }
    if (left <= 0) break;
    const room = ATTRIBUTE_KEYS.filter(k => k !== attr && actor.potentialOf(k) > 0);
    if (!room.length) { destroyed = true; break; }
    if (room.length === 1) attr = room[0];
    else {
      const opts = room.map(k => `<option value="${k}">${ATTR_LABEL[k]} (${actor.potentialOf(k)} left)</option>`).join("");
      const answer = await ask(`${actor.name}: overflow`,
        `<p>${ATTR_LABEL[attr]} is full. ${left} Stress overflows onto an Attribute of the defender's choice.</p>`
        + `<div class="form-group"><label>Attribute</label><select name="attr">${opts}</select></div>`, "Place");
      attr = room.includes(answer?.attr) ? answer.attr : room[0];
    }
  }
  if (actor.system.destroyed) destroyed = true;
  const notes = [];
  for (const k of ATTRIBUTE_KEYS) if (actor.system.attributes?.[k]?.down) notes.push(`${ATTR_LABEL[k]} is Incapacitated (PHB 6.8.1).`);
  if (destroyed) notes.push(`${actor.name} is Destroyed (PHB 6.8.2).`);
  notes.push(...harmFlags(actor.system.conditions));
  const note = notes.length ? `<br>${notes.join("<br>")}` : "";
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="foil-flavor"><strong>${amount} Stress applied</strong><br><em>${lines.join(", ")}${note}</em></div>` });
}

/** Roll one target's Oppose for a Stress card, work out the Stress, and offer to apply it. */
export async function resolveOppose(message, index) {
  const flag = message.getFlag("foil", "stress");
  const t = flag?.targets?.[index];
  const actor = t ? await targetActor(t) : null;
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications?.warn(`Only ${actor.name}'s owner or the GM can Oppose for it.`);

  const sys = actor.system;
  const aim = flag.aim;
  const kind = kindOf(aim);
  const incoming = incomingMods(sys.conditions, { melee: !!flag.melee });
  const attack = Number(flag.attackTotal) + incoming.total;
  const skills = PRIMARY_SKILLS[aim];
  const best = skills.reduce((a, k) => ((sys.skills?.[k]?.rollAvg ?? 0) > (sys.skills?.[a]?.rollAvg ?? 0) ? k : a), skills[0]);
  const opts = skills.map(k => `<option value="${k}" ${k === best ? "selected" : ""}>${SKILL_LABEL[k]} (${sys.skills?.[k]?.formula || "no dice"})</option>`).join("");
  const attackLine = incoming.parts.length
    ? `${flag.attackTotal} ${signedParts(incoming.parts)} = <strong>${attack}</strong>` : `<strong>${attack}</strong>`;

  const flags = [...targetFlags(sys.conditions), ...conditionFlags(sys.conditions, { skill: best })];
  const flagHtml = flags.length ? `<p><em>${flags.join("<br>")}</em></p>` : "";
  const answer = await ask(`${actor.name} Opposes ${flag.name}`,
    `<p>${flag.name} rolled ${attackLine} at ${actor.name}'s ${ATTR_LABEL[aim]}. Conditions and a Blocking Instrument's bonus are added.</p>${flagHtml}`
    + `<div class="form-group"><label>Oppose with</label><select name="skill">${opts}</select></div>`
    + `<div class="form-group"><label>Guard <em>(+2)</em></label><input type="checkbox" name="guard" /></div>`
    + (kind === "physical" ? `<div class="form-group"><label>Parry <em>(physical Resistance +1)</em></label><input type="checkbox" name="parry" /></div>` : "")
    + `<div class="form-group"><label>Other Oppose modifier</label><input type="number" name="other" value="0" /></div>`, "Roll Oppose");
  if (!answer) return;

  const skill = skills.includes(answer.skill) ? answer.skill : best;
  const cm = conditionMods(sys.conditions, { skill, oppose: true });
  const block = actor.items.reduce((n, i) => (i.type === "instrument" && i.system.location === "equipped" ? Math.max(n, Number(i.system.bonusOppose ?? 0)) : n), 0);
  const other = Math.trunc(Number(answer.other) || 0);
  const extras = [...cm.parts];
  const oppFlags = [...targetFlags(sys.conditions), ...conditionFlags(sys.conditions, { skill })];
  if (block) extras.push({ label: "Blocking Instrument", value: block });
  if (answer.guard) extras.push({ label: "Guard", value: 2 });
  if (other) extras.push({ label: "Other", value: other });
  const flat = extras.reduce((n, p) => n + p.value, 0) - cm.total;
  const roll = await new Roll(skillFormula(sys, skill, flat, "", { oppose: true })).evaluate();
  const oppose = roll.total;
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div class="foil-flavor"><strong>Oppose: ${SKILL_LABEL[skill]}</strong>${extras.length ? `<br><em>${signedParts(extras)}.</em>` : ""}${oppFlags.length ? `<br><em>${oppFlags.join("<br>")}</em>` : ""}</div>` });

  const resistance = Number(sys.attributes?.[aim]?.resistanceTotal ?? sys.resistance?.[`${kind}Total`] ?? 0) + (answer.parry ? 1 : 0);
  const type = flag.typeIndex === "" || flag.typeIndex === undefined || flag.typeIndex === null ? null : flag.types?.[Number(flag.typeIndex)] ?? null;
  const r = stressFor({
    attack, oppose, name: flag.name, cap: flag.cap, capLabel: flag.capLabel, mult: Number(flag.mult ?? 1),
    kind, resistance, type, bespoke: Number(flag.bespoke ?? 0), other: Number(flag.other ?? 0), pierce: Number(flag.pierce ?? 0)
  });
  const speaker = ChatMessage.getSpeaker({ actor: game.actors.get(flag.actorId) });
  const versus = `${attack} against ${oppose}`;
  if (!r.landed) {
    return ChatMessage.create({ speaker, content: `<div class="foil-flavor"><strong>${flag.name} fails against ${actor.name}</strong><br><em>${versus}; the Oppose beat it (PHB 6.5.0).</em></div>` });
  }
  await ChatMessage.create({ speaker, content:
    `<div class="foil-flavor"><strong>${r.stress} Stress</strong> to ${actor.name}'s ${ATTR_LABEL[aim]}<br><em>${versus}; ${r.parts.join("; ")}.</em></div>` });
  if (!r.stress) return;

  const cur = actor.potentialOf(aim);
  const go = await ask(`Apply Stress to ${actor.name}`,
    `<p>${r.stress} Stress on ${ATTR_LABEL[aim]} (${cur} of ${sys.attributes?.[aim]?.potential?.max ?? cur} left). Lower the amount if a Foil Token halves it.</p>`
    + `<div class="form-group"><label>Stress</label><input type="number" name="amount" value="${r.stress}" min="0" /></div>`, "Apply");
  const amount = Math.max(0, Math.trunc(Number(go?.amount) || 0));
  if (go && amount) await applyStress(actor, aim, amount);
}

Hooks.on("createChatMessage", async message => {
  const flag = message.getFlag("foil", "stress");
  if (!flag?.targets?.length || flag.rerolled || !game.user) return;
  for (let i = 0; i < flag.targets.length; i++) {
    const actor = await targetActor(flag.targets[i]);
    if (actor && defenderUser(actor)?.id === game.user.id) await resolveOppose(message, i);
  }
});
