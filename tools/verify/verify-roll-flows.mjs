/**
 * Runs the rolling code as it was (tools/verify/reference-roll-old.mjs, frozen from the sheet) and as it is
 * (rules/roll.js) over the same actors, items, targets and scripted answers, and requires the same formula,
 * title, card text, flags, Strain, log events, warnings and number of questions asked. The answers are
 * given in order to whichever dialog asks, so a flow that asks different questions fails. A third run drives the
 * real sheet (src/actor/actor-sheet.js) with Foundry's classes faked, so the sheet's own dialogs and glue are
 * held to the same result.
 */
import "./stub-foundry.mjs";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";
import { RefSheet, env, reset } from "./reference-roll-old.mjs";

// Enough of Foundry for the real sheet to load and roll.
const noop = () => {};
let logged = [];
globalThis.foundry.applications = { api: { HandlebarsApplicationMixin: B => B, ApplicationV2: class {}, DialogV2: { prompt: async () => (env.answers.length ? env.answers.shift() : null) } },
  sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} }, ux: {} };
globalThis.Hooks = { on: noop, once: noop, call: noop, callAll: noop };
globalThis.ui = { notifications: { warn: m => env.warnings.push(m), info: noop }, windows: {} };
globalThis.game = {
  get user() { return { targets: env.targets, isGM: true, name: "GM" }; }, ready: true, users: { activeGM: { isSelf: true } }, world: { id: "w" }, actors: { get: noop }, packs: new Map(),
  settings: { get: (ns, key) => (key === "logPlaytest" ? true : key === "playtestLog" ? logged : null), set: async (ns, key, v) => { if (key === "playtestLog") logged = v; } }
};
globalThis.Handlebars = { registerHelper: noop };
globalThis.ChatMessage = { getSpeaker: () => ({}), create: noop };
globalThis.Roll = class { constructor(f) { this.formula = f; this.total = 17; this.dice = []; } async evaluate() { return this; } async toMessage({ flavor, flags }) { env.posted.push({ formula: this.formula, flavor, flags }); } };
globalThis.document = { createElement: () => ({}) };
globalThis.window = {};

const M = await import(`${SYSTEM_ROOT}/src/data/item-models.js`);
const { FoilCharacterSheet } = await import(`${SYSTEM_ROOT}/src/actor/actor-sheet.js`);
const A = await import(`${SYSTEM_ROOT}/src/data/actor-models.js`);
const R = await import(`${SYSTEM_ROOT}/rules/roll.js`);
const { registryFromDocs } = await import(`${SYSTEM_ROOT}/rules/definitions.js`);

const packDir = n => path.join(SYSTEM_ROOT, "src", "packs", n);
const docs = n => fs.readdirSync(packDir(n)).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort().map(f => JSON.parse(fs.readFileSync(path.join(packDir(n), f), "utf8"))).filter(d => d.system);
globalThis.CONFIG = { FOIL: { instrumentTypes: registryFromDocs(docs("instrument-types")), effects: registryFromDocs(docs("effects")) } };
const plain = o => JSON.parse(JSON.stringify(o));
const ITEM = { instrument: M.InstrumentData, technique: M.TechniqueData, equipment: M.EquipmentData };

const techEffects = docs("techniques").find(d => (d.system.effects ?? []).length > 1)?.system.effects ?? [];
const KINDS = ["roll", "pierce", "stress", "skill"];
/** Dress an Instrument's data with a bonus, an enchanted bonus and a bound Enchantment. */
function dress(system, n) {
  const s = plain(system);
  if (s.innate) return s;
  s.bonus = 1 + (n % 3);
  s.enchantment = { ...(s.enchantment ?? {}), enabled: true, effects: techEffects, bonus: { kind: KINDS[n % 4], n: 2, skill: "prowess" } };
  return s;
}
function buildActor(doc, conditions = [], gear = false) {
  let k = 0;
  const items = (doc.items ?? []).filter(i => ITEM[i.type]).map(i => { const m = new ITEM[i.type](gear && i.type === "instrument" ? dress(i.system, k++) : i.system); m.prepareDerivedData(); return { id: i._id, name: i.name, type: i.type, system: plain({ ...m }) }; });
  const sys = new A.CreatureData({ ...plain(doc.system), conditions }, { parent: { items: { contents: items } } });
  sys.prepareDerivedData();
  return { id: doc._id, name: doc.name, uuid: `Actor.${doc._id}`, system: plain({ ...sys }), items };
}
const clone = a => plain(a);
const withTake = actor => {            // the actor's takeStress, as Actor.takeStress does it
  actor.items.get = id => actor.items.find(i => i.id === id);
  actor.getActiveTokens = () => [];
  actor.takeStress = async (key, amount) => {
    const before = Number(actor.system.attributes?.[key]?.potential?.current ?? 0), after = Math.max(0, before - Math.max(0, Number(amount) || 0));
    actor.system.attributes[key].potential.current = after;
    return { before, after };
  };
  return actor;
};
const token = (name, conditions = []) => ({ name, document: { uuid: `Scene.T.${name}` }, actor: { id: `a-${name}`, system: { conditions } }, center: {} });

