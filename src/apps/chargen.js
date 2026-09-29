/**
 * src/apps/chargen.js
 * Starting Character (PHB 2.5.0). Every Attribute starts at 2d4; the chosen
 * Ancestry advances one of those dice in each of two Attributes by Talent and grants two Feats (and any
 * Technique a Feat teaches); the chosen Background adds 2d4 of Know-how, +1
 * Training in three Skills (carried by the Background item itself, see
 * src/modifiers.js), its coin, and its Equipment kit. Body and Voice, the two
 * innate Instruments, are always present. Starting XP comes from GMG 2.1.0.
 */

import { ATTRIBUTE_KEYS } from "../constants.js";

// Starting Points (GMG 2.1.0): picked for the whole party, sets Starting XP.
export const STARTING_TIERS = [
  { key: "fresh",     label: "Fresh Start (0 XP)",   xp: 0 },
  { key: "blooded",   label: "Blooded (60 XP)",      xp: 60 },
  { key: "hardened",  label: "Hardened (150 XP)",    xp: 150 },
  { key: "storied",   label: "Storied (300 XP)",     xp: 300 },
  { key: "legendary", label: "Legendary (600+ XP)",  xp: 600 }
];

const INNATE_INSTRUMENTS = ["Body", "Voice"];
const DIE_KEYS = ["d4", "d6", "d8", "d10", "d12", "d20"];

