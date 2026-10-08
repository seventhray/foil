/**
 * src/playtest-log.js
 * Playtest data log. Every mechanical event (rolls, Opposes, Stress, Strain,
 * rests, Conditions, Foil Tokens, Potential changes, combat turns) is appended
 * as one JSON record to a world setting kept by the GM's client. Players'
 * clients relay events to the GM over the system socket. The GM exports the
 * log as JSON Lines from Configure Settings > FOIL > Playtest log.
 */

const NS = "foil";
const SOCKET = "system.foil";

let queue = Promise.resolve();
const events = () => game.settings.get(NS, "playtestLog") ?? [];

const enabled = () => !!game.settings.get(NS, "logPlaytest");

/** Where in the fiction the event happened. */
function context() {
  const c = game.combat;
  return {
    t: new Date().toISOString(),
    world: game.world?.id,
    session: game.settings.get(NS, "sessionLabel") || "",
    user: game.user?.name,
    combat: c ? { id: c.id, round: c.round, turn: c.turn, who: c.combatant?.name ?? null } : null
  };
}

function append(record) {
  queue = queue.then(async () => {
    const log = [...events(), record];
    await game.settings.set(NS, "playtestLog", log);
  }).catch(err => console.error("FOIL | playtest log failed", err));
  return queue;
}

/** Record one event from any client. */
export function logEvent(type, data = {}) {
  try {
    if (!game.ready || !enabled()) return;
    const record = { ...context(), type, ...data };
    if (game.user.isGM && game.users.activeGM?.isSelf) append(record);
    else if (game.users.activeGM) game.socket.emit(SOCKET, { kind: "log", record });
  } catch (err) {
    console.error("FOIL | playtest log failed", err);
  }
}

/** A compact label for an actor. */
export const who = actor => (actor ? { id: actor.id, name: actor.name, kind: actor.type } : null);

export function exportLog() {
  const text = events().map(e => JSON.stringify(e)).join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  foundry.utils.saveDataToFile(text, "application/x-ndjson", `foil-playtest-${game.world.id}-${stamp}.jsonl`);
}

export async function clearLog() {
  queue = queue.then(() => game.settings.set(NS, "playtestLog", []));
  return queue;
}

class PlaytestLogMenu extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "foil-playtest-log",
    window: { title: "FOIL playtest log", icon: "fas fa-clipboard-list" },
    position: { width: 380 },
    actions: {
      exportLog: () => exportLog(),
      clearLog: async function () {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Clear the playtest log" }, content: "<p>Delete every logged event? Export first if you want a copy.</p>" });
        if (ok) { await clearLog(); this.render(); }
      }
    }
  };

  async _renderHTML() {
    const n = events().length;
    const first = events()[0]?.t?.slice(0, 16).replace("T", " ") ?? "";
    const el = document.createElement("div");
    el.className = "foil-playtest-log";
    el.innerHTML = `<p><strong>${n}</strong> event${n === 1 ? "" : "s"} logged${first ? ` since ${first}` : ""}.</p>`
      + `<p>Each line is one JSON record: rolls, Opposes, Stress, Strain, rests, Conditions, Foil Tokens, Potential changes, and combat turns.</p>`
      + `<div style="display:flex;gap:8px"><button type="button" data-action="exportLog"><i class="fas fa-download"></i> Export (.jsonl)</button>`
      + `<button type="button" data-action="clearLog"><i class="fas fa-trash"></i> Clear</button></div>`;
    return el;
  }

  _replaceHTML(result, content) { content.replaceChildren(result); }
}

export function registerPlaytestLog() {
  game.settings.register(NS, "logPlaytest", { name: "Log playtest data", hint: "Record mechanical events for playtest analysis (GM exports them).", scope: "world", config: true, type: Boolean, default: true });
  game.settings.register(NS, "sessionLabel", { name: "Playtest session label", hint: "Written into every logged event, such as \"2026-10-10 playtest 3\".", scope: "world", config: true, type: String, default: "" });
  game.settings.register(NS, "playtestLog", { scope: "world", config: false, type: Array, default: [] });
  game.settings.registerMenu(NS, "playtestLogMenu", {
    name: "Playtest log", label: "Export or clear", hint: "Download the logged events as JSON Lines, or clear them.",
    icon: "fas fa-clipboard-list", type: PlaytestLogMenu, restricted: true
  });
}

export function registerLogHooks() {
  game.socket.on(SOCKET, msg => {
    if (msg?.kind === "log" && game.user.isGM && game.users.activeGM?.isSelf && enabled()) append(msg.record);
  });

  // Potential and Condition changes, with their old values, from whichever client made them.
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    const attrs = changes.system?.attributes;
    if (attrs) options.foilBefore = Object.fromEntries(Object.keys(attrs).map(k => [k, actor.system.attributes?.[k]?.potential?.current]));
    if (changes.system?.conditions) options.foilConditionsBefore = (actor.system.conditions ?? []).map(c => c.name);
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    for (const [k, a] of Object.entries(changes.system?.attributes ?? {})) {
      const to = a?.potential?.current;
      const from = options.foilBefore?.[k];
      if (to !== undefined && from !== undefined && to !== from) {
        logEvent("potential", { actor: who(actor), attribute: k, from, to, max: actor.system.attributes?.[k]?.potential?.max, down: !!actor.system.attributes?.[k]?.down });
      }
    }
    if (changes.system?.conditions) {
      logEvent("conditions", { actor: who(actor), before: options.foilConditionsBefore ?? [], now: (actor.system.conditions ?? []).map(c => ({ name: c.name, rounds: c.rounds, note: c.note })) });
    }
  });

  Hooks.on("createCombat", c => { if (c.isOwner) logEvent("combat-start", { combatants: c.combatants.map(x => x.name) }); });
  Hooks.on("deleteCombat", c => { if (game.user.isGM) logEvent("combat-end", { round: c.round }); });
  Hooks.on("updateCombat", (c, changes, options, userId) => {
    if (userId !== game.user.id || (changes.round === undefined && changes.turn === undefined)) return;
    logEvent("turn", { round: c.round, turn: c.turn, who: c.combatant?.name ?? null });
  });
}
