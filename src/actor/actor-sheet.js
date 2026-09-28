/**
 * src/actor/actor-sheet.js
 * FoilCharacterSheet / FoilCreatureSheet — HandlebarsApplicationMixin(ActorSheetV2).
 * Faithful to pen-and-paper: the sheet computes derived values and clicking an
 * Attribute or Aptitude rolls its pool to chat. Opposed rolls and the
 * defender's Stress are still fully manual (read the dice, apply by hand);
 * the two exceptions are a Technique's own Strain, which is self-Stress the
 * rulebook already resolves without input from the target, so it's applied
 * automatically to the chosen Attribute, and a "Roll Stress" follow-up button
 * on a Technique's chat card for convenience.
 */

import { APTITUDE_ATTRS, EQUIPMENT_CATEGORY_LABEL } from "../constants.js";
import { typeLabels, equipmentSummary, effectMap, instrumentTypeMap } from "../registry.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const ActorSheetV2Base = foundry.applications.sheets.ActorSheetV2;

const ATTR_LABEL = {
  might: "Might", finesse: "Finesse", wit: "Wit", presence: "Presence"
};

const APT_LABEL = {
  prowess: "Prowess", fortitude: "Fortitude", command: "Command",
  acuity: "Acuity", guile: "Guile", resonance: "Resonance"
};

const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";

// FOIL axes: + pole and − pole labels (see rulebook 3.1.0).
const FOIL_AXES = [
  { key: "faith",         label: "Faith",         pos: "Trusting",   neg: "Mistrusting" },
  { key: "order",         label: "Order",         pos: "Ordered",    neg: "Disordered" },
  { key: "individualism", label: "Individualism", pos: "Individual", neg: "Communal" },
  { key: "levity",        label: "Levity",        pos: "Light",      neg: "Grave" }
];

/** Shared rolling + context helpers for both actor types. */
class FoilActorSheet extends HandlebarsApplicationMixin(ActorSheetV2Base) {

  static DEFAULT_OPTIONS = {
    classes: ["foil", "sheet", "actor"],
    window: { resizable: true },
    position: { width: 860, height: 680 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollAttribute:  FoilActorSheet._onRollAttribute,
      rollAptitude:   FoilActorSheet._onRollAptitude,
      rollTechnique:  FoilActorSheet._onRollTechnique,
      rollInstrument: FoilActorSheet._onRollInstrument,
      rollEnchantment: FoilActorSheet._onRollEnchantment,
      generateCharacter: FoilActorSheet._onGenerateCharacter,
      openAdvancement: FoilActorSheet._onOpenAdvancement,
      rest:          FoilActorSheet._onRest,
      createItem:    FoilActorSheet._onCreateItem,
      editItem:      FoilActorSheet._onEditItem,
      deleteItem:    FoilActorSheet._onDeleteItem
    }
  };

  /** Attributes laid out for the stat table. */
  _attributeRows() {
    const attrs = this.actor.system.attributes ?? {};
    return Object.keys(ATTR_LABEL).map(key => {
      const a = attrs[key] ?? {};
      return {
        key,
        label:           ATTR_LABEL[key],
        dice:            a.dice ?? {},
        diceFormula:     a.diceFormula ?? "",
        potentialCurrent: a.potential?.current ?? 0,
        potentialMax:     a.potential?.max ?? 0,
        kind:             a.kind ?? "",
        incapacitated:   !!a.incapacitated,
        validPool:       a.validPool !== false
      };
    });
  }

  /** Aptitudes laid out for the lower table. */
  _aptitudeRows() {
    const apts = this.actor.system.aptitudes ?? {};
    return Object.keys(APT_LABEL).map(key => {
      const ap   = apts[key] ?? {};
      const pair = APTITUDE_ATTRS[key];
      return {
        key,
        label:        APT_LABEL[key],
        pairLabel:    `${ATTR_LABEL[pair[0]]} + ${ATTR_LABEL[pair[1]]}`,
        training:     ap.trainingBase ?? ap.training ?? 0,
        trainingTotal: ap.trainingTotal ?? ap.training ?? 0,
        trainingBonus: ap.trainingBonus ?? 0,
        netPotential: ap.netPotential ?? 0,
        rollMin:      ap.rollMin ?? 0,
        // one decimal only when the average isn't whole; every 2-die pool is
        rollAvg:      Number.isInteger(ap.rollAvg ?? 0) ? (ap.rollAvg ?? 0) : (ap.rollAvg ?? 0).toFixed(1),
        rollMax:      ap.rollMax ?? 0
      };
    });
  }

