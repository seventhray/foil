/**
 * src/migrate-consumables.js
 * Consumables became their own item type (PHB 7.9.5, user 2026-10-27). An Equipment item still in a legacy consumable category
 * (medicine, potion) is made again as a Consumable and the old item deleted, since an Item's type can't change in place. Its uses
 * and duration come from the Consumables compendium entry of the same name, when there is one. Run once by the active GM.
 */
import { LEGACY_CONSUMABLE_CATEGORIES } from "./constants.js";

function asConsumable(item, packed) {
  const s = item.system;
  const p = packed?.system ?? {};
  return {
    name: item.name, type: "consumable", img: packed?.img ?? item.img,
    system: {
      effect: s.effect || p.effect || "", duration: p.duration ?? "", uses: p.uses ?? "1", price: s.price ?? p.price ?? 0,
      weight: s.weight ?? p.weight ?? 0, tier: Math.max(0, Math.min(5, Number(p.tier ?? 0))), materials: s.materials ?? "",
      location: s.location === "stored" ? "stored" : "carried", storedAt: s.storedAt ?? "", notes: s.notes ?? "", description: s.description ?? ""
    }
  };
}

export async function migrateConsumables() {
  const legacy = i => i.type === "equipment" && LEGACY_CONSUMABLE_CATEGORIES.includes(i.system.category);
  const pack = game.packs.get("foil.consumables");
  const index = pack ? await pack.getDocuments() : [];
  const packed = name => index.find(d => d.name.toLowerCase() === String(name).toLowerCase()) ?? null;
  const worldOld = game.items.filter(legacy);
  if (worldOld.length) {
    await Item.createDocuments(worldOld.map(i => asConsumable(i, packed(i.name))));
    await Item.deleteDocuments(worldOld.map(i => i.id));
  }
  let moved = worldOld.length;
  for (const actor of game.actors) {
    const old = actor.items.filter(legacy);
    if (!old.length) continue;
    await actor.createEmbeddedDocuments("Item", old.map(i => asConsumable(i, packed(i.name))));
    await actor.deleteEmbeddedDocuments("Item", old.map(i => i.id));
    moved += old.length;
  }
  if (moved) console.log(`FOIL | Moved ${moved} items to Consumables`);
}
