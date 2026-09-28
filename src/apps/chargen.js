/**
 * src/apps/chargen.js
 * FOIL character generator (PHB §2.5.0, six steps). Assigns the four fixed
 * starting Attribute-Dice pools, grants the chosen Ancestry (and its Feat) and
 * Background (and its Equipment kit), and ensures the innate Instruments and
 * starting Techniques every character knows are present. Item modifiers
 * (Background Training, worn Equipment Resistance) flow through the actor's
 * derivation automatically (see src/modifiers.js), so nothing is baked in.
 */

import { ATTRIBUTE_KEYS } from "../constants.js";

// The four fixed starting pools (PHB §2.5.0 step 1), as per-size die counts.
export const STARTING_POOLS = [
  { label: "1d6",  dice: { d6: 1 } },
  { label: "1d8",  dice: { d8: 1 } },
  { label: "1d10", dice: { d10: 1 } },
  { label: "1d12", dice: { d12: 1 } }
];

// Starting Point tiers (GMG §2.1.0): picked for the whole party, sets Starting
// XP and a Starting Coin guess. Coin stays editable — these are guesses, not
// fixed values, per the book's own framing.
export const STARTING_TIERS = [
  { key: "fresh",     label: "Fresh Start (0 XP, 15-30p)",      xp: 0,   coin: "15-30p" },
  { key: "blooded",   label: "Blooded (60 XP, 150p)",           xp: 60,  coin: "150p" },
  { key: "hardened",  label: "Hardened (150 XP, 400p)",         xp: 150, coin: "400p" },
  { key: "storied",   label: "Storied (300 XP, 900p)",          xp: 300, coin: "900p" },
  { key: "legendary", label: "Legendary (600+ XP, 2000p+)",     xp: 600, coin: "2000p+" }
];

const INNATE_INSTRUMENTS = ["Unarmed", "Mouth"];
const STARTING_TECHNIQUES = ["Strike", "Shot", "Grapple", "Jeer", "Rally"];

const ATTR_LABEL = { might: "Might", finesse: "Finesse", wit: "Wit", presence: "Presence" };

/** Split a Background kit string ("Longsword, Leather armor, Rope (50ft).") into item names. */
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
 * Tries the exact name, then the name with any parenthetical stripped.
 * @returns {{ found: object[], missing: string[] }}
 */
export async function matchKitItems(kitNames) {
  const instruments = await packDocsByName("foil.instruments");
  const equipment = await packDocsByName("foil.equipment");
  const found = [], missing = [];
  for (const name of kitNames) {
    const key = name.toLowerCase();
    const base = key.replace(/\s*\(.*?\)\s*/g, "").trim();           // strip "(50ft)"
    const bare = base.replace(/\s+(armor|armour|shield|ward)$/, "").trim(); // "leather armor" → "leather"
    const doc = instruments.get(key) || equipment.get(key)
             || instruments.get(base) || equipment.get(base)
             || instruments.get(bare) || equipment.get(bare);
    if (doc) found.push(doc.toObject());
    else missing.push(name);
  }
  return { found, missing };
}

/** Pull named docs from a pack, skipping any the actor already has (by name). */
async function pickFromPack(packName, names, existing) {
  const map = await packDocsByName(packName);
  const out = [];
  for (const n of names) {
    if (existing.has(n.toLowerCase())) continue;
    const d = map.get(n.toLowerCase());
    if (d) out.push(d.toObject());
  }
  return out;
}

/**
 * Ensure the innate Instruments (Unarmed, Mouth) and the five starting
 * Techniques are on the actor. Idempotent — safe to call on every character.
 * @returns {number} how many items were created
 */
