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
  let reeling = 0, blinded = false, prone = false;   // a repeat of these keeps one instance, the larger N (PHB 6.8.0)
  for (const c of conditions) {
    const note = String(c.note ?? "").toLowerCase();
    switch (c.name) {
      case "Weakened": {
        const named = Object.keys(ATTR_LABEL).filter(k => note.includes(ATTR_LABEL[k].toLowerCase()));
        if (named.some(k => attrs.includes(k))) parts.push({ label: "Weakened", value: -amountOf(c.note) });
        else if (!named.length) parts.push({ label: "Weakened (no Attribute named, applied to all)", value: -amountOf(c.note) });
        break;
      }
      case "Reeling": reeling = Math.max(reeling, amountOf(c.note)); break;
      case "Blinded": blinded = true; break;
      case "Prone":   prone = true; break;
    }
  }
  if (oppose && reeling) parts.push({ label: "Reeling", value: -reeling });
  if (blinded) parts.push({ label: "Blinded", value: -2 });
  if (prone) parts.push({ label: "Prone", value: -1 });
  return { total: parts.reduce((n, p) => n + p.value, 0), parts };
}

/** What a target's Conditions do to the Technique rolled against it: Invisible -2, Prone +1 for Melee. */
export function incomingMods(conditions = [], { melee = false } = {}) {
  const parts = [];
  if (conditions.some(c => c.name === "Invisible")) parts.push({ label: "Invisible", value: -2 });
  if (melee && conditions.some(c => c.name === "Prone")) parts.push({ label: "Prone", value: 1 });
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
    if (has("Blinded")) out.push(check("Blinded", "a Technique that needs line of sight works only at Range 0"));
    if (has("Invisible")) out.push(check("Invisible", "ends when it uses a Technique"));
  }
  return out;
}

/** Conditions on a target that may matter to the Technique rolled against it. */
export function targetFlags(conditions = []) {
  return conditions.some(c => c.name === "Invisible")
    ? [check("Invisible", "works only at Range 0, and True Sight, Blindsight and Keen Scent ignore it, -2 included")] : [];
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
const tag = s => String(s).replace(/[\[\]]/g, "");
const signed = n => `${n < 0 ? "-" : "+"}${Math.abs(n)}`;
const asParts = (x, label) => Array.isArray(x) ? x.filter(p => p && (p.value || p.dice)) : (Number(x) ? [{ label, value: Number(x) }] : []);

/**
 * Every term of a Skill roll with its source (PHB 2.2.0): each Attribute's dice, Training and
 * its cap, gear, Mass, the roller's Conditions, then the extras and dice given.
 * extras and dice take a number or string (one unnamed source) or a list of { label, value } / { label, dice }.
 * @returns {{ label:string, value?:number, dice?:string, note?:string }[]}
 */
export function skillTerms(sys, skill, extras = [], dice = [], { oppose = false, conditions = true } = {}) {
  const sk = sys.skills?.[skill] ?? {};
  const terms = [];
  const pair = SKILL_ATTRS[skill] ?? [];
  if (pair.some(ak => sys.attributes?.[ak])) {
    for (const ak of pair) {
      const a = sys.attributes?.[ak];
      if (!a) continue;
      if (a.down) terms.push({ label: ATTR_LABEL[ak], value: 0, note: "Incapacitated, no dice" });
      else if (a.diceFormula) terms.push({ label: ATTR_LABEL[ak], dice: a.diceFormula });
    }
  } else if (sk.formula) terms.push({ label: "Skill", dice: sk.formula });
  if (sk.trainingTotal !== undefined) {
    const cap = sk.trainingCap !== undefined ? `cap ${sk.trainingCap}${sk.overCap ? ", over it" : ""}` : "";
    terms.push({ label: "Training", value: Number(sk.trainingBase ?? 0), note: cap });
    if (sk.trainingBonus) terms.push({ label: "Training from a Background or Feat", value: Number(sk.trainingBonus) });
    if (sk.skillBonus) terms.push({ label: "Gear", value: Number(sk.skillBonus) });
  }
  if (sys.carry?.penalty) terms.push({ label: "Mass", value: -Number(sys.carry.penalty), note: `${sys.carry.weight} lbs, ${sys.carry.limit} free` });
  if (conditions) for (const c of conditionMods(sys.conditions, { skill, oppose }).parts) terms.push({ label: c.label, value: c.value });
  terms.push(...asParts(extras, "Bonus"));
  for (const d of (Array.isArray(dice) ? dice : dice ? [{ label: "Weight", dice }] : [])) if (d?.dice) terms.push({ label: d.label, dice: d.dice });
  return terms;
}

/** The roll formula, each term tagged with its source so the dice tooltip shows it. */
export function termsFormula(terms) {
  const out = [];
  for (const t of terms) {
    if (t.dice) out.push(String(t.dice).replace(/(\d*d\d+)/g, `$1[${tag(t.label)}]`));
    else if (t.value) out.push(`${t.value}[${tag(t.label)}]`);
  }
  return (out.join(" + ") || "0").replace(/\+ -/g, "- ");
}

/** The roll's math as a line of text: every source, zero ones included. */
export function termsMath(terms) {
  return terms.map(t => `${t.label} ${t.dice ? t.dice : signed(t.value ?? 0)}${t.note ? ` (${t.note})` : ""}`).join(", ");
}

export function skillFormula(sys, skill, extra = 0, dice = "", opts = {}) {
  return termsFormula(skillTerms(sys, skill, extra, dice, opts));
}

export function skillMath(sys, skill, extra = 0, dice = "", opts = {}) {
  return `Math: ${termsMath(skillTerms(sys, skill, extra, dice, opts))}.`;
}
