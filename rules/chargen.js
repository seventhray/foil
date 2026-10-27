/**
 * rules/chargen.js
 * Starting Character (PHB 2.5.0), the parts that are only rules: the Origin's Talent, the Talent roll's order, the starting
 * pools with the Background's Know-how, the Background kit's item names, and the Starting Points. Pure: Foundry's chargen
 * window and the companion app both build from these.
 */
import { ATTRIBUTE_KEYS } from "./constants.js";

// Starting Points (PHB 2.3.2): picked for the whole party, sets Starting XP and Starting Coin.
// The coin is the bottom of the printed range; Fresh Start takes its Background's.
export const STARTING_TIERS = [
  { key: "fresh",     label: "Fresh Start (0 XP, Background coin)", xp: 0 },
  { key: "blooded",   label: "Blooded (175 XP, 175p)",              xp: 175,  coin: "175p" },
  { key: "hardened",  label: "Hardened (400 XP, 400p)",             xp: 400,  coin: "400p" },
  { key: "storied",   label: "Storied (825 XP, 825p)",              xp: 825,  coin: "825p" },
  { key: "legendary", label: "Legendary (1600 XP, 1600p)",          xp: 1600, coin: "1600p" }
];

export const INNATE_INSTRUMENTS = ["Body", "Voice", "Mind"];
export const NEXT_SIZE = { 4: 6, 6: 8, 8: 10, 10: 12 };
// The Talent roll (PHB 2.5.1): three passes over the two dice in each pool.
export const TALENT_PASSES = 3;
export const TALENT_ROLLS = TALENT_PASSES * ATTRIBUTE_KEYS.length * 2;
// Worn kit starts equipped so its Resistance or Skill bonus applies at once.
export const WORN_CATEGORIES = ["armor", "shield", "ward", "charm"];

/** Split a Background kit string ("Longsword, Leather armor, Traveler Pack.") into item names. */
export function parseKit(kit) {
  return String(kit ?? "").replace(/\.\s*$/, "").split(",").map(s => s.trim()).filter(Boolean);
}

/** A kit item by name, from maps of lower-cased name to item ("Leather armor" is Leather, "50ft of rope" is Rope (50ft)). */
export function findKitItem(name, instruments, equipment) {
  const key = name.toLowerCase().replace(/^50ft of rope$/, "rope (50ft)");
  const bare = key.replace(/\s+(armor|armour)$/, "").trim();
  return instruments.get(key) || equipment.get(key) || instruments.get(bare) || equipment.get(bare) || null;
}

/** Each pool's two base dice after the Origin's Talent and the rolls so far, as die sizes. */
export function talentDice(origin, rolls = []) {
  const dice = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, [4, 4]]));
  for (const t of origin?.system?.talent ?? []) {
    const i = dice[t.attribute]?.indexOf(4) ?? -1;
    if (i >= 0) dice[t.attribute][i] = Number(t.die);
  }
  for (const r of rolls) if (r.advanced) dice[r.attribute][r.index] = r.to;
  return dice;
}

/** Which die the next Talent roll is for: pass by pass, Attribute by Attribute, die by die; null when all are rolled. */
export function nextTalentRoll(n) {
  if (n >= TALENT_ROLLS) return null;
  const perPass = ATTRIBUTE_KEYS.length * 2;
  const inPass = n % perPass;
  return { pass: Math.floor(n / perPass) + 1, attribute: ATTRIBUTE_KEYS[Math.floor(inPass / 2)], index: inPass % 2 };
}

/** One Talent roll: the die's current size, what it showed, and whether it advanced (its highest, up to d12). */
export function talentRoll(origin, rolls, result) {
  const next = nextTalentRoll(rolls.length);
  if (!next) return null;
  const size = talentDice(origin, rolls)[next.attribute][next.index];
  const advanced = Number(result) === size && size in NEXT_SIZE;
  return { ...next, size, result: Number(result), advanced, to: advanced ? NEXT_SIZE[size] : size };
}

/** The starting pools (PHB 2.5.0 steps 1-3): Origin Talent, the Talent rolls, then Background Know-how d4s, never rolled. */
export function startingPools(origin, background, rolls = []) {
  const pools = Object.fromEntries(ATTRIBUTE_KEYS.map(k => [k, {}]));
  for (const [k, sizes] of Object.entries(talentDice(origin, rolls)))
    for (const size of sizes) pools[k][`d${size}`] = (pools[k][`d${size}`] ?? 0) + 1;
  for (const a of background?.system?.knowHow ?? []) if (pools[a]) pools[a].d4 = (pools[a].d4 ?? 0) + 1;
  return pools;
}
