/** Replays tools/verify/vectors/stress.json against rules/stress.js (landStress) and rules/sheet.js (nextIncapacitated). */
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";
const { landStress } = await import(`${SYSTEM_ROOT}/rules/stress.js`);
const { nextIncapacitated } = await import(`${SYSTEM_ROOT}/rules/sheet.js`);
const v = JSON.parse(fs.readFileSync(path.join(SYSTEM_ROOT, "tools", "verify", "vectors", "stress.json"), "utf8"));
let bad = 0;
for (const c of v.stress) {
  const { potentials, aim, amount, policy } = c.in;
  const pot = { ...potentials }, asked = [];
  const run = landStress({ potentials, aim, amount });
  let step = run.next();
  while (!step.done) {
    const ev = step.value;
    if (ev.type === "take") { pot[ev.attr] = ev.after; step = run.next(); }
    else { asked.push({ attr: ev.attr, left: ev.left, room: ev.room }); step = run.next(policy === "first" ? ev.room[0] : policy === "last" ? ev.room[ev.room.length - 1] : undefined); }
  }
  const got = { applied: step.value.applied, destroyed: step.value.destroyed, asked, potentials: pot };
  if (JSON.stringify(got) !== JSON.stringify(c.out)) { bad++; if (bad <= 5) console.log("  FAIL  overflow", JSON.stringify(c.in), "\n    got ", JSON.stringify(got), "\n    want", JSON.stringify(c.out)); }
}
console.log(`  ${v.stress.length - bad} of ${v.stress.length} Stress overflow vectors match`);
let badI = 0;
for (const c of v.incap) if (nextIncapacitated(c.in.was, c.in.current, c.in.max) !== c.out) { badI++; if (badI <= 5) console.log("  FAIL  incapacitated", JSON.stringify(c.in)); }
console.log(`  ${v.incap.length - badI} of ${v.incap.length} Incapacitation vectors match`);
process.exit(bad || badI ? 1 : 0);
