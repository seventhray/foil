/**
 * tools/seed-bestiary.mjs
 * Turns the built creature notes (Campaign/Creatures in the vault) into creature actors.
 * populate-packs.mjs calls bestiaryDocs() with its own item builders, so a creature's
 * Instruments, Techniques, and Feats are the same documents the other packs hold.
 * A creature's stat block is read from its `## Data` block (creature-block.mjs). Scenario NPCs
 * (Campaign/Characters/NPCs) are left out.
 */

import fs from "node:fs";
import path from "node:path";
import { BOOKS } from "./books.mjs";
import { NATURAL_WEAPONS } from "../src/creature-data.js";
import { RANGE_STEP } from "../rules/constants.js";
import { currentTypes, meetsRequirement } from "../rules/types.js";
import { RESISTANCE_TYPES } from "../rules/resist.js";
import { calloutText } from "./creature-block.mjs";

export const CREATURES_DIR = process.env.FOIL_BESTIARY ?? path.join(BOOKS, "..", "Campaign", "Creatures");
const lc = s => String(s).toLowerCase();
const PRIMARY_BY_GROUP = { melee: "might", grappling: "might", arcane: "wit", sonic: "presence", ranged: "finesse" };
const ATTRS = ["might", "finesse", "wit", "presence"];

function diceOf(text) {
  const dice = { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 0 };
  for (const [, n, size] of String(text).matchAll(/(\d+)d(\d+)/g)) dice[`d${size}`] = (dice[`d${size}`] ?? 0) + Number(n);
  const potential = Number(String(text).match(/\((\d+)\)/)?.[1] ?? 0);
  return { dice, potential: { current: potential }, incapacitated: false };
}

/**
 * @param {object} lib  { instruments, techniques, feats, techniqueDoc } from populate-packs.mjs
 * @returns {{ actors: object[], notes: string[] }}
 */