  /** FOIL axes laid out for the sheet, shared by characters and creatures alike. */
  _foilRows() {
    const sys = this.actor.system;
    return FOIL_AXES.map(axis => {
      const value = Number(sys.foil?.[axis.key] ?? 0);
      return {
        ...axis,
        value,
        magnitude: Math.abs(value),
        isOrder:   axis.key === "order",
        // Every axis moves a flat 1 point (PHB §3.2.0); nothing to derive.
      };
    });
  }

  /**
   * Items embedded on this actor, split by type and decorated with registry-
   * resolved display strings (labels for referenced Instrument Types, composed
   * effect/quality summaries) — resolved here at render time, where the registry
   * is built.
   */
  _itemGroups() {
    const groups = { origin: [], background: [], instrument: [], technique: [], feat: [], equipment: [] };
    const effM = effectMap();
    for (const item of this.actor.items) {
      if (!(item.type in groups)) continue;
      const s = item.system;
      const view = { id: item.id, name: item.name, img: item.img, system: s };
      if (item.type === "instrument") {
        view.typeLabelStr = typeLabels(s.types ?? []).join(", ");
        view.enchanted = !!s.enchantment?.enabled;
        view.enchantmentSummary = s.enchantment?.effectSummary ?? "";
      } else if (item.type === "technique") {
        view.requiresLabel = (s.requires ?? []).length ? typeLabels(s.requires).join(" / ") : "Any";
        view.effectDisplay = s.effectSummary || s.effectText || (s.pricingBreakdown ?? []).map(b => b.label).join(", ");
        // Auto-derived from the required Instrument Type(s) (PHB §5.2.1, §7.11.1):
        // the Aptitude rolled to attack, the Attribute(s) it can target, and the
        // Aptitude(s) a defender Opposes with.
        view.aptitudeLabel = cap(s.aptitudeDisplay);
        view.targetLabel = s.targetDisplay || "—";
        view.opposeLabel = s.opposeDisplay || "—";
      } else if (item.type === "equipment") {
        view.categoryLabel = EQUIPMENT_CATEGORY_LABEL[s.category] ?? "";
        view.effectSummary = equipmentSummary(s);
      }
      groups[item.type].push(view);
    }
    for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  // ─── Rolling ──────────────────────────────────────────────────────────────

  /** Roll a single Attribute pool to chat. */
  static async _onRollAttribute(event, target) {
    const key = target.dataset.key;
    const a   = this.actor.system.attributes?.[key];
    if (!a?.diceFormula) return;
    await this._postRoll(a.diceFormula, `${ATTR_LABEL[key]} check`,
      a.incapacitated ? `${ATTR_LABEL[key]} is incapacitated (contributes 0 dice).` : "");
  }

  /**
   * Roll an Aptitude: both contributing Attribute pools plus Training. An
   * incapacitated Attribute contributes 0 dice (rulebook 6.7.0), so its pool is
   * dropped from the formula and noted.
   */
  static async _onRollAptitude(event, target) {
    const key = target.dataset.key;
    const pair = APTITUDE_ATTRS[key];
    const sys  = this.actor.system;
    const apt  = sys.aptitudes?.[key] ?? {};

    // Use the single derived formula (prepareCore already folds in Training
    // totals and drops incapacitated Attributes) rather than rebuilding it.
    const formula = apt.formula || "0";

    const dropped = pair.filter(ak => {
      const a = sys.attributes?.[ak];
      return a?.diceFormula && a.incapacitated;
    }).map(ak => ATTR_LABEL[ak]);
    const bonus = Number(apt.trainingBonus ?? 0);
    const notes = [];
    if (dropped.length) notes.push(`${dropped.join(" and ")} incapacitated — 0 dice contributed.`);
    if (bonus) notes.push(`includes +${bonus} Training from items`);

    await this._postRoll(formula, `${APT_LABEL[key]} check`, notes.join(" · "));
  }

  /**
   * Roll a Technique as a Strike. The player picks a valid Instrument (one that
   * carries the Technique's required Quality) to wield it; the roll is the
   * Technique's Aptitude pool plus the Instrument's Strike modifier. For Arcane
   * Techniques whose casting Aptitude varies, the player also picks the Aptitude.
   * Weight, Pierce, effect, and Self-cost are reported for hand resolution.
   */
  static async _onRollTechnique(event, target) {
    const id   = target.closest("[data-item-id]")?.dataset.itemId;
    const tech = this.actor.items.get(id);
    if (!tech) return;
    const sys  = tech.system;

    // A Technique requires a set of Instrument Type slugs (any one of). Empty
    // means it can be wielded through any Instrument (rulebook §7.11.1 / §7.6.0).
    // A shield is stored as equipment for its passive Qualities, but is also a
    // Blocking Instrument (PHB §7.5.2), so it can wield a Blocking Technique.
    const reqKeys = Array.isArray(sys.requires) ? sys.requires : [];
    const anyType = reqKeys.length === 0;
    const valid = this.actor.items.filter(i => {
      if (i.type === "instrument") {
        return anyType || reqKeys.some(k => i.system.types?.includes(k));
      }
      if (i.type === "equipment" && i.system.category === "shield") {
        return reqKeys.includes("blocking");
      }
      return false;
    });

    if (!valid.length) {
      const need = reqKeys.map(cap).join(" or ");
      const msg = anyType
        ? `No Instrument to wield ${tech.name}.`
        : `No Instrument with the ${need} Instrument Type to wield ${tech.name}.`;
      ui.notifications?.warn(msg);
      return;
    }

    // The roll Aptitude is fixed by the *wielded* Instrument's matching Type
    // (PHB §7.2.x: "they roll one of the Aptitudes the Instrument Type allows").
    // Resolve the concrete Aptitude for a given Instrument; null ⇒ must prompt
    // (the matched Type's Aptitude is "varies", or the matches disagree, or the
    // Technique names no Type at all, e.g. a Skill used without a Tool).
    const typeReg = instrumentTypeMap();
    const concreteApt = (inst) => {
      const its = inst?.system?.types ?? [];
      const matched = anyType ? its : its.filter(t => reqKeys.includes(t));
      const apts = [...new Set(matched.map(t => typeReg[t]?.aptitude).filter(Boolean))];
      return (apts.length === 1 && apts[0] !== "varies") ? apts[0] : null;
    };
    const needAptitude = anyType || valid.some(i => concreteApt(i) === null);
    const strain = Number(sys.strain ?? 0);

    let instrument = valid[0];
    let aptitude   = concreteApt(instrument);
    let strainAttr = null;

    // Prompt when there is a choice: more than one Instrument, an Aptitude to
    // pin down, or Strain to land (PHB §6.7.0: the user's choice of either
    // Attribute in the rolled Aptitude — always asked, never guessed).
    if (valid.length > 1 || needAptitude || strain > 0) {
      const defaultStrainAttr = strain > 0 ? (APTITUDE_ATTRS[aptitude]?.[0] ?? "might") : null;
      const choice = await this._promptTechnique(tech, valid, needAptitude, defaultStrainAttr);
      if (!choice) return;
      instrument = this.actor.items.get(choice.instrumentId) ?? instrument;
      aptitude   = needAptitude ? choice.aptitude : (concreteApt(instrument) ?? aptitude);
      strainAttr = choice.strainAttr ?? defaultStrainAttr;
    }
    if (!aptitude) aptitude = concreteApt(instrument) ?? "prowess";
    if (strain > 0 && !strainAttr) strainAttr = APTITUDE_ATTRS[aptitude]?.[0] ?? "might";

    const apt      = this.actor.system.aptitudes?.[aptitude] ?? {};
    // Accuracy/Pierce sum the Technique's own effects and the wielded
    // Instrument's +N Item Upgrade bonus (PHB §7.4.0), if any.
    const accuracy = Number(sys.accuracyTotal ?? 0) + Number(instrument.system.bonusAccuracy ?? 0);
    const parts    = [apt.formula || "0"];
    if (accuracy) parts.push(String(accuracy));
    const formula = parts.join(" + ");

    const die = instrument.system.weightMult ? ` (${instrument.system.weightMult} Stress)` : "";
    const notes = [`Instrument: ${instrument.name}${die}`];
    const pierce = (sys.effects ?? []).filter(e => e.key === "pierce").reduce((n, e) => n + Number(e.magnitude ?? 0), 0)
      + Number(instrument.system.bonusPierce ?? 0);
    if (pierce) notes.push(`Pierce ${pierce}`);
    const effText = sys.effectText || (sys.pricingBreakdown ?? []).map(b => b.label).join(", ");
    if (effText) notes.push(`Effect: ${effText}`);

    // Strain is self-Stress: apply it now by lowering the chosen Attribute's
    // current Potential directly (PHB §6.7.0 — Stress lands by lowering
    // current Potential, there's no separate Stress counter).
    if (strain > 0) {
      const before = Number(this.actor.system.attributes?.[strainAttr]?.potential?.current ?? 0);
      const after  = Math.max(0, before - strain);
      await this.actor.update({ [`system.attributes.${strainAttr}.potential.current`]: after });
      notes.push(`Strain ${strain} applied to ${ATTR_LABEL[strainAttr]} (${before} → ${after})`);
    }

    // A Technique's own composed "stress" effect (if any) is a flat magnitude
    // bonus on top of the Instrument's Weight term (GMG §5.1.0).
    const techBonus = (sys.effects ?? []).filter(e => e.key === "stress")
      .reduce((n, e) => n + Number(e.magnitude ?? 0), 0);

    await this._postRoll(formula, `${tech.name} — ${APT_LABEL[aptitude]}`, notes.join("<br>"),
      roll => ({
        actorId: this.actor.id, instrumentId: instrument.id, techName: tech.name,
        techBonus, attackTotal: roll.total
      }));
  }

  /**
   * There is no Stress die any more (PHB §5.2.1): Stress is the opposed roll's
   * margin scaled by Weight. This posts the Instrument's reference card so a
   * wielder can see what it does without leaving the sheet.
   */
  static async _onRollInstrument(event, target) {
    const id   = target.closest("[data-item-id]")?.dataset.itemId;
    const inst = this.actor.items.get(id);
    if (!inst) return;

    const notes = [`${inst.system.weightLabel}: a landed Technique deals ${inst.system.weightMult} the margin as Stress`];
    if ((inst.system.harms ?? []).length) notes.push(`Harms the ${inst.system.harms.join(" or the ")}`);
    for (const t of inst.system.bonusByType ?? []) notes.push(`${t.label}: +${t.bonusStress} Stress on a landed hit`);
    if (inst.system.reload) notes.push("Reload before the next attack with this Instrument");

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="foil-flavor"><strong>${inst.name}</strong><br><em>${notes.join("<br>")}</em></div>`
    });
  }

  /**
   * Roll an Instrument's bound Enchantment (PHB §5.4.2). The effect belongs to
   * the item, not the wielder: no Technique-known requirement, no Potential
   * gate, the wielder rolls their own dice through the Aptitude the effect
   * calls for. Strain still lands on the wielder.
   */
  static async _onRollEnchantment(event, target) {
    const id   = target.closest("[data-item-id]")?.dataset.itemId;
    const inst = this.actor.items.get(id);
    const ench = inst?.system?.enchantment;
    if (!inst || !ench?.enabled) return;

    let aptitude = ench.aptitudeDisplay !== "varies" ? ench.aptitudeDisplay : null;
    const strain = Number(ench.strain ?? 0);
    let strainAttr = null;

    if (!aptitude || strain > 0) {
      const defaultStrainAttr = strain > 0 ? (APTITUDE_ATTRS[aptitude]?.[0] ?? "might") : null;
      const choice = await this._promptAptitudeOnly(inst.name, aptitude, defaultStrainAttr);
      if (!choice) return;
      aptitude   = aptitude ?? choice.aptitude;
      strainAttr = choice.strainAttr ?? defaultStrainAttr;
    }
    if (strain > 0 && !strainAttr) strainAttr = APTITUDE_ATTRS[aptitude]?.[0] ?? "might";

    const apt = this.actor.system.aptitudes?.[aptitude] ?? {};
    // Accuracy/Pierce sum the bound effects and the Instrument's own +N Item
    // Upgrade (PHB §7.4.0), same as an ordinary Technique through this item.
    const accuracy = Number(ench.accuracyTotal ?? 0) + Number(inst.system.bonusAccuracy ?? 0);
    const parts    = [apt.formula || "0"];
    if (accuracy) parts.push(String(accuracy));
    const formula = parts.join(" + ");

    const die = inst.system.weightMult ? ` (${inst.system.weightMult} Stress)` : "";
    const notes = [
      `Enchanted Instrument: ${inst.name}${die}`,
      "No Technique-known requirement, no Potential gate (PHB §5.4.2)."
    ];
    const pierce = Number(ench.pierceTotal ?? 0) + Number(inst.system.bonusPierce ?? 0);
    if (pierce) notes.push(`Pierce ${pierce}`);
    if (ench.effectSummary) notes.push(`Effect: ${ench.effectSummary}`);

    if (strain > 0) {
      const before = Number(this.actor.system.attributes?.[strainAttr]?.potential?.current ?? 0);
      const after  = Math.max(0, before - strain);
      await this.actor.update({ [`system.attributes.${strainAttr}.potential.current`]: after });
      notes.push(`Strain ${strain} applied to ${ATTR_LABEL[strainAttr]} (${before} → ${after})`);
    }

    const techBonus = (ench.effects ?? []).filter(e => e.key === "stress")
      .reduce((n, e) => n + Number(e.magnitude ?? 0), 0);

    await this._postRoll(formula, `${inst.name} — ${APT_LABEL[aptitude]} (Enchantment)`, notes.join("<br>"),
      roll => ({
        actorId: this.actor.id, instrumentId: inst.id, techName: inst.name,
        techBonus, attackTotal: roll.total
      }));
  }

  /**
   * Rest (PHB §6.10.0). Recovery mends one Attribute at a time, chosen by the
   * character, at 1d4 a go. The clock is what differs by kind: a physical
   * Attribute (Might, Finesse) mends per hour, a mental one (Wit, Presence)
   * per night. Stress is tracked by lowering current Potential, so recovery
   * raises it back toward max and never past it.
   */
  static async _onRest(event, target) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    if (!DialogV2) return;

    const attrs = this.actor.system.attributes ?? {};
    const hurt = Object.keys(ATTR_LABEL).filter(k => {
      const a = attrs[k];
      return a && Number(a.potential?.current ?? 0) < Number(a.potential?.max ?? 0);
    });
    if (!hurt.length) {
      ui.notifications?.info(`${this.actor.name} has nothing left to mend.`);
      return;
    }
    const opts = hurt.map(k =>
      `<option value="${k}">${ATTR_LABEL[k]} (${attrs[k].potential.current}/${attrs[k].potential.max}, ${attrs[k].kind})</option>`
    ).join("");

    const answer = await DialogV2.prompt({
      window: { title: `${this.actor.name} rests` },
      content: `<p>Rest mends one Attribute at a time, 1d4 a go. Might and Finesse mend per hour; Wit and Presence per night.</p>`
             + `<div class="form-group"><label>Tend to</label><select name="key">${opts}</select></div>`
             + `<div class="form-group"><label>Hours of rest</label>`
             + `<input type="number" name="hours" value="1" min="0" autofocus /></div>`
             + `<div class="form-group"><label>Through the night</label>`
             + `<input type="checkbox" name="night" /></div>`,
      ok: { label: "Rest", callback: (event, button) => new FDE(button.form).object },
      rejectClose: false
    }).catch(() => null);
    if (!answer) return;

    const key = answer.key;
    const a = attrs[key];
    if (!a) return;
    const night = !!answer.night;
    const hours = Math.max(0, Math.trunc(Number(answer.hours) || 0)) + (night ? 8 : 0);
    // A physical Attribute takes a die an hour; a mental one takes a die a night.
    const dice = a.kind === "physical" ? hours : (night ? 1 : 0);
    if (!dice) {
      ui.notifications?.info(`${ATTR_LABEL[key]} mends by the night. Rest through one.`);
      return;
    }

    const cur = Number(a.potential?.current ?? 0);
    const max = Number(a.potential?.max ?? 0);
    const roll = new Roll(`${dice}d4`);
    await roll.evaluate();
    const healed = Math.min(roll.total, max - cur);
    await this.actor.update({ [`system.attributes.${key}.potential.current`]: cur + healed });

    const span = night ? (hours > 8 ? `a night and ${hours - 8} hours` : "a night") : `${hours} hour${hours === 1 ? "" : "s"}`;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<div class="foil-flavor"><strong>${this.actor.name} rests ${span}</strong><br>`
             + `<em>${ATTR_LABEL[key]} +${healed} (${cur} &rarr; ${cur + healed}${cur + healed >= max ? ", full" : ""})</em></div>`
    });
  }

  /**
   * Dialog to choose the casting Aptitude (if unresolved) and/or the Attribute
   * Strain lands on (if this cast has Strain). Skips whichever half isn't needed.
   */
  async _promptAptitudeOnly(itemName, knownAptitude, defaultStrainAttr) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2) return { aptitude: knownAptitude ?? "prowess", strainAttr: defaultStrainAttr };
    let content = `<p><strong>${itemName}</strong></p>`;
    if (!knownAptitude) {
      const aptOpts = Object.entries(APT_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
      content += `<div class="form-group"><label>Casting Aptitude</label><select name="aptitude">${aptOpts}</select></div>`;
    }
    if (defaultStrainAttr) {
      const attrOpts = Object.entries(ATTR_LABEL)
        .map(([k, l]) => `<option value="${k}" ${k === defaultStrainAttr ? "selected" : ""}>${l}</option>`).join("");
      content += `<div class="form-group"><label>Strain lands on</label><select name="strainAttr">${attrOpts}</select></div>`;
    }
    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    return DialogV2.prompt({
      window: { title: `Cast ${itemName}` },
      content,
      ok: { label: "Roll", callback: (event, button) => new FDE(button.form).object },
      rejectClose: false
    }).catch(() => null);
  }

  /**
   * Dialog to choose the wielding Instrument, the Aptitude if it's ambiguous
   * (Arcane "varies"), and the Attribute Strain lands on if this Technique
   * has any (PHB §6.7.0 — always the user's choice, never guessed).
   */
  async _promptTechnique(tech, instruments, needAptitude, defaultStrainAttr) {
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2) {
      return { instrumentId: instruments[0].id, aptitude: needAptitude ? "prowess" : undefined, strainAttr: defaultStrainAttr };
    }

    const instOpts = instruments.map(i => {
      const die = i.system.weightMult ? `, ${i.system.weightMult} Stress` : "";
      return `<option value="${i.id}">${i.name} — ${i.system.weightLabel}${die}</option>`;
    }).join("");

    let content = `<p><strong>${tech.name}</strong></p>`;
    content += instruments.length > 1
      ? `<div class="form-group"><label>Instrument</label><select name="instrumentId">${instOpts}</select></div>`
      : `<input type="hidden" name="instrumentId" value="${instruments[0].id}" />`;

    if (needAptitude) {
      const aptOpts = Object.entries(APT_LABEL)
        .map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
      content += `<div class="form-group"><label>Casting Aptitude</label><select name="aptitude">${aptOpts}</select></div>`;
    }

    if (defaultStrainAttr) {
      const attrOpts = Object.entries(ATTR_LABEL)
        .map(([k, l]) => `<option value="${k}" ${k === defaultStrainAttr ? "selected" : ""}>${l}</option>`).join("");
      content += `<div class="form-group"><label>Strain lands on</label><select name="strainAttr">${attrOpts}</select></div>`;
    }

    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    return DialogV2.prompt({
      window: { title: `Wield ${tech.name}` },
      content,
      ok: { label: "Roll", callback: (event, button) => new FDE(button.form).object },
      rejectClose: false
    }).catch(() => null);
  }

  /** Evaluate a formula and post it as a chat roll. */
  /**
   * @param {Function} [makeFlags]  receives the evaluated Roll, returns the
   *   stressFollowup payload. Flags must be set at creation: setting them after
   *   toMessage() resolves is too late, because renderChatMessageHTML has
   *   already run and the Stress button would never be drawn.
   */
  async _postRoll(formula, flavorTitle, note, makeFlags = null) {
    const roll = new Roll(formula);
    await roll.evaluate();
    const flavor = note
      ? `<div class="foil-flavor"><strong>${flavorTitle}</strong><br><em>${note}</em></div>`
      : `<div class="foil-flavor"><strong>${flavorTitle}</strong></div>`;
    const data = { speaker: ChatMessage.getSpeaker({ actor: this.actor }), flavor };
    const followup = makeFlags?.(roll);
    if (followup) data.flags = { foil: { stressFollowup: followup } };
    return roll.toMessage(data);
  }

  // ─── Embedded item CRUD ─────────────────────────────────────────────────────

  static async _onCreateItem(event, target) {
    const type = target.dataset.type;
    const cls  = { instrument: "Instrument", technique: "Technique", feat: "Feat", equipment: "Equipment", background: "Background", origin: "Ancestry" }[type] ?? "Item";
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name: `New ${cls}`, type }]);
    item?.sheet?.render(true);
  }

  static _onEditItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    this.actor.items.get(id)?.sheet?.render(true);
  }

  static async _onDeleteItem(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!item) return;
    const DialogV2 = foundry.applications?.api?.DialogV2;
    const ok = DialogV2
      ? await DialogV2.confirm({ window: { title: "Delete" }, content: `<p>Delete <strong>${item.name}</strong>?</p>` })
      : true;
    if (ok) await item.delete();
  }

  /** Launch the character generator wizard (one-time creation). */
  static async _onGenerateCharacter() {
    const { FoilChargen } = await import("../apps/chargen.js");
    new FoilChargen({ actor: this.actor }).render(true);
  }

  /** Launch the general-purpose advancement dialog (ongoing, post-creation). */
  static async _onOpenAdvancement() {
    const { FoilAdvancement } = await import("../apps/advancement.js");
    new FoilAdvancement({ actor: this.actor }).render(true);
  }

  /**
   * @override — the sheet is split into several PARTS (header/attributes/
   * body/items/biography) so a field edit only re-renders and replaces its
   * own part's DOM element, not the whole sheet. window-content itself is
   * never torn down across a re-render (only its children/parts are
   * individually replaced), so making it the actual "foil-sheet" flex +
   * scroll container — instead of a template-rendered inner div that used to
   * get destroyed and rebuilt on every single render — is what keeps scroll
   * position stable while editing instead of jumping back to the top on
   * every keystroke. All the existing `.foil-sheet ...` CSS still applies
   * unchanged since the class just lands on a different (but still correctly
   * positioned) element.
   */
  _onRender(context, options) {
    this.element.querySelector(".window-content")?.classList.add("foil-sheet", this.actor.type);
  }
}