export async function grantStartingKit(actor) {
  const existing = new Set(actor.items.map(i => i.name.toLowerCase()));
  const toCreate = [
    ...await pickFromPack("foil.instruments", INNATE_INSTRUMENTS, existing),
    ...await pickFromPack("foil.techniques", STARTING_TECHNIQUES, existing)
  ];
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
    window: { title: "FOIL Character Generator", icon: "fas fa-wand-magic-sparkles" },
    position: { width: 460, height: "auto" },
    form: { handler: FoilChargen._onSubmit, closeOnSubmit: true }
  };

  static PARTS = { main: { template: "systems/foil/templates/apps/chargen.hbs" } };

  async _prepareContext() {
    const idx = async pack => [...((await game.packs.get(pack)?.getIndex()) ?? [])]
      .map(e => ({ id: e._id, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      actorName: this.actor?.name ?? "",
      attributes: ATTRIBUTE_KEYS.map(k => ({ key: k, label: ATTR_LABEL[k] })),
      pools: STARTING_POOLS.map((p, i) => ({ index: i, label: p.label })),
      startingTiers: STARTING_TIERS,
      origins: await idx("foil.origins"),
      backgrounds: await idx("foil.backgrounds")
    };
  }

  static async _onSubmit(event, form, formData) {
    const actor = this.actor;
    if (!actor) return;
    const data = foundry.utils.expandObject(formData.object);

    // 1. Attribute pools — must be a permutation of the four fixed pools.
    // Foundry only keeps the dialog open (and shows this message) if the
    // handler throws — a plain notify()+return still lets closeOnSubmit close
    // it, silently discarding the user's picks (see application.mjs
    // _onSubmitForm: `if (closeOnSubmit) await this.close()` runs unless the
    // handler throws). Blank selects must be caught explicitly: Number("") is
    // 0, not NaN, so a left-blank pool would otherwise silently pass as "1d6".
    const assign = data.pool ?? {};
    if (ATTRIBUTE_KEYS.some(k => assign[k] === undefined || assign[k] === "")) {
      throw new Error("Assign each of the four starting pools to a different Attribute.");
    }
    const chosen = ATTRIBUTE_KEYS.map(k => Number(assign[k]));
    const used = new Set(chosen);
    if (chosen.some(n => Number.isNaN(n)) || used.size !== ATTRIBUTE_KEYS.length) {
      throw new Error("Assign each of the four starting pools to a different Attribute.");
    }
    const attrUpdate = {};
    ATTRIBUTE_KEYS.forEach((k, i) => {
      const pool = STARTING_POOLS[chosen[i]];
      for (const size of ["d4", "d6", "d8", "d10", "d12", "d20"]) {
        attrUpdate[`system.attributes.${k}.dice.${size}`] = pool.dice[size] ?? 0;
      }
    });
    // Starting Point (GMG §2.1.0) sets Starting XP; Coin is an editable guess
    // that defaults to the tier's suggestion but takes an explicit override.
    const tier = STARTING_TIERS.find(t => t.key === data.startingPoint);
    if (tier) attrUpdate["system.xp.total"] = tier.xp;
    const coin = data.coin ? String(data.coin) : (tier ? tier.coin : "");
    if (coin) attrUpdate["system.coin"] = coin;
    await actor.update(attrUpdate);

    // 2–3. Ancestry (+ its Feat) and Background (+ its kit), plus innate kit.
    const existing = new Set(actor.items.map(i => i.name.toLowerCase()));
    const toCreate = [];
    const notes = [];

    const originName = data.origin;
    if (originName) {
      const origins = await packDocsByName("foil.origins");
      const origin = origins.get(originName.toLowerCase());
      if (origin && !existing.has(origin.name.toLowerCase())) {
        toCreate.push(origin.toObject());
        const featName = origin.system?.feat;
        if (featName && !existing.has(featName.toLowerCase())) {
          const feats = await packDocsByName("foil.feats");
          const feat = feats.get(featName.toLowerCase());
          if (feat) toCreate.push(feat.toObject());
          else notes.push(`Feat "${featName}" not found`);
        }
      }
    }

    const backgroundName = data.background;
    if (backgroundName) {
      const backgrounds = await packDocsByName("foil.backgrounds");
      const bg = backgrounds.get(backgroundName.toLowerCase());
      if (bg && !existing.has(bg.name.toLowerCase())) {
        toCreate.push(bg.toObject());
        const { found, missing } = await matchKitItems(parseKit(bg.system?.equipmentKit));
        for (const doc of found) {
          if (existing.has(doc.name.toLowerCase())) continue;
          // Worn kit items start equipped so their Resistance applies at once.
          if (["armor", "shield", "ward"].includes(doc.system?.category)) doc.system.equipped = true;
          toCreate.push(doc);
        }
        if (missing.length) notes.push(`Kit not found: ${missing.join(", ")}`);
      }
    }

    if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
    const innate = await grantStartingKit(actor);

    ui.notifications?.info(`Character generated: ${toCreate.length + innate} items added.`);
    if (notes.length) ui.notifications?.warn(notes.join(" · "));
  }
}
