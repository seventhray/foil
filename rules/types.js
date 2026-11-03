/**
 * rules/types.js
 * Instrument Types and Properties (PHB 4.1.1). An Instrument that can harm has one Type: Melee, Ranged, Arcane or Sonic. Melee and
 * Ranged harm Might or Finesse, Sonic harms Wit or Presence, and an Arcane Instrument harms through its Kinetic Property (Might or
 * Finesse) or its Incorporeal one (Wit or Presence). Properties say what else it can do: Grappling, Guarding, Kinetic, Incorporeal,
 * Thrown, Drawn, Fired, Immobile, and Tools or Tools [Material]. A creature's natural weapon may also be Quick (GMG 9.6.0).
 *
 * Items stored before the 2026-11-02 rework name the older Types: Edged, Pointed and Blunt (now Melee), Parry and Blocking (now
 * Guarding), and Fortifying (now Incorporeal on an Arcane Instrument). currentTypes reads those as the new Type and Properties,
 * so stored sheets and unconverted creatures keep working. Pure.
 */

export const INSTRUMENT_TYPES = ["melee", "ranged", "arcane", "sonic"];
export const TYPE_LABEL = { melee: "Melee", ranged: "Ranged", arcane: "Arcane", sonic: "Sonic" };

/** The kind of Attribute each Type, or an Arcane Instrument's Property, harms (PHB 4.1.1). */
export const HARMS = { melee: "physical", ranged: "physical", sonic: "mental", kinetic: "physical", incorporeal: "mental" };
export const CHANNEL_LABEL = { melee: "Melee", ranged: "Ranged", sonic: "Sonic", kinetic: "Kinetic", incorporeal: "Incorporeal" };

/** Properties that add nothing to an Instrument's price (PHB 5.2.2): Tools, Immobile, and a creature's Quick. */
export const unpricedProperty = k => k === "tool" || k === "immobile" || k === "quick" || String(k).startsWith("craft-");

const LEGACY_MELEE = ["edged", "pointed", "blunt"];
const LEGACY_GUARDING = ["parry", "blocking"];
const ORDER = ["melee", "ranged", "arcane", "sonic", "grappling", "guarding", "kinetic", "incorporeal", "thrown", "drawn", "fired", "immobile", "tool", "quick"];
const rank = k => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);

/** An Instrument's Type and Properties in the current terms, Type first. A list already in them comes back in the same order. */
export function currentTypes(types = []) {
  const t = [...new Set((types ?? []).map(k => String(k).toLowerCase()).filter(Boolean))];
  const has = k => t.includes(k);
  const props = new Set(t.filter(k => !INSTRUMENT_TYPES.includes(k) && !LEGACY_MELEE.includes(k) && !LEGACY_GUARDING.includes(k) && k !== "fortifying"));
  if (t.some(k => LEGACY_GUARDING.includes(k))) props.add("guarding");
  if (has("fortifying")) props.add("incorporeal");
  let type = t.find(k => INSTRUMENT_TYPES.includes(k));
  if (!type) {
    type = has("drawn") || has("fired") ? "ranged"
      : t.some(k => LEGACY_MELEE.includes(k)) ? "melee"
      : props.has("kinetic") || props.has("incorporeal") ? "arcane"
      : has("thrown") ? "ranged"
      : has("grappling") || props.has("guarding") ? "melee"
      : "";
  }
  if (!t.some(k => LEGACY_MELEE.includes(k) || LEGACY_GUARDING.includes(k) || k === "fortifying") && (type === "" || t.includes(type))) return t;
  return [...(type ? [type] : []), ...[...props].sort((a, b) => rank(a) - rank(b))];
}

/** The Instrument's one Type, or "" for gear that can't harm (Tools). */
export const typeOf = types => currentTypes(types).find(k => INSTRUMENT_TYPES.includes(k)) ?? "";

/**
 * The ways an Instrument harms (PHB 4.1.1): its Type, or for an Arcane one each of its Kinetic and Incorporeal Properties, chosen when a
 * Technique is declared. Each is { key, label, kind } with kind "physical" or "mental". A card's typeIndex points into this list.
 */
export function channelsOf(types = []) {
  const t = currentTypes(types);
  const type = typeOf(t);
  const keys = type === "arcane" ? ["kinetic", "incorporeal"].filter(k => t.includes(k)) : type ? [type] : [];
  return keys.map(key => ({ key, label: CHANNEL_LABEL[key], kind: HARMS[key] }));
}

/** The kinds of Attribute an Instrument harms, and so the ones its Guard covers (PHB 6.5.2). */
export const kindsOf = types => [...new Set(channelsOf(types).map(c => c.kind))];

/**
 * A Technique's Requirement in the current terms (PHB 4.2.0). Each entry is one way to meet it; an entry joining keys with "+",
 * such as "guarding+melee", needs all of them. Older Requirements name the older Types: Edged, Pointed and Blunt read as Melee,
 * Thrown, Drawn and Fired as Ranged, Parry and Blocking as Guarding, and Fortifying as Incorporeal.
 */
export function currentRequires(requires = []) {
  const map = k => (LEGACY_MELEE.includes(k) ? "melee" : ["thrown", "drawn", "fired"].includes(k) ? "ranged"
    : LEGACY_GUARDING.includes(k) ? "guarding" : k === "fortifying" ? "incorporeal" : k);
  return [...new Set((requires ?? []).map(r => String(r).toLowerCase().split("+").map(map).join("+")).filter(Boolean))];
}

/** Whether an Instrument with these Types meets a Requirement (PHB 4.2.0). Any Tools meets "tool", Tools [Material] included. */
export function meetsRequirement(types = [], requires = [], { category = "" } = {}) {
  const req = currentRequires(requires);
  if (!req.length) return true;
  const t = currentTypes(types);
  const hasKey = k => t.includes(k) || (k === "tool" && (category === "tool" || t.some(x => x.startsWith("craft-"))));
  return req.some(alt => alt.split("+").every(hasKey));
}

/** "Melee", "Guarding and Melee", "Kinetic or Incorporeal": a Requirement as the books print it. */
export function requiresLabel(requires = [], labelOf = k => k) {
  const req = currentRequires(requires);
  if (!req.length) return "Any";
  return req.map(alt => alt.split("+").map(labelOf).join(" and ")).join(" or ");
}