export class FoilCharacterSheet extends FoilActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["foil", "sheet", "actor", "character"]
  };

  static PARTS = {
    header:     { template: "systems/foil/templates/actor/character-header.hbs" },
    attributes: { template: "systems/foil/templates/actor/character-attributes.hbs",
      templates: ["systems/foil/templates/actor/partials/dice-pool.hbs"] },
    body:       { template: "systems/foil/templates/actor/character-body.hbs" },
    items:      { template: "systems/foil/templates/actor/character-items.hbs",
      templates: ["systems/foil/templates/actor/partials/item-list.hbs"] },
    biography:  { template: "systems/foil/templates/actor/character-biography.hbs" }
  };

  /** @override — also live-update each FOIL slider's signed readout as it moves. */
  _onRender(context, options) {
    super._onRender(context, options);
    for (const slider of this.element.querySelectorAll("input.axis-value")) {
      const out = this.element.querySelector(`#${slider.dataset.display}`);
      if (!out) continue;
      slider.addEventListener("input", () => {
        const v = Number(slider.value);
        out.textContent = v > 0 ? `+${v}` : `${v}`;
      });
    }
  }

  /** @override */
  async _prepareContext(options) {
    const sys  = this.actor.system;
    const originItem = this.actor.items.find(i => i.type === "origin");
    const backgroundItem = this.actor.items.find(i => i.type === "background");

    return {
      actor:      this.actor,
      system:     sys,
      attributes: this._attributeRows(),
      aptitudes:  this._aptitudeRows(),
      foil:       this._foilRows(),
      xp:         sys.xp ?? { total: 0, spent: 0, available: 0 },
      // Resistance is two values on the actor now; an Attribute going
      // Incapacitated is usually the point a conflict is decided (PHB §6.6.0, §6.8.1).
      resistance:  sys.resistance ?? {},
      originName: originItem?.name ?? "",
      backgroundName: backgroundItem?.name ?? "",
      items:      this._itemGroups()
    };
  }
}

