/**
 * Writes tools/verify/vectors/stress.json: how Stress lands and overflows (PHB 6.8.1) and when an
 * Attribute becomes or stops being Incapacitated, from the reference loops below. Those loops are the
 * code that sat in src/oppose.js (applyStress) and src/actor/actor.js (_preUpdate) before it moved to
 * rules/. verify-stress-vectors.mjs replays the vectors against rules/stress.js and rules/sheet.js.
 * Rerun only when the rule changes on purpose:  node tools/verify/capture-stress-vectors.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";

const KEYS = ["might", "finesse", "wit", "presence"];
const recoveryThreshold = max => max - Math.floor(max / 2);

function reference({ potentials, aim, amount, policy }) {
  const pot = { ...potentials };
  const potentialOf = k => pot[k];
  let left = amount, attr = aim, destroyed = false;
  const applied = [], asked = [];
  while (left > 0) {
    const take = Math.min(left, potentialOf(attr));
    if (take > 0) {
      pot[attr] = Math.max(0, pot[attr] - take);
      applied.push({ attr, amount: take });
      left -= take;
    }
    if (left <= 0) break;
    const room = KEYS.filter(k => k !== attr && potentialOf(k) > 0);
    if (!room.length) { destroyed = true; break; }
    if (room.length === 1) attr = room[0];
    else {
      asked.push({ attr, left, room });
      const answer = policy === "first" ? room[0] : policy === "last" ? room[room.length - 1] : undefined;
      attr = room.includes(answer) ? answer : room[0];
    }
  }
  return { applied, destroyed, asked, potentials: pot };
}

let seed = 20261022;
const rnd = n => {                       // mulberry32, so the low bits are usable
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
};
const sizes = [0, 1, 3, 6, 10, 14];
const stress = [];
for (let i = 0; i < 700; i++) {
  const potentials = Object.fromEntries(KEYS.map(k => [k, sizes[rnd(sizes.length)]]));
  const aim = KEYS[rnd(4)], amount = [0, 1, 4, 9, 14, 20, 30, 45, 80][rnd(9)], policy = ["first", "last", "invalid"][rnd(3)];
  stress.push({ in: { potentials, aim, amount, policy } });
}
stress.push({ in: { potentials: { might: 0, finesse: 0, wit: 0, presence: 0 }, aim: "might", amount: 5, policy: "first" } });
stress.push({ in: { potentials: { might: 5, finesse: 0, wit: 0, presence: 0 }, aim: "might", amount: 5, policy: "first" } });
stress.push({ in: { potentials: { might: 5, finesse: 0, wit: 0, presence: 0 }, aim: "might", amount: 6, policy: "first" } });
for (const c of stress) c.out = reference(c.in);

const incap = [];
for (const was of [false, true]) for (const max of [0, 1, 5, 10, 11, 12, 36]) for (let cur = -1; cur <= max + 1; cur++) {
  let now = was;
  if (max > 0 && cur <= 0) now = true;
  else if (was && cur >= recoveryThreshold(max)) now = false;
  incap.push({ in: { was, current: cur, max }, out: now });
}
fs.writeFileSync(path.join(SYSTEM_ROOT, "tools", "verify", "vectors", "stress.json"), JSON.stringify({ stress, incap }));
const asked = stress.filter(c => c.out.asked.length).length, dest = stress.filter(c => c.out.destroyed).length;
console.log(`wrote ${stress.length} overflow vectors (${asked} ask where to place the rest, ${dest} Destroy the target) and ${incap.length} Incapacitation vectors`);
