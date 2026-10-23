/**
 * src/oppose.js
 * Targeted Techniques (PHB 6.5.0, 6.7.0). A Technique rolled with tokens targeted
 * prompts each target's owner (else the GM) to Oppose. The margin, Conditions,
 * Resistance and Stress follow from the two rolls, and the owner confirms
 * before the Stress lands. What happens is decided in rules/oppose.js, the same code
 * the companion app runs; this supplies the dialogs, chat cards and rolls.
 */

import { SKILL_LABEL } from "../rules/constants.js";
import { signedParts } from "../rules/combat.js";
import { resolveOppose as resolveOpposeCard } from "../rules/oppose.js";
import { ask, esc } from "./dialogs.js";
import { resolveActor } from "./chat-actions.js";
import { logEvent, who } from "./playtest-log.js";
import { opposeDialog, failCard, landsCard, noHabitCard, alreadyExposedCard, conditionAppliedCard, stressCard, stressAppliedCard,
         rerollCard, conditionDialog, applyStressDialog, rerollDialog, overflowDialog } from "./oppose-text.js";

const targetActor = resolveActor;
const FOUNDRY_TEXT = { br: "<br>", arrow: "&rarr;" };

/** The user who answers for a defender: an active non-GM owner, else the active GM. */
function defenderUser(actor) {
  const owner = game.users.find(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  return owner ?? game.users.activeGM ?? null;
}

/** What only Foundry has for an Oppose: dialogs, rolls, chat cards, and the playtest log. */
function opposeIO(actor, attacker) {
  const sys = actor.system;
  const speaker = a => ChatMessage.getSpeaker({ actor: a });
  return {
    askOppose: ({ flag, attack, incoming, cnd, aim, kind, skills, best, flags, attackerName, exposed }) => {
      const opts = skills.map(k => `<option value="${k}" ${k === best ? "selected" : ""}>${SKILL_LABEL[k]} (${sys.skills?.[k]?.formula || "no dice"})</option>`).join("");
      const attackLine = incoming.parts.length
        ? `${flag.attackTotal} ${signedParts(incoming.parts)} = <strong>${attack}</strong>` : `<strong>${attack}</strong> (no modifiers from ${esc(actor.name)}'s Conditions)`;
      const flagHtml = flags.length ? `<p><em>${flags.join("<br>")}</em></p>` : "";
      return ask(`${actor.name} Opposes ${flag.name}`, opposeDialog({ flagName: flag.name, attackLine, defenderName: actor.name,
        conditionName: cnd?.name ?? null, aim, skills, flagHtml, opts, attackerName, exposed, kind }), "Roll Oppose");
    },
    updateConditions: list => actor.update({ "system.conditions": list }),
    rollOppose: async ({ formula, math, skill, flags }) => {
      const roll = await new Roll(formula).evaluate();
      await roll.toMessage({ speaker: speaker(actor),
        flavor: `<div class="foil-flavor"><strong>Oppose: ${SKILL_LABEL[skill]}</strong><br><em>${esc(math)}</em>${flags.length ? `<br><em>${flags.join("<br>")}</em>` : ""}</div>` });
      return { total: roll.total, formula: roll.formula, dice: roll.dice.flatMap(d => d.results.map(r => ({ faces: d.faces, value: r.result }))) };
    },
    askReroll: ({ title, total, dice, tokens }) => ask(`${actor.name}: Foil Token (${tokens})`, rerollDialog({ title, total, dice }), "Confirm"),
    rollDie: async faces => (await new Roll(`1d${faces}`).evaluate()).total,
    setFoilTokens: n => actor.setFoilTokens(n),
    card: (kind, d) => {
      const self = { uuid: actor.uuid, actorId: actor.id, actorName: actor.name };
      const cards = {
        fail: () => ({ speaker: speaker(attacker), content: failCard(d.flagName, d.defenderName, d.versus) }),
        lands: () => ({ speaker: speaker(attacker), content: landsCard(d.flagName, d.defenderName, d.conditionName, d.versus) }),
        noHabit: () => ({ speaker: speaker(attacker), content: noHabitCard(d.defenderName) }),
        alreadyExposed: () => ({ speaker: speaker(attacker), content: alreadyExposedCard(d.defenderName, d.attackerName) }),
        conditionApplied: () => ({ speaker: speaker(actor), content: conditionAppliedCard(d.defenderName, d.conditionName, d.go) }),
        stress: () => ({ speaker: speaker(attacker), content: stressCard(d.defenderName, d.aim, d.r, d.versus) }),
        reroll: () => ({ speaker: speaker(actor), content: rerollCard(d.title, d.total, d.die, d.again) }),
        stressApplied: () => ({ speaker: speaker(actor), content: stressAppliedCard(d.amount, d.lines, d.note), flags: { foil: {
          ...(d.halved ? {} : { halve: { ...self, applied: d.applied } }),
          cond: { actorUuid: actor.uuid, actorId: actor.id, actorName: actor.name, targets: [], ends: d.ends.map(name => ({ ...self, name })) }
        } } })
      };
      return ChatMessage.create(cards[kind]());
    },
    askCondition: ({ conditionName, exposedHabits, rounds, note, defenderName }) =>
      ask(`Apply ${conditionName} to ${defenderName}`, conditionDialog({ conditionName, exposedHabits, rounds, note }), "Apply"),
    askApplyStress: ({ defenderName, aim, amount, cur, max, tokens }) =>
      ask(`Apply Stress to ${defenderName}`, applyStressDialog({ defenderName, aim, amount, cur, max, tokens }), "Apply"),
    askOverflow: ({ attr, left, room, potentialOf }) => ask(`${actor.name}: overflow`, overflowDialog({ attr, left, room, potentialOf }), "Place"),
    takeStress: (key, amount) => actor.takeStress(key, amount),
    log: (type, data) => {
      const d = { ...data };
      for (const k of ["attacker", "defender", "actor"]) if (k in d) d[k] = who(d[k]);
      logEvent(type, d);
    }
  };
}

/** One target answers a Technique's card: find the defender, check who may answer, and run the shared flow. */
export async function resolveOppose(message, index) {
  const flag = message.getFlag("foil", "stress");
  const t = flag?.targets?.[index];
  const actor = t ? await targetActor(t) : null;
  if (!actor) return;
  if (!actor.isOwner) return ui.notifications?.warn(`Only ${actor.name}'s owner or the GM can Oppose for it.`);
  const attacker = game.actors.get(flag.actorId) ?? null;
  return resolveOpposeCard({ defender: actor, attacker, flag, io: opposeIO(actor, attacker), fmt: FOUNDRY_TEXT });
}

Hooks.on("createChatMessage", async message => {
  const flag = message.getFlag("foil", "stress");
  if (!flag?.targets?.length || flag.rerolled || !game.user) return;
  for (let i = 0; i < flag.targets.length; i++) {
    const actor = await targetActor(flag.targets[i]);
    if (actor && defenderUser(actor)?.id === game.user.id) await resolveOppose(message, i);
  }
});
