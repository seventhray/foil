/**
 * rules/definitions.js
 * How definition documents (Instrument Types, Qualities, Effects) become the slug-keyed registry that
 * items are derived against. Pure: it takes plain documents ({ name, system }) and returns a map.
 */

/** Slugify a name for use as a fallback key. */
export function slugify(name) {
  return String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The key a definition is registered under: its explicit `system.key`, else its slugified name. */
export function defKey(doc) {
  return (doc.system?.key && String(doc.system.key).trim()) || slugify(doc.name);
}

/** { slug: { key, label, ...system } } from definition documents; a later document replaces an earlier one with the same key. */
export function registryFromDocs(docs) {
  const map = {};
  for (const doc of docs) {
    const key = defKey(doc);
    if (!key) continue;
    map[key] = { key, label: doc.name, ...doc.system };
  }
  return map;
}