export function bestiaryDocs(lib) {
  const notes = [], actors = [];
  if (!fs.existsSync(CREATURES_DIR)) return { actors, notes: [`Bestiary: ${CREATURES_DIR} not found`] };
  const byName = list => new Map(list.map(d => [lc(d.name), d]));
  const inst = byName(lib.instruments), tech = byName(lib.techniques), feat = byName(lib.feats);
  const clone = d => JSON.parse(JSON.stringify(d));
  // A natural weapon's built-ins are its GMG 9.6.1 row's, by name, each with the effect a Catalog Instrument's move of that name has.
  // The first sits on Prowess (Discipline for Wit), the second, its signature, on the Primary's other action Skill, and it backs
  // the Voice Technique its Primary does (PHB 4.1.3): Might Threaten, Finesse Deceive, Wit Persuade.
  const moves = lib.instruments.flatMap(i => i.system.kit ?? []);
  const OTHER = { might: "discipline", finesse: "acuity", wit: "acuity", presence: "guile" };
  const BACKS = { might: "Threaten", finesse: "Deceive", wit: "Persuade" };
  // An Arcane one instead comes with one Technique that deals Stress through it (GMG 9.6.0), or Life-Fount's one that mends: a
  // built-in named for the weapon, on Discipline, harming what its Property harms.
  const ownMove = (name, types, grants) => grants === "mend"
    ? { name, skill: "resonance", effect: "Mends 1d4 Stress on an ally's Attribute." }
    : { name, skill: "discipline", effect: `Deals Stress to ${types.includes("incorporeal") ? "Wit or Presence" : "Might or Finesse"}.` };
  const natural = (name, typesText, { range = "", weight = "light", note = "", grants = "" } = {}) => {
    // Its GMG row by name, or by the row's name at the end of its own ("Lion's Claws" is Claws).
    const w = NATURAL_WEAPONS.find(x => x.name === name) ?? NATURAL_WEAPONS.find(x => new RegExp(`\\b${x.name}$`, "i").test(name));
    const types = typesText ? currentTypes(String(typesText).split(/,\s*/).map(lc)) : w?.types ?? ["melee"];
    const group = w?.group ?? (types.includes("arcane") ? "arcane" : types.includes("sonic") ? "sonic" : types.includes("ranged") ? "ranged" : "melee");
    const primary = PRIMARY_BY_GROUP[group] ?? "might";
    const free = w?.grants || grants || "";
    const kit = free ? [ownMove(name, types, free)] : (w?.builtins ?? []).map((n, i) => {
      const effect = moves.find(k => k.name === n)?.effect;
      if (!effect) notes.push(`${name}: no Catalog move named ${n} for its built-ins (GMG 9.6.1)`);
      return { name: n, skill: i === 0 ? (primary === "wit" ? "discipline" : "prowess") : OTHER[primary] ?? "discipline", effect: effect ?? "", ...(i > 0 ? { signature: true } : {}) };
    });
    const band = range ? Object.keys(RANGE_STEP).find(k => RANGE_STEP[k] === Number(range)) : "";
    return { name, type: "instrument", img: "icons/svg/claw.svg",
      system: { types, range: range ? `Range ${range}` : w?.range ?? "Range 1", ...(band ? { maxRange: band } : {}), weight: lc(weight), innate: true, location: "equipped", primaryAttribute: primary,
        category: group === "sonic" ? "sonic" : group === "arcane" ? "arcane" : group === "ranged" ? "ranged" : "melee", price: 0, kit,
        backs: kit.length && ["melee", "ranged", "grappling"].includes(group) ? BACKS[primary] ?? "" : "",
        description: note ? `<p>${note}.</p>` : "" } };
  };
  // "Melee", "Melee or Grappling", "Kinetic or Incorporeal", and "Melee Instrument with Guarding" (both) as Requirement keys.
  const requiresOf = (phrase, withProp) => {
    const alts = String(phrase).split(/\s+or\s+/).map(x => lc(x.trim()).replace(/^tools$/, "tool"));
    return withProp ? alts.map(a => `${lc(withProp)}+${a}`) : alts;
  };

  for (const file of fs.readdirSync(CREATURES_DIR).filter(f => f.endsWith(".md")).sort()) {
    const s = fs.readFileSync(path.join(CREATURES_DIR, file), "utf8");
    const front = k => s.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim() ?? "";
    if (!front("tier") || /not yet built/.test(s)) continue;
    const name = file.slice(0, -3);
    const block = calloutText(s);          // from the note's Data block, else the callout as written
    const line = k => block.match(new RegExp(`\\*\\*${k}\\*\\*\\s*([^·\\n]*)`))?.[1].trim() ?? "";
    const attributes = Object.fromEntries(ATTRS.map(a => [a, diceOf(front(a))]));
    const skills = {};
    for (const [, sk, n] of line("Training").matchAll(/(\w+) \+(\d+)/g)) skills[lc(sk)] = { training: Number(n) };
    const resistance = { physical: 0, mental: 0 };
    for (const [, kind, n] of line("Resistance").matchAll(/(physical|mental) ([+-]\d+)/g)) resistance[kind] = Number(n);
    const concept = block.match(/^> \*Tier \d+\. (.+?)\*\s*$/m)?.[1] ?? "";
    const behaviour = s.match(/### Behaviour\n([\s\S]*?)\n\n## Notes/)?.[1].trim() ?? "";
    const habits = line("Habits");

    const items = [];
    for (const [, head, line] of block.matchAll(/^>\s*-\s*\*\*([^*]+)\*\*(.*)$/gm)) {
      const base = head.replace(/\s*\(.*\)$/, "").trim();
      // A creature Technique names the Skill it rolls (GMG 9.7.0): "**Bark an Order** (Assertiveness): ...".
      const named = line.match(/^ \((Prowess|Discipline|Assertiveness|Acuity|Guile|Resonance)\)(?=:)/);
      const skill = named ? lc(named[1]) : "";
      const rest = named ? line.slice(named[0].length) : line;
      const withSkill = d => { if (skill) d.system.skill = skill; return d; };
      const xp = Number(rest.match(/(\d+)\s*XP/)?.[1] ?? 0);
      const strain = rest.match(/Strain (\d+)/);
      if (/innate Instrument/.test(rest)) { const d = inst.get(lc(base)); if (d) items.push(clone(d)); continue; }
      // An Instrument: a natural weapon "(GMG 9.6.1): Light Melee, Grappling Instrument, Range 0, ...", or a Catalog one
      // "(PHB 7.4.1[, as a Mace]): ... Instrument, Range 1 ..." under the creature's own name.
      const held = rest.match(/^ \((GMG 9\.6\.[01]|PHB [\d.]+)(?:, as an? ([^)]+))?\): (?:an? )?(?:(Light|Medium|Heavy) )?(.+?) Instrument, Range (\d+)(?:, built-in Techniques free|, one (\w+) Technique free)?(?: \(([^)]*)\))?\.$/);
      if (held) {
        const [, source, alias, weight, typesText, range, grants, note] = held;
        const phb = /^PHB/.test(source) ? inst.get(lc(alias ?? head)) : null;
        // A creature fights with what its stat block lists, ready (PHB 4.1.0).
        if (phb) { const d = clone(phb); d.name = head.trim(); d.system.location = "equipped"; items.push(d); continue; }
        if (/^PHB/.test(source)) notes.push(`${name}: no Catalog Instrument ${alias ?? head}`);
        items.push(natural(head.trim(), typesText.replace(/ \[[^\]]*\]/g, ""), { range, weight: weight ?? "light", note: note ?? "", grants: lc(grants ?? "") }));
        continue;
      }
      // Specialized Resistance (GMG 9.5.1): a narrow Resistance the rules apply (rules/resist.js), "(Melee +2, 9.5.1)".
      // One scope or several on one line: "(Melee +2, 9.5.1)", "(Kinetic +3, Incorporeal +1, 9.5.1)".
      const narrow = rest.match(/^ \(([^)]*), 9\.5\.1\): (\d+) XP, (.+?)\.?$/);
      const pairs = narrow ? [...narrow[1].matchAll(/(\w+) \+(\d+)/g)].map(m => [m[1], Number(m[2])]) : [];
      if (base === "Specialized Resistance" && pairs.length) {
        for (const [k] of pairs) if (!RESISTANCE_TYPES.includes(lc(k))) notes.push(`${name}: Specialized Resistance names ${k}, which no attack has`);
        const scopes = pairs.map(([k, n]) => `${k} +${n}`).join(", ");
        items.push({ name: `Specialized Resistance (${pairs.map(([k]) => k).join(", ")})`, type: "feat", img: "icons/svg/upgrade.svg",
          system: { featType: "trait", xpCost: Number(narrow[2]), requirements: "", effect: `${scopes} Resistance: ${narrow[3]}.`, ancestry: "", grantsTechnique: "",
            modifiers: pairs.map(([k, n]) => ({ type: "resistance", key: lc(k), value: n })), description: "" } });
        continue;
      }
      const through = rest.match(/ through an? ([A-Z][A-Za-z ]*?) Instrument(?: with ([A-Z]\w+))?(?: \(([^)]*)\))?, \d+ XP/);
      if (/^: /.test(rest) && (through || /Evade/.test(rest))) {
        // A Catalog Technique as the Catalog has it; an Origin's or a Transformation's Innate gift of the same name stays the creature's own.
        const known = tech.get(lc(head)) ?? tech.get(lc(base));
        if (known && !known.system.innate) { items.push(withSkill(clone(known))); continue; }
        const effect = rest.replace(/^: /, "").replace(/ through an? .*$/, "").replace(/, \d+ XP.*$/, "").trim() + (strain ? `, Strain ${strain[1]}` : "");
        // The stat blocks and GMG 9.7.1 spell some Effects differently from the Catalog; read them the same way.
        const norm = effect.replace(/Pattern /g, "")
          .replace(/Condition:? \(?(\w+)\)?/g, "$1").replace(/Stress to that attacker[^,]*(, as if [^,]*)?/, "Stress").replace(/,\s*,/g, ",").replace(/,\s*$/, "");
        const req = through ? requiresOf(through[1], through[2]).map(r => r.split("+").map(k => k.replace(/^./, c => c.toUpperCase())).join(" and ")).join(" or ") : "None";
        const doc = lib.techniqueDoc({ name: head.trim(), requires: req, effect: norm, xp: xp || null, strain: strain ? Number(strain[1]) : undefined });
        items.push(withSkill(doc));
        continue;
      }
      // Everything else is a Feat or Trait line: "(N XP, GMG 9.5.1): text", "(Trait, N XP, 9.5.0): text".
      const known = feat.get(lc(base));
      const text = rest.replace(/^\s*\([^)]*\):\s*/, "").replace(/^:\s*/, "").trim();
      if (known && /PHB 7\.2\.2/.test(rest)) { items.push(clone(known)); continue; }
      items.push({ name: head.trim(), type: "feat", img: "icons/svg/upgrade.svg",
        system: { featType: "trait", xpCost: xp, requirements: "", effect: text, ancestry: "", grantsTechnique: "", modifiers: [], description: "" } });
    }
    // Each Technique needs an Instrument that meets its Requirement (PHB 4.2.0). A stat block names its carriers; one that names
    // none for a Sonic Technique has the Voice, else the note is warned about.
    const carriers = () => items.filter(i => i.type === "instrument");
    for (const t of items.filter(i => i.type === "technique" && !i.system.innate && (i.system.requires ?? []).length)) {
      if (carriers().some(i => meetsRequirement(i.system.types ?? [], t.system.requires, { category: i.system.category }))) continue;
      if (t.system.requires.includes("sonic") && inst.get("voice")) { items.unshift(clone(inst.get("voice"))); continue; }
      notes.push(`${name}: ${t.name} needs ${t.system.requires.join(" or ")}, and no Instrument on its stat block has it`);
    }
    // A Shield's Resistance applies while it is carried (PHB 5.2.4). A stat block whose Resistance line counts it already ("mail and a
    // shield") has its base lowered by the Shield's, so the total stays the stat block's.
    if (/shield/i.test(line("Resistance"))) for (const sh of items.filter(i => i.type === "instrument" && i.system.category === "shield"))
      for (const q of sh.system.qualities ?? []) if (q.key === "resistance" && q.param in resistance) resistance[q.param] -= Number(q.value) || 0;
    if (!items.some(i => i.type === "instrument")) notes.push(`${name}: no Instrument read from its stat block`);
    actors.push({
      name, type: "creature", img: "icons/svg/mystery-man.svg", tier: Number(front("tier")),
      system: { tier: Number(front("tier")), threat: Number(front("threat")) || 0, behavior: line("Behavior"),
        attributes, skills, resistance,
        notes: `<p><em>${concept}</em></p>${habits ? `<p><strong>Habits</strong> ${habits}</p>` : ""}${behaviour ? `<p>${behaviour}</p>` : ""}` },
      items
    });
  }
  return { actors, notes };
}
