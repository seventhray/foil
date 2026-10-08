/**
 * src/registry.js
 * The modular vocabulary registry. Collects every authorable definition
 * document — Instrument Types, Qualities, Effects — from the definition
 * compendium packs AND the world's own items, and exposes them as slug-keyed
 * maps on CONFIG.FOIL. Content items (instruments/techniques/equipment) and
 * their sheets read the registry, so creating a new definition in Foundry makes
 * it available everywhere with no code change.
 */

const DEF_TYPES = {
  instrumentType: { pack: "foil.instrument-types", config: "instrumentTypes" },
  quality:        { pack: "foil.qualities",        config: "qualities" },
  effect:         { pack: "foil.effects",          config: "effects" }
};

/** Slugify a name for use as a fallback key. */
export function slugify(name) {
  return String(name ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The key a definition is registered under: its explicit `system.key`, else its slugified name. */
function defKey(doc) {
  return (doc.system?.key && String(doc.system.key).trim()) || slugify(doc.name);
}

/** Build one registry map ({ slug: {label, ...system} }) from a pack + world items. */
async function collect(type) {
  const map = {};
  const add = doc => {
    const key = defKey(doc);
    if (!key) return;
    map[key] = { key, label: doc.name, ...doc.system };
  };
  // Compendium defaults first…
  const pack = game.packs.get(DEF_TYPES[type].pack);
  if (pack) {
    for (const doc of await pack.getDocuments()) add(doc);
  }
  // …world items override / extend.
  for (const doc of game.items.filter(i => i.type === type)) add(doc);
  return map;
}

/** (Re)build the whole registry onto CONFIG.FOIL, then re-prep dependent items. */
export async function buildRegistry() {
  CONFIG.FOIL ??= {};
  for (const [type, def] of Object.entries(DEF_TYPES)) {
    CONFIG.FOIL[def.config] = await collect(type);
  }
  refreshContentItems();
}

// Item types whose derived data depends on the registry: Technique pricing,
// and an Instrument's bound Enchantment pricing (same engine, PHB 5.3.4).
const REGISTRY_DEPENDENT_TYPES = new Set(["technique", "instrument"]);

/** Re-prepare items whose derived data depends on the registry, and re-render open sheets. */
export function refreshContentItems() {
  const items = [
    ...game.items.contents,
    ...game.actors.contents.flatMap(a => a.items.contents)
  ];
  for (const item of items) {
    if (REGISTRY_DEPENDENT_TYPES.has(item.type)) {
      item.reset();               // re-run data preparation with the now-ready registry
      item.sheet?.rendered && item.sheet.render(false);
    }
  }
  for (const app of Object.values(ui.windows)) app?.render?.(false);
}

/** Rebuild whenever a definition document changes. */
export function registerRegistryHooks() {
  const isDef = doc => doc?.type in DEF_TYPES;
  for (const hook of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(hook, doc => { if (isDef(doc)) buildRegistry(); });
  }
}

// ─── Read helpers for sheets ────────────────────────────────────────────────

export function instrumentTypeMap() { return CONFIG.FOIL?.instrumentTypes ?? {}; }
export function qualityMap()         { return CONFIG.FOIL?.qualities ?? {}; }
export function effectMap()          { return CONFIG.FOIL?.effects ?? {}; }

/** {key,label,checked} options for a multi-select, given the set of active slugs. */
export function typeOptions(active = []) {
  const set = new Set(active);
  return Object.values(instrumentTypeMap())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(d => ({ key: d.key, label: d.label, checked: set.has(d.key) }));
}

export function effectOptions() {
  return Object.values(effectMap())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(d => ({ key: d.key, label: d.label }));
}

export function qualityOptions() {
  return Object.values(qualityMap())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(d => ({ key: d.key, label: d.label, scope: d.scope ?? "free" }));
}

/** Resolve a list of Instrument Type slugs to their labels. */
export function typeLabels(slugs = []) {
  const m = instrumentTypeMap();
  return slugs.map(s => m[s]?.label ?? s);
}

/** Compose an equipment item's Qualities, weight, and effect into a one-line summary. */
export function equipmentSummary(sys) {
  const m = qualityMap();
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  const parts = [];
  if (sys.category === "gem" && sys.gemSummary) parts.push(sys.gemSummary);
  for (const q of sys.qualities ?? []) {
    const def = m[q.key];
    const name = def?.label ?? cap(q.key);
    const val = Number(q.value) ? ` +${q.value}` : "";
    const param = q.param ? ` (${cap(q.param)})` : "";
    parts.push(`${name}${val}${param}`);
  }
  if (sys.effect) parts.push(sys.effect);
  if (sys.duration) parts.push(sys.duration);
  if (sys.uses) parts.push(`Uses: ${sys.uses}`);
  if (sys.carriedWeight) parts.push(`${sys.carriedWeight} lbs`);
  return parts.join(" · ");
}