/** Split a Background kit string ("Longsword, Leather armor, Traveler Pack.") into item names. */
export function parseKit(kit) {
  return String(kit ?? "")
    .replace(/\.\s*$/, "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

/** Map a compendium pack's documents by lower-cased name. */
async function packDocsByName(packName) {
  const pack = game.packs.get(packName);
  const map = new Map();
  if (!pack) return map;
  for (const d of await pack.getDocuments()) map.set(d.name.toLowerCase(), d);
  return map;
}

/**
 * Resolve kit item names against the Instruments and Equipment packs.
 * @returns {{ found: object[], missing: string[] }}
 */
export async function matchKitItems(kitNames) {
  const instruments = await packDocsByName("foil.instruments");
  const equipment = await packDocsByName("foil.equipment");
  const found = [], missing = [];
  for (const name of kitNames) {
    const key = name.toLowerCase().replace(/^50ft of rope$/, "rope (50ft)");
    const bare = key.replace(/\s+(armor|armour)$/, "").trim();   // "leather armor" is Leather
    const doc = instruments.get(key) || equipment.get(key) || instruments.get(bare) || equipment.get(bare);
    if (doc) found.push(doc.toObject());
    else missing.push(name);
  }
  return { found, missing };
}

/**
 * Ensure Body and Voice are on the actor. Idempotent.
 * @returns {number} how many items were created
 */
export async function grantStartingKit(actor) {
  const existing = new Set(actor.items.map(i => i.name.toLowerCase()));
  const map = await packDocsByName("foil.instruments");
  const toCreate = INNATE_INSTRUMENTS
    .filter(n => !existing.has(n.toLowerCase()) && map.has(n.toLowerCase()))
    .map(n => map.get(n.toLowerCase()).toObject());
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  return toCreate.length;
}

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class FoilChargen extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actor = options.actor;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["foil", "chargen"],
    window: { title: "Starting Character", icon: "fas fa-wand-magic-sparkles" },
    position: { width: 480, height: "auto" },
    form: { handler: FoilChargen._onSubmit, closeOnSubmit: true }
  };

  static PARTS = { main: { template: "systems/foil/templates/apps/chargen.hbs" } };

  async _prepareContext() {
    const docs = async pack => ((await game.packs.get(pack)?.getDocuments()) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name));
    const ancestries = (await docs("foil.origins")).map(d => ({
      name: d.name, detail: [d.system.talentSummary, d.system.featsSummary].filter(Boolean).join("; ")
    }));
    const backgrounds = (await docs("foil.backgrounds")).map(d => ({
      name: d.name, detail: [d.system.grantsSummary, d.system.knowHowSummary, d.system.coin].filter(Boolean).join("; ")
    }));
    return { actorName: this.actor?.name ?? "", startingTiers: STARTING_TIERS, ancestries, backgrounds };
  }

  static async _onSubmit(event, form, formData) {
    const actor = this.actor;
    if (!actor) return;
    const data = foundry.utils.expandObject(formData.object);
    // Throwing keeps the dialog open with the message (closeOnSubmit only runs on success).
    if (!data.ancestry || !data.background) throw new Error("Pick an Ancestry and a Background.");

    const ancestry = (await packDocsByName("foil.origins")).get(data.ancestry.toLowerCase());
    const background = (await packDocsByName("foil.backgrounds")).get(data.background.toLowerCase());
    if (!ancestry || !background) throw new Error("That Ancestry or Background isn't in the compendium.");

    // 1. Every Attribute starts at 2d4.
    const pools = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, { d4: 2 }]));
    // 2. Ancestry Talent advances one of that Attribute's starting d4s to the named size.
    for (const t of ancestry.system.talent ?? []) {
      const p = pools[t.attribute];
      if (!p || !p.d4) continue;
      p.d4 -= 1;
      p[`d${t.die}`] = (p[`d${t.die}`] ?? 0) + 1;
    }
    // 3. Background Know-how: each d4 joins the Attribute it names.
    for (const a of background.system.knowHow ?? []) if (pools[a]) pools[a].d4 = (pools[a].d4 ?? 0) + 1;

    const update = {};
    for (const k of ATTRIBUTE_KEYS) {
      for (const d of DIE_KEYS) update[`system.attributes.${k}.dice.${d}`] = pools[k][d] ?? 0;
      update[`system.attributes.${k}.incapacitated`] = false;
    }
    update["system.ancestry"] = ancestry.name;
    update["system.background"] = background.name;
    update["system.coin"] = data.coin ? String(data.coin) : (background.system.coin ?? "");
    const tier = STARTING_TIERS.find(t => t.key === data.startingPoint);
    if (tier) update["system.xp.total"] = tier.xp;
    await actor.update(update);
    // Fill every bar now that the pools are set.
    const fill = {};
    for (const k of ATTRIBUTE_KEYS) fill[`system.attributes.${k}.potential.current`] = actor.system.attributes[k].potential.max;
    await actor.update(fill);

    const existing = new Set(actor.items.map(i => i.name.toLowerCase()));
    const toCreate = [];
    const notes = [];
    const add = doc => {
      if (existing.has(doc.name.toLowerCase())) return;
      existing.add(doc.name.toLowerCase());
      toCreate.push(doc);
    };

    add(ancestry.toObject());
    const feats = await packDocsByName("foil.feats");
    const techniques = await packDocsByName("foil.techniques");
    for (const featName of ancestry.system.feats ?? []) {
      const feat = feats.get(featName.toLowerCase());
      if (!feat) { notes.push(`Feat "${featName}" not found`); continue; }
      add(feat.toObject());
      const grant = feat.system.grantsTechnique;
      if (grant) {
        const tech = techniques.get(grant.toLowerCase());
        if (tech) add(tech.toObject());
        else notes.push(`Technique "${grant}" not found`);
      }
    }

    add(background.toObject());
    const { found, missing } = await matchKitItems(parseKit(background.system.equipmentKit));
    for (const doc of found) {
      // Worn kit starts equipped so its Resistance or Skill bonus applies at once.
      if (["armor", "shield", "ward", "charm"].includes(doc.system?.category)) doc.system.equipped = true;
      add(doc);
    }
    if (missing.length) notes.push(`Kit not found: ${missing.join(", ")}`);

    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
    const innate = await grantStartingKit(actor);

    ui.notifications?.info(`Starting character built: ${toCreate.length + innate} items added. Set FOIL traits and answer the prompts to finish (PHB 2.5.0 steps 5 and 6).`);
    if (notes.length) ui.notifications?.warn(notes.join(" · "));
  }
}
