/**
 * Runs the Oppose code as it was (tools/verify/reference-oppose-old.mjs, frozen from src/oppose.js) and as it is
 * (rules/oppose.js, and the real src/oppose.js with Foundry faked) over the same defenders, cards, and scripted
 * answers, and requires the same chat cards, rolls, flags, log events, token and Potential changes, and number of
 * questions asked.
 */
import "./stub-foundry.mjs";
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_ROOT } from "../books.mjs";
import { resolveOppose as oldResolve, env, reset, Roll, ChatMessage } from "./reference-oppose-old.mjs";

// Enough of Foundry for the real src/oppose.js to load and run.
const noop = () => {};
let logged = [];
globalThis.foundry.applications = { sheets: { ActorSheetV2: class {}, ItemSheetV2: class {} }, ux: {}, api: { HandlebarsApplicationMixin: B => B, ApplicationV2: class {}, DialogV2: { prompt: async () => (env.answers.length ? env.answers.shift() : null) } } };
globalThis.Hooks = { on: noop, once: noop };
globalThis.ui = { notifications: { warn: m => env.warnings.push(m) } };
globalThis.game = {
  actors: { get: id => env.actors[id] }, user: { isGM: true, name: "GM" }, ready: true, users: { activeGM: { isSelf: true } }, world: { id: "w" },
  settings: { get: (ns, key) => (key === "logPlaytest" ? true : key === "playtestLog" ? logged : null), set: async (ns, key, v) => { if (key === "playtestLog") logged = v; } }
};
globalThis.ChatMessage = ChatMessage;
globalThis.Roll = Roll;
globalThis.document = { createElement: () => ({}) };
globalThis.window = {};

const M = await import(`${SYSTEM_ROOT}/src/data/item-models.js`);
const A = await import(`${SYSTEM_ROOT}/src/data/actor-models.js`);
const R = await import(`${SYSTEM_ROOT}/rules/oppose.js`);
const S = await import(`${SYSTEM_ROOT}/rules/sheet.js`);
const T = await import(`${SYSTEM_ROOT}/src/oppose-text.js`);
const { SKILL_LABEL } = await import(`${SYSTEM_ROOT}/rules/constants.js`);
const esc = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const { registryFromDocs } = await import(`${SYSTEM_ROOT}/rules/definitions.js`);

const packDir = n => path.join(SYSTEM_ROOT, "src", "packs", n);
const docs = n => fs.readdirSync(packDir(n)).filter(f => f.endsWith(".json") && !f.startsWith("_")).sort().map(f => JSON.parse(fs.readFileSync(path.join(packDir(n), f), "utf8"))).filter(d => d.system);
globalThis.CONFIG = { FOIL: { instrumentTypes: registryFromDocs(docs("instrument-types")), effects: registryFromDocs(docs("effects")) } };
const plain = o => JSON.parse(JSON.stringify(o));
const ITEM = { instrument: M.InstrumentData, technique: M.TechniqueData, equipment: M.EquipmentData };

/** A fake actor that behaves as Actor does for what Oppose touches: Potential, Foil Tokens and Conditions update the sheet. */
function makeActor(doc, { type, conditions = [], tokens = 0, potentials = null, foil = null }) {
  const items = (doc.items ?? []).filter(i => ITEM[i.type]).map(i => { const m = new ITEM[i.type](i.system); m.prepareDerivedData(); return { id: i._id, name: i.name, type: i.type, system: plain({ ...m }) }; });
  const base = plain(doc.system);
  if (potentials) for (const [k, v] of Object.entries(potentials)) base.attributes[k].potential = { current: v };
  const src = { ...base, conditions, foilTokens: tokens, ...(foil ? { foil } : {}) };
  const Model = type === "character" ? A.CharacterData : A.CreatureData;
  const actor = { id: `${type}-${doc._id}`, name: doc.name, uuid: `Actor.${type}-${doc._id}`, type, items, isOwner: true, _src: src };
  const derive = () => {
    const m = new Model(actor._src, { parent: { items: { contents: items } } });
    m.prepareDerivedData();
    actor.system = plain({ ...m });
  };
  derive();
  actor.potentialOf = k => Number(actor.system.attributes?.[k]?.potential?.current ?? 0);
  Object.defineProperty(actor, "foilTokens", { get: () => Number(actor.system.foilTokens ?? 0) });
  actor.update = async patch => {
    for (const [k, v] of Object.entries(patch)) { if (k === "system.conditions") actor._src.conditions = v; }
    derive();
  };
  actor.setFoilTokens = async n => { actor._src.foilTokens = Math.max(0, n); derive(); };
  actor.takeStress = async (key, amount) => {
    const before = actor.potentialOf(key), after = Math.max(0, before - Math.max(0, Number(amount) || 0));
    actor._src.attributes[key].potential = { ...actor._src.attributes[key].potential, current: after };
    const max = actor.system.attributes[key].potential.max;
    actor._src.attributes[key].incapacitated = S.nextIncapacitated(!!actor._src.attributes[key].incapacitated, after, max);
    derive();
    return { before, after };
  };
  return actor;
}
const cloneActor = a => a;   // actors are rebuilt per run by the factory below