const norm = r => ({
  posted: r.posted.map(p => ({ formula: p.formula, flavor: p.flavor, flags: p.flags })),
  events: r.events.map(e => ({ type: e.type, data: { ...e.data, actor: undefined } })),
  warnings: r.warnings,
  left: r.left
});
const snapshot = actor => plain(actor.system.attributes && Object.fromEntries(Object.entries(actor.system.attributes).map(([k, v]) => [k, v.potential.current])));

async function runOld(actor, kind, arg, answers, targets) {
  const a = withTake(clone(actor));
  a.getActiveTokens = () => [];
  // Foundry's Collection .get, with the Actor's own takeStress
  a.items = Object.assign([...a.items], { get: id => a.items.find(i => i.id === id), filter: (...x) => Array.prototype.filter.apply([...a.items], x) });
  a.takeStress = withTake(clone(a)).takeStress.bind(a);
  const ref = new RefSheet(a);
  reset(answers, targets);
  const ev = {}, tg = (id, index) => ({ dataset: { key: arg, index }, closest: () => ({ dataset: { itemId: id } }) });
  if (kind === "skill") await RefSheet._onRollSkill.call(ref, ev, { dataset: { key: arg } });
  else if (kind === "kit") await RefSheet._onRollKit.call(ref, ev, tg(arg.id, arg.index));
  else if (kind === "technique") await RefSheet._onRollTechnique.call(ref, ev, tg(arg, 0));
  else await RefSheet._onRollEnchantment.call(ref, ev, tg(arg, 0));
  env.left = env.answers.length;
  return { ...norm(env), strain: snapshot(a) };
}
const safe = f => async (...x) => { try { return await f(...x); } catch (e) { return { error: String(e.message) }; } };

