/**
 * src/pricing.js
 * Custom-Technique pricing engine (PHB 4.2.1, Fundamental Math's Effects
 * table). Pure functions, no Foundry globals, so they run headlessly. Given a
 * Technique's composed effect entries and the effect registry, derives XP and
 * Strain. Authoring support only: nothing here resolves play.
 *
 *  1. Sum every Effect's XP. Stress is an Effect like any other (4 XP).
 *  2. A Pattern (Beam, Cone, Radius, Wall) or Extend Range is
 *     priced by reach and counts as one of the Technique's Effects.
 *  3. +4 XP for every Effect beyond the first. Quick and Upkeep don't count;
 *     each has its own flat price (Upkeep 4 XP, Quick 3).
 *     Selective names N targets within R bands; each target adds 8 XP (one
 *     Strain) to the one-target price, and Selective itself isn't an Effect.
 *  4. Floors: a Technique that answers a class of attack, grants a ward or a
 *     roll bonus until the caster's next turn, is Quick with a trigger, or is
 *     Fortifying costs at least 8 XP.
 *  5. Strain = floor(XP / 8).
 */

export const PREMIUM_PER_EFFECT = 4;
export const DEFENSIVE_FLOOR = 8;
export const STRAIN_DIVISOR = 8;
export const SELECTIVE_PER_TARGET = 8;

/** Running sum 1 + 2 + ... + N (the Beam reach cost). */
function beamCost(bands) {
  let s = 0;
  for (let i = 1; i <= bands; i++) s += i;
  return s;
}

/** Pattern cost by shape and reach in bands, plus placement (Fundamental Math, Patterns). */
export function patternCost(shape, bands, placement = 0) {
  const b = Math.max(0, Number(bands) || 0);
  const place = Math.max(0, Number(placement) || 0);
  let base;
  switch (shape) {
    case "beam":
    case "wall":   base = beamCost(b); break;
    case "cone":   base = 3 * beamCost(b); break;
    case "radius": base = 12 * beamCost(b); break;
    default:       base = 0; break;
  }
  return base + place;
}

/** Selective: each of N targets adds 8 XP (one Strain) to the Technique's one-target price. */
export function selectiveCost(n) {
  return SELECTIVE_PER_TARGET * Math.max(0, Number(n) || 0);
}

export function strainFor(xp) {
  return Math.floor(Math.max(0, Number(xp) || 0) / STRAIN_DIVISOR);
}

/**
 * Price one composed effect entry against its definition.
 * @returns {{ cost:number, counts:boolean, floor:number }}
 */
export function priceEntry(entry, def) {
  if (!def) return { cost: 0, counts: false, floor: 0 };
  const p = def.pricingParams ?? {};
  const mag = Math.max(0, Number(entry.magnitude ?? 1));
  let cost = 0, counts = !def.exemptFromPremium, floor = def.setsFloor && !entry.untriggered ? DEFENSIVE_FLOOR : 0;

  switch (def.pricingKind) {
    case "perPoint":
      cost = Number(p.base ?? 0) + Number(p.perPoint ?? 0) * mag;
      break;
    case "extendRange":
      cost = Number(p.perBand ?? 1) * Math.max(1, Number(entry.bands ?? 1));
      break;
    case "pattern":
      cost = patternCost(entry.pattern, entry.bands, entry.placement);
      break;
    case "selective":
      cost = 0;
      counts = false;
      break;
    case "upkeep":
      cost = Number(p.base ?? 4);
      counts = false;
      break;
    case "quick":
      cost = Number(p.base ?? 3);
      counts = false;
      break;
    default:
      cost = Number(p.base ?? 0);
      break;
  }
  return { cost, counts, floor };
}

/**
 * Price a whole Technique.
 * @param {Array}  effects   composed entries ({ key, magnitude, pattern, bands, ... })
 * @param {object} registry  { slug: effectDefinition }
 * @param {object} opts      { floor: boolean } a stated defensive floor
 * @returns {{ xp, strain, premium, floor, breakdown }}
 */
export function priceTechnique(effects = [], registry = {}, opts = {}) {
  const breakdown = [];
  let perTarget = 0, flat = 0, counted = 0, sel = null, floor = opts.floor ? DEFENSIVE_FLOOR : 0;

  for (const entry of effects) {
    const def = registry[entry.key];
    const r = priceEntry(entry, def);
    if (def?.pricingKind === "selective") { sel = entry; continue; }
    if (r.counts) { perTarget += r.cost; counted += 1; } else flat += r.cost;
    floor = Math.max(floor, r.floor);
    breakdown.push({ key: entry.key, label: entryLabel(entry, def), cost: r.cost });
  }

  const premium = PREMIUM_PER_EFFECT * Math.max(0, counted - 1);
  let sum = perTarget + flat;
  if (sel) {
    const extra = selectiveCost(sel.selectiveN);
    sum += extra;
    breakdown.push({ key: sel.key, label: entryLabel(sel, registry[sel.key]), cost: extra });
  }
  const xp = Math.max(sum + premium, floor);
  return { xp, strain: strainFor(xp), premium, floor, breakdown };
}

const BAND_NAME = ["", "Close", "Near", "Short", "Mid", "Long"];

/** A readable label for one composed entry ("Pierce 2", "Cone (Near)"). */
export function entryLabel(entry, def) {
  const name = def?.label ?? entry.key;
  const mag = Number(entry.magnitude ?? 1);
  switch (def?.pricingKind) {
    case "perPoint":
      return def.magnitudeLabel ? def.magnitudeLabel.replace("N", mag) : name;
    case "pattern":
      return `${(entry.pattern ?? "").replace(/^./, c => c.toUpperCase())} (${BAND_NAME[entry.bands] ?? entry.bands})`;
    case "selective":
      return `Selective (${entry.selectiveN} within ${BAND_NAME[entry.selectiveR] ?? entry.selectiveR})`;
    default:
      return name;
  }
}