const norm = (actors, extra = {}) => ({
  messages: env.messages, rolls: env.rolls, warnings: env.warnings, left: env.answers.length,
  events: env.events.map(e => JSON.parse(JSON.stringify(e, (k, v) => (k === "attacker" || k === "defender" || k === "actor") && v ? { id: v.id, name: v.name } : v))),
  state: Object.fromEntries(Object.entries(actors).map(([id, a]) => [id, { potentials: Object.fromEntries(Object.keys(a.system.attributes).map(k => [k, a.potentialOf(k)])), tokens: a.system.foilTokens, conditions: a._src.conditions }])),
  ...extra
});

async function runOld(mk, flag, answers, dice) {
  const actors = mk();
  reset(answers, { [actors.atk.id]: actors.atk, [actors.def.id]: actors.def }, dice);
  const f = { ...flag, actorId: actors.atk.id, targets: [{ actorId: actors.def.id }] };
  await oldResolve({ getFlag: () => f }, 0);
  return norm({ atk: actors.atk, def: actors.def });
}

/** The Foundry-side io, as a fake that records the same things the old code did. */
function fakeIO(actors) {
  const { atk, def } = actors;
  const who = a => (a ? { id: a.id, name: a.name, kind: a.type } : null);
  const speakerOf = a => ChatMessage.getSpeaker({ actor: a });
  const pop = () => (env.answers.length ? env.answers.shift() : null);
  return {
    askOppose: async () => pop(),
    updateConditions: async list => def.update({ "system.conditions": list }),
    rollOppose: async ({ formula, math, skill, flags }) => {
      const roll = await new Roll(formula).evaluate();
      await roll.toMessage({ speaker: speakerOf(def), flavor: `<div class="foil-flavor"><strong>Oppose: ${SKILL_LABEL[skill]}</strong><br><em>${esc(math)}</em>${flags.length ? `<br><em>${flags.join("<br>")}</em>` : ""}</div>` });
      return { total: roll.total, formula: roll.formula, dice: roll.dice.flatMap(d => d.results.map(r => ({ faces: d.faces, value: r.result }))) };
    },
    askReroll: async () => pop(),
    rollDie: async faces => (await new Roll(`1d${faces}`).evaluate()).total,
    setFoilTokens: n => def.setFoilTokens(n),
    card: async (kind, d) => {
      const atkSpeaker = speakerOf(atk), defSpeaker = speakerOf(def);
      const make = {
        fail: () => [atkSpeaker, T.failCard(d.flagName, d.defenderName, d.versus)],
        lands: () => [atkSpeaker, T.landsCard(d.flagName, d.defenderName, d.conditionName, d.versus)],
        noHabit: () => [atkSpeaker, T.noHabitCard(d.defenderName)],
        alreadyExposed: () => [atkSpeaker, T.alreadyExposedCard(d.defenderName, d.attackerName)],
        conditionApplied: () => [defSpeaker, T.conditionAppliedCard(d.defenderName, d.conditionName, d.go)],
        stress: () => [atkSpeaker, T.stressCard(d.defenderName, d.aim, d.r, d.versus)],
        reroll: () => [defSpeaker, T.rerollCard(d.title, d.total, d.die, d.again)],
        stressApplied: () => {
          const self = { uuid: def.uuid, actorId: def.id, actorName: def.name };
          const flags = { foil: { ...(d.halved ? {} : { halve: { ...self, applied: d.applied } }),
            cond: { actorUuid: def.uuid, actorId: def.id, actorName: def.name, targets: [], ends: d.ends.map(name => ({ ...self, name })) } } };
          return [defSpeaker, T.stressAppliedCard(d.amount, d.lines, d.note), flags];
        }
      }[kind]();
      env.messages.push({ speaker: make[0], content: make[1], flags: make[2] });
    },
    askCondition: async () => pop(),
    askApplyStress: async () => pop(),
    askOverflow: async () => pop(),
    takeStress: (k, n) => def.takeStress(k, n),
    log: (type, data) => {
      const d = { ...data };
      for (const k of ["attacker", "defender", "actor"]) if (k in d) d[k] = who(d[k]);
      env.events.push({ type, ...d });
    }
  };
}
const FMT = { br: "<br>", arrow: "&rarr;" };

