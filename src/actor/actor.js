/**
 * src/actor/actor.js
 * FoilActor. Derivation lives in the DataModels (src/data/actor-models.js);
 * this class keeps the one piece of state that depends on direction of change:
 * Incapacitation starts when an Attribute's bar empties, and lifts only once
 * healing brings its Stress back down to half its Potential (PHB 6.8.1).
 */

import { ATTRIBUTE_KEYS, FOIL_TOKEN_MAX } from "../constants.js";
import { recoveryThreshold } from "../data/actor-models.js";
import { poolFromCounts } from "../dice.js";

const { getProperty, setProperty, hasProperty } = foundry.utils;

export class FoilActor extends Actor {
  /** An Attribute created with dice starts with no Stress. */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    const fill = {};
    for (const k of ATTRIBUTE_KEYS) {
      const dice = getProperty(data, `system.attributes.${k}.dice`);
      if (!dice || hasProperty(data, `system.attributes.${k}.potential.current`)) continue;
      fill[`system.attributes.${k}.potential.current`] = poolFromCounts(dice).max;
    }
    if (Object.keys(fill).length) this.updateSource(fill);
  }

  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate(changed, options, user);
    if (allowed === false) return false;
    // Changing the dice keeps the Stress taken: current Potential moves with max.
    for (const k of ATTRIBUTE_KEYS) {
      const dicePath = `system.attributes.${k}.dice`;
      if (!hasProperty(changed, dicePath) || hasProperty(changed, `system.attributes.${k}.potential.current`)) continue;
      const src = this._source.system.attributes?.[k] ?? {};
      const oldMax = poolFromCounts(src.dice ?? {}).max;
      const newMax = poolFromCounts({ ...(src.dice ?? {}), ...getProperty(changed, dicePath) }).max;
      if (newMax === oldMax) continue;
      const stress = Math.max(0, oldMax - Number(src.potential?.current ?? 0));
      setProperty(changed, `system.attributes.${k}.potential.current`, Math.max(0, newMax - stress));
    }
    for (const k of ATTRIBUTE_KEYS) {
      const path = `system.attributes.${k}.potential.current`;
      if (!hasProperty(changed, path)) continue;
      if (hasProperty(changed, `system.attributes.${k}.incapacitated`)) continue;
      const cur = Number(getProperty(changed, path));
      const max = Number(this.system.attributes?.[k]?.potential?.max ?? 0);
      const was = !!this._source.system.attributes?.[k]?.incapacitated;
      let now = was;
      if (max > 0 && cur <= 0) now = true;
      else if (was && cur >= recoveryThreshold(max)) now = false;
      if (now !== was) setProperty(changed, `system.attributes.${k}.incapacitated`, now);
    }
  }

  /** Current Potential of an Attribute. */
  potentialOf(key) {
    return Number(this.system.attributes?.[key]?.potential?.current ?? 0);
  }

  /** Lower an Attribute's current Potential by `amount` (Stress or Strain), never below 0. */
  async takeStress(key, amount) {
    const before = this.potentialOf(key);
    const after = Math.max(0, before - Math.max(0, Number(amount) || 0));
    await this.update({ [`system.attributes.${key}.potential.current`]: after });
    return { before, after };
  }

  /** Raise an Attribute's current Potential by `amount`, never past its max. */
  async heal(key, amount) {
    const before = this.potentialOf(key);
    const max = Number(this.system.attributes?.[key]?.potential?.max ?? 0);
    const after = Math.min(max, before + Math.max(0, Number(amount) || 0));
    await this.update({ [`system.attributes.${key}.potential.current`]: after });
    return { before, after };
  }

  get foilTokens() { return Number(this.system.foilTokens ?? 0); }

  async setFoilTokens(n) {
    await this.update({ "system.foilTokens": Math.max(0, Math.min(FOIL_TOKEN_MAX, n)) });
  }
}
