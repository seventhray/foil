/**
 * tools/creature-block.mjs
 * Reads a creature note's stat block from its `## Data` yaml block (vault Tools/creature_data.py writes it).
 * calloutText() renders the [!creature] callout from that block, and falls back to the callout as written
 * for a note without one. The rendering matches creature_data.py line for line; verify-bestiary-block.mjs
 * checks it against every note.
 */
import { load as yamlLoad } from "js-yaml";

const ATTRS = ["might", "finesse", "wit", "presence"];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const signed = n => (n < 0 ? `${n}` : `+${n}`);

export function readBlock(text) {
  const m = text.match(/\n## Data\n\n```yaml\n([\s\S]*?)```\n?$/);
  return m ? yamlLoad(m[1]) : null;
}

function renderLine(d) {
  switch (d.kind) {
    case "raw": return d.text;
    case "base": return `**${d.name}** (${d.source ?? "GMG 9.6.0"}): Stress through a ${d.weight} ${d.type} Instrument${d.note ? ` (${d.note})` : ""}, part of its baseline kit.`;
    case "natural_weapon": return `**${d.name}** (GMG 9.6.1): ${d.weight} ${d.type} Instrument, Range ${d.range}, built-in Techniques free${d.note ? ` (${d.note})` : ""}.`;
    case "innate": return `**${d.name}** (PHB 2.5.3): innate Instrument, built-in Techniques free.`;
    case "evade": return `**${d.name}**: Evade, 4 XP (None). Moves ${d.moves} without spending the Disengage Quick Action.`;
    case "legendary_action": return `**Legendary Action** (${d.uses} uses, ${d.xp} XP, 9.5.1): ${d.text}`;
    case "tool_instrument": case "gear": return `**${d.name}** (${d.source}): ${d.text}`;
    case "trait": return `**${d.name}** (Trait, ${d.xp} XP, 9.5.0): ${d.text}`;
    case "technique": {
      const art = "AEIOU".includes(d.type[0]) ? "an" : "a";
      return `**${d.name}**: ${d.effect} through ${art} ${d.type} Instrument${d.via ? ` (${d.via})` : ""}, ${d.xp} XP${d.strain ? `, Strain ${d.strain}` : ""}.${d.note ? ` ${d.note}` : ""}`;
    }
    case "specialized_resistance": return `**Specialized Resistance** (${d.scope} +${d.points}, 9.5.1): ${d.xp} XP, ${d.why}.`;
    case "feat": return `**${d.name}** (${d.xp} XP, ${d.source}): ${d.text}`;
    default: throw new Error(`unknown line kind ${d.kind}`);
  }
}

export function renderCallout(d) {
  const dice = a => `${d.attributes[a].dice.join("+")} (${d.attributes[a].potential})`;
  const out = [`> [!creature]${d.fold} ${d.name}`, `> *Tier ${d.tier}. ${d.concept}*`, ">",
    "> " + ATTRS.map(a => `**${cap(a)}** ${dice(a)}`).join(" · ")];
  let res = "";
  if (d.resistance) {
    const r = Object.entries(d.resistance).map(([k, v]) => `${k} ${signed(v)}`).join(", ") || "+0";
    res = ` · **Resistance** ${r}${d.resistance_why ? ` (${d.resistance_why})` : ""}`;
  }
  const a = d.actions, q = d.quick_actions;
  out.push(`> **Total Potential** ${d.total_potential}${res} · **${a} Action${a !== 1 ? "s" : ""}, ${q} Quick Action${q !== 1 ? "s" : ""}**`);
  if (d.training) out.push("> **Training** " + Object.entries(d.training).map(([k, v]) => `${k} +${v}`).join(", "));
  out.push("> **Behavior** " + d.behavior.join(", "));
  if (d.habits_text) out.push("> **Habits** " + d.habits_text);
  out.push(">");
  for (const t of d.techniques) out.push(`> - ${renderLine(t)}`);
  if (d.feats?.length) {
    out.push(">", "> **Feats**", ">");
    for (const t of d.feats) out.push(`> - ${renderLine(t)}`);
  }
  return out.join("\n");
}

/** The stat block text a seeder should read: from the Data block when the note has one, else as written. */
export function calloutText(text) {
  const d = readBlock(text);
  if (d) return renderCallout(d);
  const i = text.indexOf("> [!creature]");
  return i < 0 ? "" : text.slice(i, text.indexOf("### Behaviour"));
}
