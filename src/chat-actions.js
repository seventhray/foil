/**
 * src/chat-actions.js
 * Buttons on roll and Stress cards: add a preset Condition to the roller or a
 * target, end a Condition the card says has ended, adjust a Technique's roll,
 * and spend a Foil Token to halve Stress just applied.
 */

import { ATTR_LABEL, CONDITIONS, CONDITION_PRESETS, FOIL_TOKEN_MAX } from "./constants.js";
import { ask, addButton, esc } from "./dialogs.js";

/** The Actor a stored entry points at (a token's own actor when the token is unlinked). */
export async function resolveActor(t) {
  const doc = t?.uuid ? await fromUuid(t.uuid).catch(() => null) : null;
  if (doc?.documentName === "Actor") return doc;
  return doc?.actor ?? (t?.actorId ? game.actors.get(t.actorId) : null) ?? null;
}

const owned = actor => {
  if (actor?.isOwner) return true;
  ui.notifications?.warn(`Only ${actor?.name ?? "its"} owner or the GM can change that.`);
  return false;
};

/** The roller and each target, as choices. */
const whoList = cond => [{ uuid: cond.actorUuid, actorId: cond.actorId, name: cond.actorName, roller: true }, ...(cond.targets ?? [])];

async function addCondition(cond) {
  const who = whoList(cond);
  const whoOpts = who.map((w, i) => `<option value="${i}" ${i === (who.length > 1 ? 1 : 0) ? "selected" : ""}>${esc(w.name)}${w.roller ? " (roller)" : ""}</option>`).join("");
  const condOpts = CONDITIONS.map(c => `<option value="${c}">${c} (${CONDITION_PRESETS[c] ?? ""})</option>`).join("");
  const answer = await ask("Add a Condition",
    `<div class="form-group"><label>To</label><select name="who">${whoOpts}</select></div>`
    + `<div class="form-group"><label>Condition</label><select name="name">${condOpts}</select></div>`
    + `<div class="form-group"><label>Duration <em>(blank = the preset)</em></label><input type="text" name="rounds" /></div>`
    + `<div class="form-group"><label>Note <em>(Weakened: Might 2; Reeling: 2)</em></label><input type="text" name="note" /></div>`, "Add");
  if (!answer?.name) return;
  const actor = await resolveActor(who[Number(answer.who)]);
  if (!actor || !owned(actor)) return;
  const rounds = answer.rounds?.trim() || CONDITION_PRESETS[answer.name] || "";
  const list = foundry.utils.deepClone(actor.system.conditions ?? []);
  list.push({ name: answer.name, rounds, note: answer.note?.trim() ?? "" });
  await actor.update({ "system.conditions": list });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="foil-flavor"><strong>${esc(actor.name)} is ${esc(answer.name)}</strong><br><em>${esc([rounds, answer.note?.trim()].filter(Boolean).join("; "))}.</em></div>` });
}

async function endCondition(e) {
  const actor = await resolveActor(e);
  if (!actor || !owned(actor)) return;
  const list = foundry.utils.deepClone(actor.system.conditions ?? []);
  const i = list.findIndex(c => c.name === e.name);
  if (i < 0) return ui.notifications?.warn(`${actor.name} is not ${e.name}.`);
  list.splice(i, 1);
  await actor.update({ "system.conditions": list });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="foil-flavor"><strong>${esc(e.name)} ends on ${esc(actor.name)}</strong></div>` });
}

/** Add or subtract a flat modifier from a Technique's roll; the new card carries the Oppose buttons. */
async function adjustRoll(message) {
  const stress = message.getFlag("foil", "stress");
  const actor = game.actors.get(stress?.actorId);
  if (!actor || !owned(actor)) return;
  const answer = await ask("Adjust the roll",
    `<p>${esc(stress.name)} stands at ${stress.attackTotal}.</p>`
    + `<div class="form-group"><label>Modifier</label><input type="number" name="mod" value="0" autofocus /></div>`
    + `<div class="form-group"><label>Reason</label><input type="text" name="why" /></div>`, "Adjust");
  const mod = Math.trunc(Number(answer?.mod) || 0);
  if (!mod) return;
  const total = Number(stress.attackTotal) + mod;
  const reroll = message.getFlag("foil", "reroll");
  const flags = { foil: { stress: { ...stress, attackTotal: total, rerolled: true }, cond: message.getFlag("foil", "cond") } };
  if (reroll) flags.foil.reroll = { ...reroll, total };
  await ChatMessage.create({ speaker: message.speaker, flags, content:
    `<div class="foil-flavor"><strong>${esc(stress.name)}: ${total}</strong><br><em>${mod > 0 ? "+" : ""}${mod}${answer.why ? ` ${esc(answer.why)}` : ""}; was ${stress.attackTotal}.</em></div>` });
}

/** Spend a Foil Token to take back half the Stress just applied, rounded down (PHB 3.2.0). */
async function halveApplied(h) {
  const actor = await resolveActor(h);
  if (!actor || !owned(actor)) return;
  if (actor.type !== "character" || actor.foilTokens < 1) return ui.notifications?.warn(`${actor.name} has no Foil Tokens.`);
  const total = h.applied.reduce((n, a) => n + a.amount, 0);
  let back = total - Math.floor(total / 2);
  const lines = [];
  for (const a of [...h.applied].reverse()) {
    if (!back) break;
    const give = Math.min(a.amount, back);
    back -= give;
    const { before, after } = await actor.heal(a.attr, give);
    lines.push(`${ATTR_LABEL[a.attr]} ${before} &rarr; ${after}`);
  }
  await actor.setFoilTokens(actor.foilTokens - 1);
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="foil-flavor"><strong>Foil Token spent: ${total} Stress halved to ${Math.floor(total / 2)}</strong><br><em>${lines.join(", ")}</em></div>` });
}

/** The GM approves an invoked Habit: the character earns a Foil Token (PHB 3.2.0). */
async function awardToken(message, invoke) {
  const actor = game.actors.get(invoke.actorId);
  if (!actor || actor.type !== "character") return;
  if (actor.foilTokens >= FOIL_TOKEN_MAX) return ui.notifications?.warn(`${actor.name} already holds ${FOIL_TOKEN_MAX} Foil Tokens.`);
  await actor.setFoilTokens(actor.foilTokens + 1);
  await message.setFlag("foil", "invoke", { ...invoke, awarded: true });
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="foil-flavor"><strong>${esc(actor.name)} earns a Foil Token</strong><br><em>${actor.foilTokens} of ${FOIL_TOKEN_MAX}.</em></div>` });
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  const cond = message.getFlag("foil", "cond");
  if (cond) {
    addButton(html, "Add Condition", "foil-add-condition", () => addCondition(cond));
    for (const e of cond.ends ?? []) addButton(html, `End ${e.name}: ${e.actorName}`, "foil-end-condition", () => endCondition(e));
  }
  const invoke = message.getFlag("foil", "invoke");
  if (invoke && !invoke.awarded && game.user.isGM) addButton(html, "Consent: the player earns a Foil Token", "foil-award-token", () => awardToken(message, invoke));
  if (invoke?.awarded) addButton(html, "Consented: Foil Token earned", "foil-awarded", () => {}).disabled = true;
  if (message.getFlag("foil", "stress")) addButton(html, "Adjust roll", "foil-adjust-roll", () => adjustRoll(message));
  const halve = message.getFlag("foil", "halve");
  if (halve) addButton(html, "Foil Token: halve", "foil-halve", () => halveApplied(halve));
});