export class FoilCreatureSheet extends FoilActorSheet {
  static DEFAULT_OPTIONS = {
    classes: ["foil", "sheet", "actor", "creature"],
    position: { width: 820, height: 600 }
  };

  static PARTS = {
    header:    { template: "systems/foil/templates/actor/creature-header.hbs" },
    body:      { template: "systems/foil/templates/actor/creature-body.hbs",
      templates: ["systems/foil/templates/actor/partials/dice-pool.hbs"] },
    items:     { template: "systems/foil/templates/actor/creature-items.hbs",
      templates: ["systems/foil/templates/actor/partials/item-list.hbs"] },
    biography: { template: "systems/foil/templates/actor/creature-biography.hbs" }
  };

  /** @override */
  async _prepareContext(options) {
    return {
      actor:      this.actor,
      system:     this.actor.system,
      attributes: this._attributeRows(),
      aptitudes:  this._aptitudeRows(),
      foil:       this._foilRows(),
      resistance:  this.actor.system.resistance ?? {},
      items:      this._itemGroups()
    };
  }
}

/**
 * A Technique/Enchantment roll's chat card carries a "stressFollowup" flag
 * (set in FoilActorSheet._onRollTechnique / _onRollEnchantment above) holding
 * the attacker's total and the Instrument that was wielded. There is no Stress
 * die left to roll (PHB §5.2.1): Stress is the opposed roll's margin scaled by
 * Weight. So the card carries a button that asks for the one number it cannot
 * know, the defender's Oppose total, and computes the rest into chat.
 *
 * This is the one automation the system does on a landed hit, and it is
 * arithmetic rather than a roll. Applying the Stress is still the table's job,
 * as is choosing which Attribute of the pair it lands on (PHB §5.2.2).
 */
