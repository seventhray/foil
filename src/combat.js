/**
 * src/combat.js
 * Roll modifiers from Conditions (PHB 6.8.0), pure so they run headlessly.
 * A Condition's amount is the first number in its note, 1 if none.
 */

import { SKILL_ATTRS, ATTR_LABEL, ATTRIBUTE_KEYS } from "./constants.js";

export const kindOf = attr => (attr === "might" || attr === "finesse" ? "physical" : "mental");

const amountOf = (note, fallback = 1) => {
  const m = String(note ?? "").match(/\d+/);
  return m ? Number(m[0]) : fallback;
};

/**
 * The flat modifier a roll takes from its own Conditions.
 * Weakened -N to rolls on the Attribute its note names (all rolls if it names none),
 * Reeling -N to Oppose rolls, Blinded -2, Prone -1.
 * @returns {{ total:number, parts:{label:string,value:number}[] }}
 */
export function conditionMods(conditions = [], { skill, oppose = false } = {}) {
  const parts = [];
  const attrs = SKILL_ATTRS[skill] ?? [];
  for (const c of conditions) {
    const note = String(c.note ?? "").toLowerCase();
    switch (c.name) {
      case "Weakened": {
        const named = Object.keys(ATTR_LABEL).filter(k => note.includes(ATTR_LABEL[k].toLowerCase()));
        if (named.some(k => attrs.includes(k))) parts.push({ label: "Weakened", value: -amountOf(c.note) });
        else if (!named.length) parts.push({ label: "Weakened (no Attribute named, applied to all)", value: -amountOf(c.note) });
        break;
      }
      case "Reeling": if (oppose) parts.push({ label: "Reeling", value: -amountOf(c.note) }); break;
      case "Blinded": parts.push({ label: "Blinded", value: -2 }); break;
      case "Prone":   parts.push({ label: "Prone", value: -1 }); break;
    }
  }
  return { total: parts.reduce((n, p) => n + p.value, 0), parts };
}

/** What a target's Conditions do to the Technique rolled against it: Invisible -2, Prone +1 for Melee. */
export function incomingMods(conditions = [], { melee = false } = {}) {
  const parts = [];
  for (const c of conditions) {
    if (c.name === "Invisible") parts.push({ label: "Invisible", value: -2 });
    else if (c.name === "Prone" && melee) parts.push({ label: "Prone", value: 1 });
  }
  return { total: parts.reduce((n, p) => n + p.value, 0), parts };
}

const check = (name, rule) => `Check ${name}: ${rule} (not applied).`;

/**
 * Conditions on the roller that may matter but are not applied for it (judged by the table).
 * `technique` adds the ones about using a Technique at all.
 */
export function conditionFlags(conditions = [], { skill = "", technique = false } = {}) {
  const has = n => conditions.some(c => c.name === n);
  const out = [];
  if (has("Frightened")) out.push(check("Frightened", "-1 to rolls while it can perceive the source"));
  if (has("Restrained") && (!skill || (SKILL_ATTRS[skill] ?? []).includes("finesse"))) out.push(check("Restrained", "Finesse is Incapacitated, adding no dice"));
  if (technique) {
    if (has("Stunned")) out.push(check("Stunned", "spends no Action or Quick Action"));
    if (has("Charmed")) out.push(check("Charmed", "can't use a Technique against the source or its allies"));
    if (has("Controlled")) out.push(check("Controlled", "the source directs its Skill and target"));
    if (has("Baited")) out.push(check("Baited", "targets the source first"));
    if (has("Blinded")) out.push(check("Blinded", "a Technique that needs line of sight reaches only Touching range"));
    if (has("Invisible")) out.push(check("Invisible", "ends when it uses a Technique"));
  }
  return out;
}

/** Conditions on a target that may matter to the Technique rolled against it. */
export function targetFlags(conditions = []) {
  return conditions.some(c => c.name === "Invisible")
    ? [check("Invisible", "reaches only Touching range, and True Sight, Blindsight and Keen Scent ignore it, -2 included")] : [];
}

const HARM_ENDS = { Charmed: "ends when the source's side deals it Stress", Enthralled: "ends when the source or an ally harms it",
                    Relaxed: "ends when the source or an ally threatens or harms it" };

/** Names of a target's Conditions that end when it is harmed. */
export const harmNames = (conditions = []) => [...new Set(conditions.map(c => c.name))].filter(n => HARM_ENDS[n]);

/** Conditions on a target that end when it is harmed. */
export const harmFlags = conditions => harmNames(conditions).map(n => `Check ${n}: ${HARM_ENDS[n]}.`);

/**
 * The Attributes a Stress Technique may aim at (PHB 6.4.0). A stated "Deals Stress to X or Y" decides;
 * otherwise Incorporeal and Sonic reach mental Attributes only, Kinetic both, and Melee and Ranged Types physical ones.
 */
export function allowedAims({ text = "", stressTypes = [], requires = [] } = {}) {
  const named = [...String(text).matchAll(/Stress to ([^.;]*)/gi)].flatMap(m => m[1].match(/Might|Finesse|Wit|Presence/g) ?? []);
  if (named.length) return ATTRIBUTE_KEYS.filter(k => named.includes(ATTR_LABEL[k]));
  const types = stressTypes.filter(t => !requires.length || requires.includes(t.key));
  const pool = types.length ? types : stressTypes;
  const MENTAL_ONLY = ["incorporeal", "sonic"];
  const mental = pool.some(t => t.family === "arcane" || t.family === "sonic");
  const physical = !pool.length || pool.some(t => !MENTAL_ONLY.includes(t.key));
  return ATTRIBUTE_KEYS.filter(k => (kindOf(k) === "mental" ? mental : physical));
}

export const signedParts = parts => parts.map(p => `${p.label} ${p.value > 0 ? "+" : ""}${p.value}`).join(", ");

/** A Skill formula with Mass (PHB 5.2.6) and Conditions folded in, plus any weight dice (PHB 4.1.1). */
export function skillFormula(sys, skill, extra = 0, dice = "", { oppose = false } = {}) {
  const parts = [sys.skills?.[skill]?.formula || "0"];
  if (dice) parts.push(dice);
  const flat = Number(extra || 0) - Number(sys.carry?.penalty ?? 0) + conditionMods(sys.conditions, { skill, oppose }).total;
  if (flat) parts.push(String(flat));
  return parts.join(" + ").replace("+ -", "- ");
}