async function runNew(mk, flag, answers, dice) {
  const actors = mk();
  reset(answers, { [actors.atk.id]: actors.atk, [actors.def.id]: actors.def }, dice);
  const f = { ...flag, actorId: actors.atk.id, targets: [{ actorId: actors.def.id }] };
  await R.resolveOppose({ defender: actors.def, attacker: actors.atk, flag: f, io: fakeIO(actors), fmt: FMT });
  return norm({ atk: actors.atk, def: actors.def });
}

async function runFoundry(mk, flag, answers, dice) {
  const { resolveOppose } = await import(`${SYSTEM_ROOT}/src/oppose.js`);
  const actors = mk();
  reset(answers, { [actors.atk.id]: actors.atk, [actors.def.id]: actors.def }, dice);
  logged = [];
  const f = { ...flag, actorId: actors.atk.id, targets: [{ actorId: actors.def.id }] };
  await resolveOppose({ getFlag: () => f }, 0);
  await new Promise(r => setTimeout(r, 0));
  env.events = logged.map(({ t, world, session, user, combat, ...rest }) => rest);
  return norm({ atk: actors.atk, def: actors.def });
}

const safe = f => async (...x) => { try { return await f(...x); } catch (e) { return { error: String(e.message) }; } };
const bestiary = docs("bestiary");
const byName = n => bestiary.find(d => d.name === n);
const atkDoc = byName("Bandit Captain") ?? bestiary[0];
const instDocs = docs("instruments");

// Cards: a Stress hit through an Instrument, with each kind of Type, and Condition cards.
const sword = (() => { const d = instDocs.find(x => x.system.weight === "medium" && (x.system.types ?? []).includes("edged")) ?? instDocs[0]; const m = new M.InstrumentData(d.system); m.prepareDerivedData(); return plain({ ...m }); })();
const bow = (() => { const d = instDocs.find(x => (x.system.types ?? []).includes("drawn")) ?? instDocs[1]; const m = new M.InstrumentData(d.system); m.prepareDerivedData(); return plain({ ...m }); })();
const stressFlag = (inst, o = {}) => ({
  name: "Strike", attackTotal: 20, instrument: "Weapon", cap: 12, capLabel: "half Might Potential", mult: inst.marginMultiplier ?? 1, multLabel: inst.weightLabel ?? "Light",
  types: inst.stressTypes ?? [], bespoke: 1, bespokeParts: [{ label: "Strike", value: 1 }], pierce: 1, pierceParts: [{ label: "Pierce", value: 1 }],
  attackInfo: { types: inst.types, families: ["melee"], materials: "" }, melee: true, aim: "might", typeIndex: "", other: 0, ...o
});
const condFlag = (name, o = {}) => ({ name: "Hex", attackTotal: 18, condition: { name, note: "", rounds: "" }, melee: false, ...o });
const flagsList = [
  ["edged hit on Might", stressFlag(sword)], ["edged typed", stressFlag(sword, { typeIndex: "0", attackTotal: 25 })], ["bow on Finesse", stressFlag(bow, { aim: "finesse", melee: false, typeIndex: "0" })],
  ["mental aim", stressFlag(sword, { aim: "wit", attackTotal: 14 })], ["big hit", stressFlag(sword, { attackTotal: 60, cap: 40, aim: "presence" })], ["tiny hit", stressFlag(sword, { attackTotal: 3 })],
  ["Frightened", condFlag("Frightened")], ["Reeling", condFlag("Reeling", { condition: { name: "Reeling", note: "2", rounds: "" } })], ["Foil Exposed", condFlag("Foil Exposed")], ["Charmed", condFlag("Charmed", { attackTotal: 40 })]
];
const defenders = [
  ["character, 2 tokens", { type: "character", tokens: 2 }],
  ["character, no tokens, low Potential", { type: "character", tokens: 0, potentials: { might: 3, finesse: 2, wit: 1, presence: 4 } }],
  ["creature", { type: "creature" }],
  ["creature, Conditions", { type: "creature", conditions: [{ name: "Weakened", rounds: "", note: "might" }, { name: "Foil Exposed", rounds: "", note: "Faith; by Bandit Captain" }, { name: "Invisible", rounds: "", note: "" }] }],
  ["character with Habits", { type: "character", tokens: 1, foil: { faith: { lean: "high", habit: "" }, order: { lean: "low", habit: "I never plan" }, individualism: { lean: "", habit: "" } } }],
  ["character nearly down", { type: "character", tokens: 1, potentials: { might: 1, finesse: 0, wit: 0, presence: 0 } }]
];
const answerSets = [
  [], [{ skill: "prowess", other: 0 }, { amount: 6 }],
  [{ skill: "discipline", guard: true, parry: true, other: 2 }, { die: "0" }, { amount: 9, halve: true }, { attr: "wit" }, { attr: "presence" }],
  [{ skill: "nonsense", exposed0: true, other: "x" }, { die: "1" }, { amount: 30 }, { attr: "finesse" }, { attr: "nonsense" }],
  [{ skill: "acuity" }, { die: "" }, { habit: "Faith", rounds: "2 hours", note: "afraid" }],
  [{ skill: "guile" }, { habit: "Order", rounds: "", note: "" }, { amount: 4, halve: true }],
  [{ skill: "assertiveness", other: -3 }, { die: "0" }, { amount: 100 }, { attr: "might" }, { attr: "wit" }, { attr: "finesse" }]
];
const diceSets = [[3, 7, 5, 2], [20, 20, 20, 20, 20], [1, 1, 1, 1, 1], [12, 4, 9, 8, 6, 3, 11]];

