/**
 * src/apps/creature-generator.js
 * Creature generator (GMG 9.1.0 to 9.3.0): pick a Threat, a CR, or a tier, a shape, and
 * Resistance, and read off the Potentials, dice, Allowance, Ceiling, Training, and
 * Resistance budget. Creates the creature Actor with its dice, Training, and Resistance set.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_KEYS, SKILL_LABEL, BEHAVIOR_TRAITS } from "../constants.js";
import { NATURAL_WEAPONS, MONSTER_FEATS, TRAITS } from "../creature-data.js";
import { TIER_THREAT, CR_CHOICES, creatureNumbers, crToThreat, differentiate, diceFor, SHAPES } from "../creature-math.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const DAMAGE_BY_TYPE = { kinetic: ["fire", "cold", "lightning", "acid", "force"], incorporeal: ["psychic", "spirit"] };
const PRIMARY_BY_GROUP = { melee: "might", grappling: "might", arcane: "wit", sonic: "presence" };
const cap = t => t.replace(/^./, c => c.toUpperCase());
const plain = doc => { const o = doc.toObject(); delete o._id; return o; };
const sameTypes = (a, b) => a.length === b.length && a.every(t => b.includes(t));

/** Load the instrument and Technique compendiums once. */
async function loadPacks() {
  const load = async key => (await game.packs.get(key)?.getDocuments()) ?? [];
  return { instruments: await load("foil.instruments"), techniques: await load("foil.techniques"), feats: await load("foil.feats") };
}

/** The three built-in Techniques a Natural Weapon builds to match its Type in the PHB Catalog (GMG 9.6.0). */
function kitFor(types, instruments) {
  const real = instruments.filter(i => !i.system.innate && i.system.category !== "tool");
  const match = real.find(i => sameTypes(i.system.types ?? [], types) && i.system.weight === "light")
    ?? real.find(i => sameTypes(i.system.types ?? [], types))
    ?? real.find(i => (i.system.types ?? []).includes(types[0]));
  return match ? foundry.utils.deepClone(match.system.kit) : [];
}

export class FoilCreatureGenerator extends HandlebarsApplicationMixin(ApplicationV2) {
  state = {
    name: "", source: "tier", threat: 0, cr: "5", tier: 4, shape: "none",
    steps: { might: 0, finesse: 0, wit: 0, presence: 0 }, train: ["prowess", ""], physical: 0, mental: 0,
    behavior: "", behaviorParam: "",
    instruments: [0, 1, 2].map(() => ({ pick: "", type: "", damage: "", primary: "" })),
    techniques: [], feats: {}, traits: []
  };
  _cache = null;

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["foil", "chargen", "creature-generator"],
    window: { title: "Creature Generator", icon: "fas fa-dragon", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { createCreature: FoilCreatureGenerator._onCreate }
  };

  static PARTS = { main: { template: "systems/foil/templates/apps/creature-generator.hbs" } };

  /** The Threat the chosen source gives. */
  _threat() {
    const s = this.state;
    if (s.source === "threat") return Number(s.threat) || 0;
    if (s.source === "cr") return crToThreat(s.cr) ?? 0;
    return TIER_THREAT[Number(s.tier)] ?? 0;
  }

