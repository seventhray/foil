/**
 * The synchronous driver (rules/flow.js driveSync, which a SpacetimeDB reducer uses) must give the same results as the
 * async driver on the same flows, never return a promise, and let an error thrown by the host leave the flow.
 */
import "./stub-foundry.mjs";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";

const M = await import(`${SYSTEM_ROOT}/src/data/item-models.js`);
const A = await import(`${SYSTEM_ROOT}/src/data/actor-models.js`);
const R = await import(`${SYSTEM_ROOT}/rules/roll.js`);
const O = await import(`${SYSTEM_ROOT}/rules/oppose.js`);
const F = await import(`${SYSTEM_ROOT}/rules/flow.js`);
const { registryFromDocs } = await import(`${SYSTEM_ROOT}/rules/definitions.js`);

const packDir = n => path.join(SYSTEM_ROOT, "src", "packs", n);
const docs = n => fs.readdirSync(packDir(n)).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort().map(f => JSON.parse(fs.readFileSync(path.join(packDir(n), f), "utf8"))).filter(d => d.system);
globalThis.CONFIG = { FOIL: { instrumentTypes: registryFromDocs(docs("instrument-types")), effects: registryFromDocs(docs("effects")) } };
const plain = o => JSON.parse(JSON.stringify(o));
const ITEM = { instrument: M.InstrumentData, technique: M.TechniqueData, equipment: M.EquipmentData };
function buildActor(doc) {
  const items = (doc.items ?? []).filter(i => ITEM[i.type]).map(i => { const m = new ITEM[i.type](i.system); m.prepareDerivedData(); return { id: i._id, name: i.name, type: i.type, system: plain({ ...m }) }; });
  const sys = new A.CreatureData(plain(doc.system), { parent: { items: { contents: items } } });
  sys.prepareDerivedData();
  return { id: doc._id, name: doc.name, type: "creature", system: plain({ ...sys }), items };
}

let bad = 0, n = 0;
const formulas = new Set();
const say = m => { bad++; if (bad <= 5) console.log("  FAIL  " + m); };

// 1. Rolls: the same flow through both drivers, with a host that answers at once.
function host(actor) {
  const posted = [], events = [], warnings = [];
  const a = plain(actor);
  return {
    posted, events, warnings,
    io: {
      warn: m => warnings.push(m),
      pickSkill: ({ choices }) => choices[0],
      pickInstrument: ({ valid, skill, skillsOf }) => ({ instrumentId: valid[0].id, skill: skill || skillsOf(valid[0])[0] }),
      pickEnchantSkill: ({ inst }) => inst.system.primarySkills[0],
      aim: () => ({ targets: [], notes: [], aim: "might", typeIndex: "", other: 0 }),
      rangeNotes: () => [],
      takeStress: (k, amount) => { const before = a.system.attributes[k].potential.current, after = Math.max(0, before - amount); a.system.attributes[k].potential.current = after; return { before, after }; },
      log: (type, d) => events.push({ type, ...d }),
      post: p => { posted.push(p); }
    },
    actor: a
  };
}
const picked = docs("bestiary").filter((_, i) => i % 9 === 0);
for (const doc of picked) {
  const base = buildActor(doc);
  const jobs = [];
  for (const i of base.items) {
    if (i.type === "technique") jobs.push(["technique", i.id]);
    if (i.type === "instrument") (i.system.kit ?? []).forEach((_, index) => jobs.push(["kit", i.id, index]));
  }
  for (const s of ["prowess", "acuity"]) jobs.push(["skill", s]);
  for (const [kind, id, index] of jobs) {
    n++;
    const run = async mode => {
      const h = host(base), a = h.actor, fmt = R.PLAIN;
      const steps = kind === "skill" ? R.rollSkillSteps({ actor: a, skill: id, fmt })
        : kind === "kit" ? R.rollKitSteps({ actor: a, inst: a.items.find(i => i.id === id), index, fmt })
        : R.rollTechniqueSteps({ actor: a, tech: a.items.find(i => i.id === id), fmt });
      let ret;
      if (mode === "sync") { ret = F.driveSync(steps, h.io); if (ret && typeof ret.then === "function") say("driveSync returned a promise"); }
      else await F.driveAsync(steps, h.io);
      for (const p of h.posted) formulas.add(p.formula);
      return JSON.stringify({ posted: h.posted, events: h.events, warnings: h.warnings, p: a.system.attributes });
    };
    const [s, a] = [await run("sync"), await run("async")];
    if (s !== a) say(`${doc.name} ${kind} ${id}: the drivers disagree`);
  }
}
console.log(`  ${n} roll flows give the same result through both drivers`);