let n = 0, bad = 0, landed = 0, applied = 0, rerolled = 0, conditions = 0, overflowAsked = 0;
for (const [flagName, flag] of flagsList) for (const [defName, opts] of defenders) {
  const mk = () => ({ atk: makeActor(atkDoc, { type: "creature" }), def: makeActor(byName("Acolyte") ?? bestiary[1], opts) });
  for (const answers of answerSets) for (const dice of diceSets) {
    n++;
    const o = await safe(runOld)(mk, flag, answers, dice), w = await safe(runNew)(mk, flag, answers, dice), fd = await safe(runFoundry)(mk, flag, answers, dice);
    if (JSON.stringify(o) !== JSON.stringify(fd)) { bad++; if (bad <= 4) { const a = JSON.stringify(o), b = JSON.stringify(fd); let i = 0; while (a[i] === b[i]) i++; console.log(`  FAIL (Foundry)  ${flagName} / ${defName} / ${JSON.stringify(answers).slice(0, 70)}\n    old ...${a.slice(Math.max(0, i - 80), i + 140)}\n    foundry ...${b.slice(Math.max(0, i - 80), i + 140)}`); } }
    if (o.events?.some(e => e.applied && e.aimed)) applied++;
    if (o.events?.some(e => e.landed)) landed++;
    if (o.messages?.some(m => /Foil Token|rerolled/i.test(m.content))) rerolled++;
    if (o.state?.def.conditions.length > (opts.conditions?.length ?? 0)) conditions++;
    if (o.events?.some(e => e.applied?.length > 1)) overflowAsked++;
    if (JSON.stringify(o) !== JSON.stringify(w)) {
      bad++;
      if (bad <= 4) { const a = JSON.stringify(o), b = JSON.stringify(w); let i = 0; while (a[i] === b[i]) i++; console.log(`  FAIL  ${flagName} / ${defName} / ${JSON.stringify(answers).slice(0, 70)}\n    old ...${a.slice(Math.max(0, i - 80), i + 140)}\n    new ...${b.slice(Math.max(0, i - 80), i + 140)}`); }
    }
  }
}
console.log(`  ${n - bad} of ${n} Oppose flows match the old code (${landed} landed, ${applied} laid Stress, ${overflowAsked} overflowed, ${rerolled} Foil Token rerolls, ${conditions} applied a Condition)`);
process.exit(bad ? 1 : 0);
