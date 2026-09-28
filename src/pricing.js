/**
 * src/pricing.js
 * Custom-Technique pricing engine (GMG §5.1.0). PURE functions — no Foundry
 * globals — so they can be unit-tested headlessly. Given a Technique's composed
 * effect entries and the effect registry, derives XP, Strain, and the Potential
 * gate. This is authoring support (it prices a Technique at build time); it does
 * NOT resolve anything in play.
 *
 * Pricing rules, reverse-engineered from and validated against the PHB
 * catalogue (rescaled 2026-07-28 from a 5-XP-per-point base to 4-XP-per-point;
 * die-pool advancement costs are a separate, non-linear table and are not
 * affected by this rescale):
 *  - Each effect costs `base + perPoint × magnitude` (a "linear" effect), or a
 *    special cost for area modifiers (Pattern, Selective) and Extend Range.
 *  - Combination premium: +4 XP per counted component beyond the first, where
 *    the count K = (non-exempt, non-area effects) + (1 if any area modifier is
 *    present). Upkeep and Reaction are exempt (they add their own cost/floor but
 *    are not counted).
 *  - Floors: an effect that `setsFloor` (Reaction) raises the total to at least
 *    its floor; a manual `floorOverride` covers ward / answers-a-class cases
 *    that aren't structurally detectable.
 *  - Strain = floor(XP / 16). Potential gate = 12 + 4 × floor(XP / 16) for any
 *    Technique of 12 XP or more (Fundamental Math): 12-15 ⇒ 12, 16-31 ⇒ 16,
 *    32-47 ⇒ 20, 48-63 ⇒ 24.
 */

// Beam/Wall reach cost = running sum 1..bands (GMG Patterns table).
function beamCost(bands) {
  let s = 0;
  for (let i = 1; i <= bands; i++) s += i;
  return s;
}

/** Cost of an area Pattern of a given shape and size (in bands), plus placement. */
export function patternCost(shape, bands, placement = 0) {
  const b = Math.max(0, Number(bands) || 0);
  const place = Math.max(0, Number(placement) || 0);
  let base;
  switch (shape) {
    case "beam":
    case "wall":   base = beamCost(b); break;
    case "cone":   base = 3 * beamCost(b); break;
    case "radius": base = 12 * beamCost(b); break;
    default:       base = 0; break; // "single" or unknown
  }
  return base + place;
}

/**
 * Selective cost: N targets within R bands = N + R × N (GMG §5.1.0). The
 * earlier 0.8× discount (2026-07-28) was removed 2026-07-29 at the user's
 * direction; N=4, R=2 now prices at 12 XP, not 10.
 */
export function selectiveCost(n, r) {
  const N = Math.max(0, Number(n) || 0);
  const R = Math.max(0, Number(r) || 0);
  return N + R * N;
}

const isArea = shape => shape && shape !== "single";

/**
 * Price one composed effect entry against its definition.
 * @param {object} entry  { key, magnitude, pattern, bands, placement, selectiveN, selectiveR }
 * @param {object} def    effect definition (pricingKind, pricingParams, flags)
 * @returns {{ cost:number, counts:boolean, area:boolean, exempt:boolean, floor:number }}
 */
export function priceEntry(entry, def) {
  if (!def) return { cost: 0, counts: false, area: false, exempt: false, floor: 0 };
  const p = def.pricingParams ?? {};
  const mag = Math.max(0, Number(entry.magnitude ?? 1));
  let cost = 0, area = false, exempt = !!def.exemptFromPremium, floor = 0;

  switch (def.pricingKind) {
    case "linear":
    case "perPoint":
    case "flat":
    case "condition":
    case "counter":
      cost = Number(p.base ?? 0) + Number(p.perPoint ?? 0) * (def.pricingKind === "flat" || def.pricingKind === "condition" || def.pricingKind === "counter" ? 0 : mag);
      break;
    case "extendRange":
      cost = Number(p.perBand ?? 1) * Math.max(0, Number(entry.bands ?? 0));
      break;
    case "pattern":
      cost = patternCost(entry.pattern, entry.bands, entry.placement);
      area = true;
      break;
    case "selective":
      cost = selectiveCost(entry.selectiveN, entry.selectiveR);
      area = true;
      break;
    case "upkeep":
      cost = Number(p.base ?? 4);
      exempt = true;
      break;
    case "reaction":
      cost = 0;
      exempt = true;
      floor = Number(p.floor ?? 8);
      break;
    default:
      cost = Number(p.base ?? 0);
      break;
  }
  return { cost, counts: !exempt && !area, area, exempt, floor };
}

/**
 * Price a whole Technique.
 * @param {Array}  effects   composed entries (each { key, magnitude, pattern, ... })
 * @param {object} registry  { slug: effectDefinition }
 * @param {object} opts       { floorOverride }
 * @returns {{ xp, strain, gate:{value,attribute}, breakdown:Array, premium, floor }}
 */
export function priceTechnique(effects = [], registry = {}, opts = {}) {
  const breakdown = [];
  let sum = 0, deliveredCount = 0, anyArea = false, floor = Number(opts.floorOverride ?? 0);

  for (const entry of effects) {
    const def = registry[entry.key];
    const r = priceEntry(entry, def);
    sum += r.cost;
    if (r.counts) deliveredCount += 1;
    if (r.area) anyArea = true;
    if (r.floor) floor = Math.max(floor, r.floor);
    breakdown.push({ key: entry.key, label: def?.label ?? entry.key, cost: r.cost });
  }

  const K = deliveredCount + (anyArea ? 1 : 0);
  const premium = 4 * Math.max(0, K - 1);
  let xp = sum + premium;
  if (floor) xp = Math.max(xp, floor);

  const strain = Math.floor(xp / 16);
  const gateVal = xp >= 12 ? 12 + 4 * Math.floor(xp / 16) : 0;

  return {
    xp,
    strain,
    gate: { value: gateVal, attribute: "" },
    premium,
    floor,
    breakdown
  };
}