// 1b. The dice evaluator reads every formula the flows wrote, and its extremes match the formula.
{
  const { rollFormula } = await import(`${SYSTEM_ROOT}/rules/dice.js`);
  let ok = 0;
  for (const f of formulas) {
    try {
      const lo = rollFormula(f, () => 1), hi = rollFormula(f, faces => faces);
      const counted = [...f.matchAll(/(?:^|[+\s-])(\d*)d(\d+)/g)].reduce((t, m) => t + (m[1] === "" ? 1 : Number(m[1])), 0);
      const flat = [...f.matchAll(/(?:^|\s)([+-]?\s*\d+)\[/g)].reduce((t, m) => t + Number(m[1].replace(/\s/g, "")), 0) + (/^\d+$/.test(f.trim()) ? Number(f) : 0);
      if (lo.dice.length !== counted || lo.total !== lo.dice.length + flat || hi.total !== hi.dice.reduce((t, d) => t + d.faces, 0) + flat) say(`rollFormula disagrees with "${f}"`);
      else ok++;
    } catch (e) { say(`rollFormula cannot read "${f}": ${e.message}`); }
  }
  for (const bad of ["1d", "d", "x", "1d6 2d4", "2d1"]) { let threw = false; try { rollFormula(bad, () => 1); } catch { threw = true; } if (!threw) say(`rollFormula accepted "${bad}"`); }
  if (rollFormula("0", () => 1).total !== 0 || rollFormula("1d6[A] - 2[B]", () => 4).total !== 2) say("rollFormula mishandled 0 or a subtraction");
  console.log(`  rollFormula reads all ${ok} distinct formulas the flows wrote, and refuses malformed ones`);
}

// 2. A host error leaves the flow, and a flow can catch it.
{
  let threw = false;
  try { F.driveSync(R.rollSkillSteps({ actor: buildActor(picked[0]), skill: "prowess" }), { post: () => { throw new Error("host failed"); } }); } catch (e) { threw = e.message === "host failed"; }
  if (!threw) say("an error thrown by the host did not leave driveSync");
  let missing = false;
  try { F.driveSync(R.rollSkillSteps({ actor: buildActor(picked[0]), skill: "prowess" }), {}); } catch (e) { missing = /cannot do "post"/.test(e.message); }
  if (!missing) say("a request the host cannot do was not reported");
  let caught = null;
  const flow = (function* () { try { yield ["boom"]; } catch (e) { caught = e.message; } return "ok"; })();
  const ret = F.driveSync(flow, { boom: () => { throw new Error("handled"); } });
  if (caught !== "handled" || ret !== "ok") say("a flow could not catch a host error");
  console.log("  host errors leave a flow, and a flow can catch them");
}

// 3. Oppose through the sync driver on one scripted case.
{
  const atk = buildActor(docs("bestiary")[0]), def = buildActor(docs("bestiary")[1]);
  const cards = [];
  const flag = { name: "Strike", attackTotal: 30, instrument: "x", cap: 12, capLabel: "cap", mult: 1, multLabel: "Light", types: [], bespoke: 0, bespokeParts: [], pierce: 0, pierceParts: [], attackInfo: { types: [], families: [], materials: "" }, melee: true, aim: "might", typeIndex: "", other: 0 };
  const taken = [];
  F.driveSync(O.resolveOpposeSteps({ defender: def, attacker: atk, flag, fmt: O.PLAIN }), {
    askOppose: () => ({ skill: "prowess" }), rollOppose: ({ formula }) => ({ total: 5, formula, dice: [] }), askReroll: () => null, card: (k, d) => cards.push(k),
    askApplyStress: ({ amount }) => ({ amount }), askOverflow: () => null, takeStress: (k, a) => { taken.push([k, a]); return { before: 1, after: 0 }; }, log: () => {}, setFoilTokens: () => {}, updateConditions: () => {}
  });
  if (!cards.includes("stress") || !taken.length) say("the Oppose flow did not run to Stress through driveSync");
  console.log("  the Oppose flow runs to Stress through the sync driver");
}
process.exit(bad ? 1 : 0);
