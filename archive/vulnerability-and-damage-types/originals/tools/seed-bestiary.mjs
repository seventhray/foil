/**
 * tools/seed-bestiary.mjs
 * Turns the built creature notes (Campaign/Creatures in the vault) into creature actors.
 * populate-packs.mjs calls bestiaryDocs() with its own item builders, so a creature's
 * Instruments, Techniques, and Feats are the same documents the other packs hold.
 * Scenario NPCs (Campaign/Characters/NPCs) are left out.
 */

import fs from "node:fs";
import path from "node:path";
import { BOOKS } from "./books.mjs";
import { NATURAL_WEAPONS } from "../src/creature-data.js";

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
  const kitFor = types => {
    const real = lib.instruments.filter(i => !i.system.innate && i.system.category !== "tool");
    const has = (i, t) => (i.system.types ?? []).includes(t);
    const m = real.find(i => types.every(t => has(i, t)) && i.system.weight === "light") ?? real.find(i => types.every(t => has(i, t))) ?? real.find(i => has(i, types[0]));
    return m ? clone(m.system.kit) : [];
  };
  const natural = (name, type, note) => {
    const w = NATURAL_WEAPONS.find(x => x.name === name);
    const types = [lc(type)];
    const group = w?.group ?? (["kinetic", "incorporeal", "fortifying"].includes(types[0]) ? "arcane" : types[0] === "sonic" ? "sonic" : "melee");
    return { name, type: "instrument", img: "icons/svg/claw.svg",
      system: { types, range: w?.range ?? "Close", weight: "light", innate: true, primaryAttribute: PRIMARY_BY_GROUP[group] ?? "might",
        category: group === "sonic" ? "sonic" : group === "arcane" ? "arcane" : "melee", price: 0, kit: kitFor(types),
        description: note ? `<p>${note}.</p>` : "" } };
  };

  for (const file of fs.readdirSync(CREATURES_DIR).filter(f => f.endsWith(".md")).sort()) {
    const s = fs.readFileSync(path.join(CREATURES_DIR, file), "utf8");
    const front = k => s.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim() ?? "";
    if (!front("tier") || /not yet built/.test(s)) continue;
    const name = file.slice(0, -3);
    const block = s.slice(s.indexOf("> [!creature]"), s.indexOf("### Behaviour"));
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
    for (const [, head, rest] of block.matchAll(/^>\s*-\s*\*\*([^*]+)\*\*(.*)$/gm)) {
      const base = head.replace(/\s*\(.*\)$/, "").trim();
      const xp = Number(rest.match(/(\d+)\s*XP/)?.[1] ?? 0);
      const weightWord = rest.match(/through an? (Medium|Heavy) /)?.[1];
      const through = rest.match(/through an? (?:(?:Light|Medium|Heavy) )?(\w+)(?: or \w+)? Instrument(?: \(([^)]*)\))?/);
      const strain = rest.match(/Strain (\d+)/);
      if (/innate Instrument/.test(rest)) { const d = inst.get(lc(base)); if (d) items.push(clone(d)); continue; }
      if (/part of its baseline kit|built-in Techniques free|Blocking Instrument/.test(rest)) {
        const phb = inst.get(lc(base));
        const type = through?.[1] ?? rest.match(/\): (?:(?:Light|Medium|Heavy) )?(\w+) Instrument/)?.[1] ?? "Blunt";
        if (phb && !NATURAL_WEAPONS.some(w => w.name === base)) items.push(clone(phb));
        else { const it = natural(base, type, through?.[2] ?? ""); if (weightWord) { it.system.weight = lc(weightWord); it.system.innate = false; } items.push(it); }
        continue;
      }
      if (/^: /.test(rest) && (through || /Evade/.test(rest))) {
        const known = tech.get(lc(base));
        if (known) { items.push(clone(known)); continue; }
        const effect = rest.replace(/^: /, "").replace(/ through an? .*$/, "").replace(/, \d+ XP.*$/, "").trim() + (strain ? `, Strain ${strain[1]}` : "");
        // The stat blocks and GMG 9.7.1 spell some Effects differently from the Catalog; read them the same way.
        const norm = effect.replace(/Pattern /g, "").replace(/ Range\)/g, ")").replace(/\b(Beam|Cone|Radius|Wall),? (Close|Near|Short|Mid|Long)\b/g, "$1 ($2)")
          .replace(/Condition:? \(?(\w+)\)?/g, "$1").replace(/Stress to that attacker[^,]*(, as if [^,]*)?/, "Stress").replace(/,\s*,/g, ",").replace(/,\s*$/, "");
        const doc = lib.techniqueDoc({ name: base, requires: through ? through[1] : "None", effect: norm, xp: xp || null, strain: strain ? Number(strain[1]) : undefined });
        items.push(doc);
        continue;
      }
      // Everything else is a Feat or Trait line: "(N XP, GMG 9.5.1): text", "(Trait, N XP, 9.5.0): text", Specialized Resistance.
      const known = feat.get(lc(base));
      const text = rest.replace(/^\s*\([^)]*\):\s*/, "").replace(/^:\s*/, "").trim();
      if (known && /PHB 7\.2\.2/.test(rest)) { items.push(clone(known)); continue; }
      items.push({ name: head.trim(), type: "feat", img: "icons/svg/upgrade.svg",
        system: { featType: "trait", xpCost: xp, requirements: "", effect: text, ancestry: "", grantsTechnique: "", modifiers: [], description: "" } });
    }
    // A Technique needs an Instrument of its Type. Where the stat block names none, the Voice, the Mind,
    // or a natural weapon of that Type carries it.
    const held = () => new Set(items.filter(i => i.type === "instrument").flatMap(i => i.system.types ?? []));
    for (const [, type, via] of block.matchAll(/through an? (?:(?:Light|Medium|Heavy) )?(\w+)(?: or \w+)? Instrument(?: \(([^)]*)\))?/g)) {
      const t = lc(type);
      if (held().has(t) || ["parry", "ranged"].includes(t)) continue;
      const innate = t === "sonic" ? "voice" : t === "incorporeal" && /Mind/.test(via ?? "") ? "mind" : null;
      if (innate && inst.get(innate)) { items.unshift(clone(inst.get(innate))); continue; }
      const label = (via ?? "").split(",")[0].replace(/^(its|a|an|the) (own )?/i, "").trim();
      items.unshift(natural(label ? label.charAt(0).toUpperCase() + label.slice(1) : `${type} attack`, type, ""));
    }
    if (!items.some(i => i.type === "instrument")) notes.push(`${name}: no Instrument read from its stat block`);
    actors.push({
      name, type: "creature", img: "icons/svg/mystery-man.svg", tier: Number(front("tier")),
      system: { tier: Number(front("tier")), threat: Number(front("threat")) || 0, behavior: line("Behavior"), vulnerabilities: [],
        attributes, skills, resistance,
        notes: `<p><em>${concept}</em></p>${habits ? `<p><strong>Habits</strong> ${habits}</p>` : ""}${behaviour ? `<p>${behaviour}</p>` : ""}` },
      items
    });
  }
  return { actors, notes };
}