async function runNew(actor, kind, arg, answers, targets) {
  const a = withTake(clone(actor));
  a.items = Object.assign([...a.items], { get: id => a.items.find(i => i.id === id) });
  a.takeStress = withTake(clone(a)).takeStress.bind(a);
  const ref = new RefSheet(a);                     // only for the dialogs, token flags and range notes, which stay in Foundry
  reset(answers, targets);
  const io = {
    warn: m => env.warnings.push(m),
    pickSkill: async () => env.answers.length ? env.answers.shift().skill : null,
    pickInstrument: async () => env.answers.length ? env.answers.shift() : null,
    pickEnchantSkill: async () => env.answers.length ? env.answers.shift().skill : null,
    aim: ({ inst, name, text, requires }) => ref._aimAtTargets(inst, name, text, requires),
    rangeNotes: o => ref._rangeNotes(o),
    takeStress: (k, n) => a.takeStress(k, n),
    log: (type, data) => env.events.push({ type, data }),
    post: async ({ formula, title, note, payload }) => {
      const roll = { total: 17 };
      const flags = { foil: { reroll: { actorId: a.id, title, total: roll.total, dice: [] },
        ...(payload?.cond ? { cond: ref._condFlag() } : {}),
        ...(payload?.condition ? ref._conditionFlag(payload.condition.name, roll.total, payload.condition.condition, { melee: payload.condition.melee }) : {}),
        ...(payload?.stress ? R.stressPayload(a, payload.stress.inst, payload.stress.name, roll.total, payload.stress) : {}) } };
      const st = flags.foil.stress;     // the playtest log entry Foundry's _postRoll writes
      env.events.push({ type: "roll", data: {
        title, formula, total: roll.total, dice: [], notes: note ? String(note).replace(/<br>/g, " ").replace(/<[^>]+>/g, "") : "",
        attack: st ? { name: st.name, instrument: st.instrument, aim: st.aim, condition: st.condition?.name ?? null,
          targets: (st.targets ?? []).map(t => t.name), cap: st.cap, mult: st.mult, bespoke: st.bespoke, pierce: st.pierce,
          melee: st.melee, type: st.typeIndex === "" || st.typeIndex === undefined ? null : st.types?.[Number(st.typeIndex)]?.label ?? null } : null } });
      env.posted.push({ formula, flavor: `<div class="foil-flavor"><strong>${title}</strong>${note ? `<br><em>${note}</em>` : ""}</div>`, flags });
    }
  };
  const fmt = { esc: s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"), br: "<br>", arrow: "&rarr;" };
  if (kind === "skill") await R.rollSkill({ actor: a, skill: arg, io, fmt });
  else if (kind === "kit") await R.rollKit({ actor: a, inst: a.items.find(i => i.id === arg.id), index: arg.index, io, fmt });
  else if (kind === "technique") await R.rollTechnique({ actor: a, tech: a.items.find(i => i.id === arg), io, fmt });
  else await R.rollEnchantment({ actor: a, inst: a.items.find(i => i.id === arg), io, fmt });
  env.left = env.answers.length;
  return { ...norm(env), strain: snapshot(a) };
}

async function runSheet(actor, kind, arg, answers, targets) {
  const a = withTake(clone(actor));
  a.items = Object.assign([...a.items], { get: id => a.items.find(i => i.id === id) });
  a.takeStress = withTake(clone(a)).takeStress.bind(a);
  const sheet = Object.create(FoilCharacterSheet.prototype);
  sheet.actor = a;
  reset(answers, targets); logged = [];
  const ev = {}, tg = (id, index) => ({ dataset: { key: arg, index }, closest: () => ({ dataset: { itemId: id } }) });
  if (kind === "skill") await FoilCharacterSheet._onRollSkill.call(sheet, ev, { dataset: { key: arg } });
  else if (kind === "kit") await FoilCharacterSheet._onRollKit.call(sheet, ev, tg(arg.id, arg.index));
  else if (kind === "technique") await FoilCharacterSheet._onRollTechnique.call(sheet, ev, tg(arg, 0));
  else await FoilCharacterSheet._onRollEnchantment.call(sheet, ev, tg(arg, 0));
  await new Promise(r => setTimeout(r, 0));
  env.events = logged.map(({ t, world, session, user, combat, type, ...data }) => ({ type, data }));
  env.left = env.answers.length;
  return { ...norm(env), strain: snapshot(a) };
}

const bestiary = docs("bestiary");
const picked = bestiary.filter((_, i) => i % 6 === 0);
const mist = [{ name: "Invisible", rounds: "", note: "" }, { name: "Weakened", rounds: "", note: "might" }, { name: "Restrained", rounds: "", note: "" }];
let pierceSeen = 0, n = 0, bad = 0, withStress = 0, withStrain = 0, withCond = 0, withEnch = 0;
for (const doc of picked) {
  for (const [conditions, gear] of [[[], false], [mist, false], [[], true], [mist, true]]) {
    const actor = buildActor(doc, conditions, gear);
    const instIds = actor.items.filter(i => i.type === "instrument").map(i => i.id);
    const queues = id0 => [
      [], [{ skill: "prowess" }, { instrumentId: instIds[0], skill: "prowess" }, { aim: "might", type: "", other: 0 }, { skill: "prowess" }],
      [{ skill: "acuity" }, { instrumentId: instIds[instIds.length - 1], skill: "assertiveness" }, { aim: "wit", type: "0", other: 2 }, { skill: "resonance" }],
      [{ instrumentId: id0, skill: "discipline" }, { aim: "presence", type: "", other: -1 }, { skill: "discipline" }],
      [{ skill: "nonsense" }, { instrumentId: "missing", skill: "nonsense" }, { aim: "nonsense", type: "9", other: "x" }]
    ];
    const scenarios = [];
    for (const s of ["prowess", "discipline", "acuity", "resonance"]) scenarios.push(["skill", s, null]);
    for (const i of actor.items) {
      if (i.type === "instrument") {
        (i.system.kit ?? []).forEach((_, index) => scenarios.push(["kit", { id: i.id, index }, i.id]));
        if (i.system.enchantment?.enabled) scenarios.push(["enchantment", i.id, i.id]);
      }
      if (i.type === "technique") scenarios.push(["technique", i.id, i.id]);
    }
    for (const [kind, arg, id0] of scenarios) {
      for (const targets of [[], [token("Orc", [{ name: "Invisible", rounds: "", note: "" }])]]) {
        for (const answers of queues(id0 ?? instIds[0])) {
          n++;
          const o = await safe(runOld)(actor, kind, arg, answers, targets), w = await safe(runNew)(actor, kind, arg, answers, targets), sh = await safe(runSheet)(actor, kind, arg, answers, targets);
          if (JSON.stringify(o) !== JSON.stringify(sh)) { bad++; if (bad <= 4) { const x = JSON.stringify(o), y = JSON.stringify(sh); let i = 0; while (x[i] === y[i]) i++; console.log(`  FAIL (sheet)  ${doc.name} ${kind} ${JSON.stringify(arg).slice(0, 50)}\n    old ...${x.slice(Math.max(0, i - 60), i + 120)}\n    sheet ...${y.slice(Math.max(0, i - 60), i + 120)}`); } }
          if (o.posted?.some(p => p.flags?.foil?.stress)) withStress++;
          if (o.events?.some(e => e.type === "strain")) withStrain++;
          if (o.posted?.some(p => p.flags?.foil?.cond?.targets?.length)) withCond++;
          if (kind === "enchantment" && o.posted?.length) withEnch++;
          if (JSON.stringify(o) !== JSON.stringify(w)) {
            bad++;
            if (bad <= 4) {
              const a = JSON.stringify(o), b = JSON.stringify(w); let i = 0; while (a[i] === b[i]) i++;
              console.log(`  FAIL  ${doc.name} ${kind} ${JSON.stringify(arg).slice(0, 60)} answers ${JSON.stringify(answers).slice(0, 80)}\n    old ...${a.slice(Math.max(0, i - 60), i + 120)}\n    new ...${b.slice(Math.max(0, i - 60), i + 120)}`);
            }
          }
        }
      }
    }
  }
}

// An arcane Instrument at +1 and +3, and a Technique with Pierce, which no shipped creature has.
{
  const inst = docs("instruments").find(d => (d.system.types ?? []).includes("kinetic") && !d.system.innate);
  const base = docs("techniques").find(d => (d.system.effects ?? []).some(e => e.key === "stress") && (d.system.requires ?? []).includes("kinetic"));
  if (!inst || !base) { console.log("  FAIL  no kinetic Instrument or Technique to build the Pierce case"); process.exit(1); }
  const tech = plain(base); tech.system.effects = [...tech.system.effects, { key: "pierce", magnitude: 2, pattern: "single", bands: 0, placement: 0 }];
  for (const tier of [1, 3]) {
    const i2 = plain(inst); i2.system.bonus = tier;
    const actor = buildActor({ ...bestiary[0], items: [{ ...i2, _id: "inst1" }, { ...tech, _id: "tech1" }] });
    for (const targets of [[], [token("Orc")]]) for (const answers of [[{ aim: "might", type: "", other: 0 }], [{ instrumentId: "inst1", skill: "resonance" }, { aim: "wit", type: "0", other: 1 }], [{ instrumentId: "inst1", skill: "guile" }, { aim: "might", type: "", other: 0 }]]) {
      n++;
      const o = await safe(runOld)(actor, "technique", "tech1", answers, targets), w = await safe(runNew)(actor, "technique", "tech1", answers, targets), sh = await safe(runSheet)(actor, "technique", "tech1", answers, targets);
      if (JSON.stringify(o) !== JSON.stringify(sh)) { bad++; console.log(`  FAIL (sheet)  Pierce case +${tier}`); }
      if (JSON.stringify(o) !== JSON.stringify(w)) { bad++; console.log(`  FAIL  Pierce case +${tier}`); }
      else if (o.posted?.[0]?.flags?.foil?.stress?.pierceParts?.some(p => p.label === tech.name && p.value)) pierceSeen++;
    }
  }
}
if (!pierceSeen) { bad++; console.log("  FAIL  no scenario reached a Technique's Pierce part"); }
console.log(`  ${n - bad} of ${n} roll flows match the old sheet code (${withStress} post a Stress payload, ${withStrain} take Strain, ${withCond} carry targeted flags, ${withEnch} Enchantment rolls, ${pierceSeen} with a Technique's Pierce)`);
process.exit(bad ? 1 : 0);
