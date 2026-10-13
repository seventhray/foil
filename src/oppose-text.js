/**
 * src/oppose-text.js
 * The wording of the Oppose flow: dialog bodies, chat cards, and the Oppose modifiers that come out of
 * a dialog. Pure strings and numbers, so oppose.js only decides what happens and verify can read this.
 */

import { ATTR_LABEL, SKILL_LABEL } from "./constants.js";
import { esc } from "./dialogs.js";

const flavor = html => `<div class="foil-flavor">${html}</div>`;
const habitOf = note => String(note).replace(/;? by .*$/, "");

/** The Oppose roll's extra modifiers, from the dialog's answers (PHB 6.5.0, 3.2.0). */
export function opposeExtras({ conditionParts = [], block = 0, guard = false, exposedSpent = [], other = 0 }) {
  const extras = [...conditionParts];
  if (block) extras.push({ label: "Blocking Instrument", value: block });
  if (guard) extras.push({ label: "Guard", value: 2 });
  for (const c of exposedSpent) extras.push({ label: `Foil Exposed (${habitOf(c.note)})`, value: -2 });
  if (other) extras.push({ label: "Other", value: other });
  return extras;
}

export function opposeDialog({ flagName, attackLine, defenderName, conditionName, aim, skills, flagHtml, opts, attackerName, exposed, kind }) {
  const cnd = conditionName;
  return `<p>${esc(flagName)} rolled ${attackLine} to make ${esc(defenderName)} ${cnd ?? `suffer Stress at ${ATTR_LABEL[aim]}`}. ${cnd ? `${esc(defenderName)} must Oppose with ${skills.map(k => SKILL_LABEL[k]).join(" or ")} (PHB 6.5.0). ` : ""}Conditions and a Blocking Instrument's bonus are added.</p>${flagHtml}`
    + `<div class="form-group"><label>Oppose with</label><select name="skill">${opts}</select></div>`
    + exposed.map((c, n) => `<div class="form-group"><label>${esc(attackerName)} uses Foil Exposed: ${habitOf(c.note)} <em>(-2, used up)</em></label><input type="checkbox" name="exposed${n}" /></div>`).join("")
    + (cnd ? "" : `<div class="form-group"><label>Guard <em>(+2)</em></label><input type="checkbox" name="guard" /></div>`)
    + (!cnd && kind === "physical" ? `<div class="form-group"><label>Parry <em>(physical Resistance +1)</em></label><input type="checkbox" name="parry" /></div>` : "")
    + `<div class="form-group"><label>Other Oppose modifier</label><input type="number" name="other" value="0" /></div>`;
}

export const failCard = (flagName, defenderName, versus) =>
  flavor(`<strong>${esc(flagName)} fails against ${esc(defenderName)}</strong><br><em>${versus}; the Oppose beat it (PHB 6.5.0).</em>`);
export const landsCard = (flagName, defenderName, conditionName, versus) =>
  flavor(`<strong>${esc(flagName)} lands: ${esc(defenderName)} is ${esc(conditionName)}</strong><br><em>${versus}.</em>`);
export const noHabitCard = defenderName =>
  flavor(`<strong>${esc(defenderName)} has no Habit to expose</strong><br><em>Every axis is Neutral.</em>`);
export const alreadyExposedCard = (defenderName, attackerName) =>
  flavor(`<strong>${esc(defenderName)} is already exposed on that Habit by ${esc(attackerName)}</strong>`);
export const conditionAppliedCard = (defenderName, conditionName, go) =>
  flavor(`<strong>${esc(defenderName)} is ${esc(conditionName)}</strong><br><em>${[go.rounds?.trim(), go.note?.trim()].filter(Boolean).join("; ")}.</em>`);
export const stressCard = (defenderName, aim, r, versus) =>
  flavor(`<strong>${r.stress} Stress</strong> to ${esc(defenderName)}'s ${ATTR_LABEL[aim]}<br><em>${versus}; ${r.parts.join("; ")}.</em>`);
export const stressAppliedCard = (amount, lines, note) =>
  flavor(`<strong>${amount} Stress applied</strong><br><em>${lines.join(", ")}${note}</em>`);
export const rerollCard = (title, total, die, again) =>
  flavor(`<strong>${title}: ${total}</strong><br><em>Foil Token spent. d${die.faces} rerolled ${die.value} &rarr; ${again}.</em>`);

export function conditionDialog({ conditionName, exposedHabits, rounds, note }) {
  return (exposedHabits.length ? `<div class="form-group"><label>Habit learned</label><select name="habit">${exposedHabits.map(h => `<option value="${esc(h.label)}">${esc(h.label)}</option>`).join("")}</select></div>` : "")
    + `<div class="form-group"><label>Duration</label><input type="text" name="rounds" value="${rounds}" /></div>`
    + `<div class="form-group"><label>Note <em>(Weakened: Attribute and N; Reeling: N)</em></label><input type="text" name="note" value="${note}" /></div>`;
}

export function applyStressDialog({ defenderName, aim, amount, cur, max, tokens }) {
  return `<p>${amount} Stress on ${ATTR_LABEL[aim]} (${cur} of ${max} left). Lower the amount if a Foil Token halves it.</p>`
    + `<div class="form-group"><label>Stress</label><input type="number" name="amount" value="${amount}" min="0" /></div>`
    + (tokens > 0 ? `<div class="form-group"><label>Spend a Foil Token to halve it <em>(${tokens} held)</em></label><input type="checkbox" name="halve" /></div>` : "");
}

export function rerollDialog({ title, total, dice }) {
  const opts = [`<option value="">Keep ${total}</option>`, ...dice.map((d, i) => `<option value="${i}">Reroll d${d.faces}: ${d.value}</option>`)].join("");
  return `<p>${title} totals <strong>${total}</strong>. Spend a Foil Token to reroll one die?</p><div class="form-group"><label>Die</label><select name="die">${opts}</select></div>`;
}

export function overflowDialog({ attr, left, room, potentialOf }) {
  const opts = room.map(k => `<option value="${k}">${ATTR_LABEL[k]} (${potentialOf(k)} left)</option>`).join("");
  return `<p>${ATTR_LABEL[attr]} is full. ${left} Stress overflows onto an Attribute of the defender's choice.</p>`
    + `<div class="form-group"><label>Attribute</label><select name="attr">${opts}</select></div>`;
}