Hooks.on("renderChatMessageHTML", (message, html) => {
  const flag = message.getFlag("foil", "stressFollowup");
  if (!flag) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "foil-stress-followup";
  btn.textContent = `Stress — ${flag.techName}`;

  btn.addEventListener("click", async () => {
    const actor = game.actors.get(flag.actorId);
    const inst  = actor?.items.get(flag.instrumentId);
    const profile = CONFIG.FOIL?.weightProfile?.[inst?.system.weight];
    if (!inst || !profile) return;

    const DialogV2 = foundry.applications?.api?.DialogV2;
    const FDE = foundry.applications?.ux?.FormDataExtended ?? FormDataExtended;
    if (!DialogV2) return;

    const answer = await DialogV2.prompt({
      window: { title: `${inst.name} — Stress` },
      content: `<p>${flag.techName} rolled <strong>${flag.attackTotal}</strong>.</p>`
             + `<div class="form-group"><label>Target's Oppose total</label>`
             + `<input type="number" name="oppose" autofocus /></div>`,
      ok: { label: "Compute", callback: (event, button) => new FDE(button.form).object },
      rejectClose: false
    }).catch(() => null);
    if (!answer) return;

    const opp = Number(answer.oppose);
    if (Number.isNaN(opp)) return;

    const margin = Number(flag.attackTotal) - opp;
    const speaker = ChatMessage.getSpeaker({ actor });

    if (margin <= 0) {
      await ChatMessage.create({ speaker, content:
        `<div class="foil-flavor"><strong>${flag.techName} fails.</strong>`
        + `<br><em>Margin ${margin}; the defender wins ties (PHB §6.5.0).</em></div>` });
      return;
    }

    const rider = (inst.system.bonusByType ?? []).reduce((n, t) => n + Number(t.bonusStress ?? 0), 0);
    const base  = profile.term(margin);
    const total = base + rider + Number(flag.techBonus ?? 0);

    const parts = [`${inst.system.weightLabel} on a margin of ${margin} is ${base}`];
    if (rider) parts.push(`+${rider} rider`);
    if (flag.techBonus) parts.push(`+${flag.techBonus} from ${flag.techName}`);
    const kind = (inst.system.harms ?? [])[0] ?? "physical";

    await ChatMessage.create({ speaker, content:
      `<div class="foil-flavor"><strong>${total} Stress</strong> before Resistance`
      + `<br><em>${parts.join(", ")}. Subtract the target's ${kind} Resistance, `
      + `then apply it to the Attribute you aimed at.</em></div>` });
  });

  const container = html.querySelector(".message-content") ?? html;
  container.appendChild(btn);
});