  async _prepareContext() {
    const s = this.state;
    const n = creatureNumbers(this._threat());
    if (s.shape !== "custom") s.steps = { ...SHAPES[s.shape].steps };
    const diff = differentiate(n.potential, s.steps);
    const spent = 8 * (Number(s.physical) + Number(s.mental));
    const rows = ATTRIBUTE_KEYS.map(k => ({
      key: k, label: ATTR_LABEL[k], steps: s.steps[k], potential: diff.potentials[k], dice: diceFor(diff.potentials[k]).formula,
      stepChoices: [-2, -1, 0, 1, 2].map(v => ({ value: v, label: v > 0 ? `+${v}` : `${v}`, selected: v === s.steps[k] })),
      locked: s.shape !== "custom"
    }));
    const ratings = Array.from({ length: n.resistanceCap + 1 }, (_, i) => i);
    const opts = (list, cur) => list.map(v => ({ value: v, label: String(v), selected: String(v) === String(cur) }));
    const warnings = [...diff.notes];
    if (spent > n.resistanceBudget) warnings.push(`Resistance spends ${spent} of a budget of ${n.resistanceBudget}; Vulnerable can fund more (GMG 9.3.0)`);
    if (Number(s.physical) > n.resistanceCap || Number(s.mental) > n.resistanceCap) warnings.push(`Resistance is capped at +${n.resistanceCap}`);
    this._cache ??= await loadPacks();
    const packs = this._cache;
    const slots = s.instruments.map((slot, i) => {
      const nw = slot.pick.startsWith("nw:") ? NATURAL_WEAPONS.find(w => w.name === slot.pick.slice(3)) : null;
      const types = nw ? (nw.pick ? [slot.type || nw.types[0]] : nw.types)
        : (packs.instruments.find(d => d.name === slot.pick.slice(3))?.system.types ?? []);
      return {
        i, nw: !!nw,
        groups: [
          ...["melee", "grappling", "arcane", "sonic"].map(g => ({ label: `Natural: ${cap(g)}`,
            options: NATURAL_WEAPONS.filter(w => w.group === g).map(w => ({ value: `nw:${w.name}`, label: w.name, selected: slot.pick === `nw:${w.name}` })) })),
          { label: "PHB Instruments", options: packs.instruments.filter(d => !d.system.innate && d.system.category !== "tool")
            .map(d => ({ value: `ph:${d.name}`, label: d.name, selected: slot.pick === `ph:${d.name}` })) }
        ],
        typeChoices: nw?.pick ? nw.types.map(t => ({ value: t, label: cap(t), selected: (slot.type || nw.types[0]) === t })) : null,
        damageChoices: nw && types.some(t => DAMAGE_BY_TYPE[t]) ? [{ value: "", label: "No damage type", selected: !slot.damage },
          ...types.flatMap(t => DAMAGE_BY_TYPE[t] ?? []).map(d => ({ value: d, label: cap(d), selected: slot.damage === d }))] : null,
        primaryChoices: nw ? ATTRIBUTE_KEYS.map(k => ({ value: k, label: ATTR_LABEL[k], selected: (slot.primary || PRIMARY_BY_GROUP[nw.group]) === k })) : null,
        types
      };
    });
    const heldTypes = new Set(slots.flatMap(x => x.types));
    const techniques = packs.techniques.filter(d => !d.system.innate).map(d => {
      const req = d.system.requires ?? [];
      const usable = !req.length || req.some(t => heldTypes.has(t));
      return { name: d.name, xp: d.system.xpCost, usable, over: d.system.xpCost > n.ceiling, checked: s.techniques.includes(d.name) };
    }).filter(t => t.usable || t.checked).sort((a, b) => a.xp - b.xp || a.name.localeCompare(b.name));
    const featRows = MONSTER_FEATS.map(f => {
      const qty = Number(s.feats[f.name] ?? 0);
      const max = f.per === "use" ? 8 : f.per === "+1" ? 3 : f.per === "condition" ? 4 : f.per === "point" ? n.resistanceCap : 1;
      const unit = f.name === "Specialized Resistance" && s.feats[`${f.name}:scope`] === "family" ? 8 : f.xp;
      return { name: f.name, requires: f.requires, effect: f.effect, xpText: f.xpText, cost: unit * qty, over: unit * qty > n.ceiling,
        isRes: f.name === "Specialized Resistance", familyScope: s.feats[`${f.name}:scope`] === "family",
        qtyChoices: Array.from({ length: max + 1 }, (_, v) => ({ value: v, label: String(v), selected: v === qty })) };
    });
    const traitRows = TRAITS.map(t => ({ name: t.name, xp: t.xp, checked: s.traits.includes(t.name), over: t.xp > n.ceiling }));
    const spentAllowance = techniques.filter(t => t.checked).reduce((a, t) => a + t.xp, 0)
      + featRows.reduce((a, f) => a + f.cost, 0) + traitRows.filter(t => t.checked).reduce((a, t) => a + t.xp, 0);
    const picked = s.instruments.filter(x => x.pick).length;
    if (picked < 2 || picked > 3) warnings.push("Pick 2 or 3 Instruments (GMG 9.6.0)");
    if (spentAllowance > n.allowance) warnings.push(`Allowance overspent: ${spentAllowance} of ${n.allowance} XP`);
    for (const t of techniques.filter(x => x.checked && x.over)) warnings.push(`${t.name} costs more than the Ceiling of ${n.ceiling} XP`);
    for (const f of featRows.filter(x => x.over)) warnings.push(`${f.name} costs more than the Ceiling of ${n.ceiling} XP`);
    if (spentAllowance < n.allowance / 2) warnings.push("Most of the Allowance is unspent: the creature is underbuilt (GMG 9.5.0)");
    const behaviorTrait = BEHAVIOR_TRAITS.find(b => b === s.behavior);
    const skillOptions = cur => [{ value: "", label: "None", selected: !cur }, ...SKILL_KEYS.map(k => ({ value: k, label: SKILL_LABEL[k], selected: k === cur }))];
    return {
      state: s,
      n: n,
      rows: rows,
      spent: spent,
      warnings: warnings,
      total: diff.total,
      totalTarget: n.totalPotential,
      tierChoices: Object.keys(TIER_THREAT).map(t => ({ value: t, label: `Tier ${t} (Threat ${TIER_THREAT[t]})`, selected: String(t) === String(s.tier) })),
      crChoices: CR_CHOICES.map(c => ({ value: c, label: `CR ${c}`, selected: c === s.cr })),
      sourceChoices: [["tier", "Tier"], ["cr", "CR from a d20 stat block"], ["threat", "Threat"]].map(([value, label]) => ({ value, label, selected: value === s.source })),
      shapeChoices: [...Object.entries(SHAPES).map(([value, v]) => ({ value, label: v.label })), { value: "custom", label: "Custom steps" }]
        .map(c => ({ ...c, selected: c.value === s.shape })),
      resistanceChoices: { physical: opts(ratings, s.physical), mental: opts(ratings, s.mental) },
      skillA: skillOptions(s.train[0]), skillB: skillOptions(s.train[1]),
      isThreat: s.source === "threat", isCr: s.source === "cr", isTier: s.source === "tier",
      slots: slots,
      techniques: techniques,
      featRows: featRows,
      traitRows: traitRows,
      allowanceSpent: spentAllowance,
      allowanceLeft: n.allowance - spentAllowance,
      behaviorChoices: [{ value: "", label: "None (Holds)", selected: !s.behavior }, ...BEHAVIOR_TRAITS.map(b => ({ value: b, label: b, selected: b === s.behavior }))],
      behaviorNeedsParam: !!behaviorTrait && /\[/.test(behaviorTrait)
    };
  }

  _onRender() {
    if (this._bound) return;
    this._bound = true;
    this.element.addEventListener("change", ev => {
      const el = ev.target;
      const s = this.state;
      const v = el.value;
      switch (el.name) {
        case "name": s.name = v; return;
        case "source": s.source = v; break;
        case "threat": s.threat = v; break;
        case "cr": s.cr = v; break;
        case "tier": s.tier = v; break;
        case "shape": s.shape = v; break;
        case "physical": s.physical = Number(v); break;
        case "mental": s.mental = Number(v); break;
        case "trainA": s.train[0] = v; break;
        case "trainB": s.train[1] = v; break;
        case "behavior": s.behavior = v; break;
        case "behaviorParam": s.behaviorParam = v; return;
        default:
          if (el.name?.startsWith("step.")) { s.shape = "custom"; s.steps[el.name.slice(5)] = Number(v); }
          else if (el.name?.startsWith("slot.")) {
            const [, i, field] = el.name.split(".");
            const slot = s.instruments[Number(i)];
            slot[field] = v;
            if (field === "pick") { slot.type = ""; slot.damage = ""; slot.primary = ""; }
          } else if (el.name?.startsWith("tech.")) {
            const name = el.name.slice(5);
            s.techniques = el.checked ? [...new Set([...s.techniques, name])] : s.techniques.filter(x => x !== name);
          } else if (el.name?.startsWith("feat.")) {
            const name = el.name.slice(5);
            if (name.endsWith(":scope")) s.feats[name] = v; else s.feats[name] = Number(v);
          } else if (el.name?.startsWith("trait.")) {
            const name = el.name.slice(6);
            s.traits = el.checked ? [...new Set([...s.traits, name])] : s.traits.filter(x => x !== name);
          } else return;
      }
      this.render();
    });
  }

  static async _onCreate() {
    const s = this.state;
    const n = creatureNumbers(this._threat());
    const diff = differentiate(n.potential, s.steps);
    const attributes = {};
    for (const k of ATTRIBUTE_KEYS) attributes[k] = { dice: diceFor(diff.potentials[k]).counts };
    const skills = {};
    for (const k of s.train.filter(Boolean)) skills[k] = { training: n.training };
    const notes = `<p>Threat ${n.threat}, Tier ${n.tier}. Allowance ${n.allowance} XP, Ceiling ${n.ceiling} XP, Training +${n.training}, `
      + `Resistance budget ${n.resistanceBudget} (cap +${n.resistanceCap}). Spend the Allowance on Feats and Techniques (GMG 9.5.0, 9.6.0).</p>`;
    const packs = this._cache ?? await loadPacks();
    const items = [];
    for (const slot of s.instruments.filter(x => x.pick)) {
      if (slot.pick.startsWith("ph:")) {
        const doc = packs.instruments.find(d => d.name === slot.pick.slice(3));
        if (doc) items.push(plain(doc));
        continue;
      }
      const w = NATURAL_WEAPONS.find(x => x.name === slot.pick.slice(3));
      if (!w) continue;
      const types = w.pick ? [slot.type || w.types[0]] : w.types;
      items.push({
        name: w.name, type: "instrument", img: "icons/svg/claw.svg",
        system: { types, range: w.range, weight: "light", innate: true, primaryAttribute: slot.primary || PRIMARY_BY_GROUP[w.group],
          category: w.group === "sonic" ? "sonic" : w.group === "arcane" ? "arcane" : "melee", price: 0, kit: kitFor(types, packs.instruments),
          description: slot.damage ? `<p>${cap(slot.damage)} damage (GMG 9.6.1).</p>` : "" }
      });
    }
    for (const name of s.techniques) {
      const doc = packs.techniques.find(d => d.name === name);
      if (doc) items.push(plain(doc));
    }
    for (const f of MONSTER_FEATS) {
      const qty = Number(s.feats[f.name] ?? 0);
      if (!qty) continue;
      const unit = f.name === "Specialized Resistance" && s.feats[`${f.name}:scope`] === "family" ? 8 : f.xp;
      const label = f.per ? `${f.name} (${qty} ${f.per === "use" ? "uses" : f.per === "condition" ? "Conditions" : f.per === "point" ? "points" : "+" + qty})` : f.name;
      items.push({ name: label, type: "feat", img: "icons/svg/upgrade.svg", system: { featType: "trait", xpCost: unit * qty, effect: f.effect } });
    }
    for (const name of s.traits) {
      const doc = packs.techniques.find(d => d.name === name) ?? packs.feats.find(d => d.name === name);
      if (doc) items.push(plain(doc));
      else items.push({ name, type: "feat", img: "icons/svg/upgrade.svg", system: { featType: "trait", xpCost: TRAITS.find(t => t.name === name)?.xp ?? 0, effect: "A Trait (PHB 7.2.3)." } });
    }
    const behavior = s.behavior ? (s.behaviorParam ? s.behavior.replace(/\[[^\]]*\]/, `[${s.behaviorParam}]`) : s.behavior) : "";
    const actor = await Actor.create({
      name: s.name || "New Creature", type: "creature",
      system: { tier: n.tier, cr: s.source === "cr" ? s.cr : "", behavior, attributes, skills, resistance: { physical: Number(s.physical), mental: Number(s.mental) }, notes },
      items
    });
    ui.notifications?.info(`${actor.name} created at Tier ${n.tier}.`);
    actor.sheet?.render(true);
    this.close();
  }
}

/** Open the generator. */
export function openCreatureGenerator() {
  new FoilCreatureGenerator().render(true);
}
