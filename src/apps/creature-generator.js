/**
 * src/apps/creature-generator.js
 * Creature generator (GMG 9.1.0 to 9.3.0): pick a Threat, a CR, or a tier, a shape, and
 * Resistance, and read off the Potentials, dice, Allowance, Ceiling, Training, and
 * Resistance budget. Creates the creature Actor with its dice, Training, and Resistance set.
 */

import { ATTRIBUTE_KEYS, ATTR_LABEL, SKILL_KEYS, SKILL_LABEL } from "../constants.js";
import { TIER_THREAT, CR_CHOICES, creatureNumbers, crToThreat, differentiate, diceFor, SHAPES } from "../creature-math.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class FoilCreatureGenerator extends HandlebarsApplicationMixin(ApplicationV2) {
  state = {
    name: "", source: "tier", threat: 0, cr: "5", tier: 4, shape: "none",
    steps: { might: 0, finesse: 0, wit: 0, presence: 0 }, train: ["prowess", ""], physical: 0, mental: 0
  };

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
      isThreat: s.source === "threat", isCr: s.source === "cr", isTier: s.source === "tier"
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
        default:
          if (el.name?.startsWith("step.")) { s.shape = "custom"; s.steps[el.name.slice(5)] = Number(v); }
          else return;
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
    const actor = await Actor.create({
      name: s.name || "New Creature", type: "creature",
      system: { tier: n.tier, cr: s.source === "cr" ? s.cr : "", attributes, skills, resistance: { physical: Number(s.physical), mental: Number(s.mental) }, notes }
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
