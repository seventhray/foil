/**
 * src/system.js
 * Foilbound (FOIL) system entry point.
 * Registers DataModels, document classes, sheets, Handlebars helpers, and the
 * modular vocabulary registry.
 */

import { FoilActor } from "./actor/actor.js";
import { FoilItem } from "./item/item.js";
import { FoilCharacterSheet, FoilCreatureSheet } from "./actor/actor-sheet.js";
import { FoilItemSheet } from "./item/item-sheet.js";
import { CharacterData, CreatureData } from "./data/actor-models.js";
import {
  InstrumentData, TechniqueData, EquipmentData, FeatData, BackgroundData, OriginData
} from "./data/item-models.js";
import { InstrumentTypeData, QualityData, EffectData } from "./data/definition-models.js";
import { buildRegistry, registerRegistryHooks } from "./registry.js";
import { registerPlaytestLog, registerLogHooks } from "./playtest-log.js";

function registerHandlebarsHelpers() {
  Handlebars.registerHelper("foil-eq", (a, b) => a === b);

  Handlebars.registerHelper("foil-signed", n => {
    const v = Number(n ?? 0);
    return v > 0 ? `+${v}` : `${v}`;
  });

  Handlebars.registerHelper("foil-capitalize", str => {
    const s = String(str ?? "");
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  });
}

Hooks.once("init", function() {
  console.log("FOIL | Initializing");

  CONFIG.FOIL = {};

  CONFIG.Actor.documentClass = FoilActor;
  CONFIG.Item.documentClass  = FoilItem;

  // Typed schemas (replace template.json). Content types + authorable definitions.
  CONFIG.Actor.dataModels.character = CharacterData;
  CONFIG.Actor.dataModels.creature  = CreatureData;
  CONFIG.Item.dataModels.instrument     = InstrumentData;
  CONFIG.Item.dataModels.technique      = TechniqueData;
  CONFIG.Item.dataModels.equipment      = EquipmentData;
  CONFIG.Item.dataModels.feat           = FeatData;
  CONFIG.Item.dataModels.background      = BackgroundData;
  CONFIG.Item.dataModels.origin         = OriginData;
  CONFIG.Item.dataModels.instrumentType = InstrumentTypeData;
  CONFIG.Item.dataModels.quality        = QualityData;
  CONFIG.Item.dataModels.effect         = EffectData;

  const ActorsCollection = foundry.documents?.collections?.Actors ?? Actors;
  const ItemsCollection  = foundry.documents?.collections?.Items  ?? Items;

  ActorsCollection.registerSheet("foil", FoilCharacterSheet, {
    types: ["character"], makeDefault: true, label: "FOIL Character Sheet"
  });
  ActorsCollection.registerSheet("foil", FoilCreatureSheet, {
    types: ["creature"], makeDefault: true, label: "FOIL Creature Sheet"
  });
  ItemsCollection.registerSheet("foil", FoilItemSheet, {
    makeDefault: true, label: "FOIL Item Sheet"
  });

  // Initiative is an Acuity roll (PHB 6.2.0).
  CONFIG.Combat.initiative = {
    formula: "@skills.acuity.formula",
    decimals: 0
  };

  registerHandlebarsHelpers();
  registerRegistryHooks();
  registerPlaytestLog();

  const loadTemplatesFn = foundry.applications?.handlebars?.loadTemplates ?? loadTemplates;
  loadTemplatesFn([
    "systems/foil/templates/actor/partials/item-list.hbs",
    "systems/foil/templates/actor/partials/dice-pool.hbs",
    "systems/foil/templates/actor/partials/skills-table.hbs",
    "systems/foil/templates/actor/partials/conditions.hbs",
    "systems/foil/templates/item/partials/effect-rows.hbs",
    "systems/foil/templates/item/partials/item-head.hbs",
    "systems/foil/templates/item/partials/item-description.hbs",
    "systems/foil/templates/item/partials/type-warning.hbs"
  ]);
});

Hooks.once("ready", async function() {
  registerLogHooks();
  // `game.ready` flips true (and any sheet a user clicks open can start
  // rendering) without Foundry waiting on this async hook — so a sheet
  // opened in the gap before buildRegistry() resolves would otherwise see
  // an empty CONFIG.FOIL and render, e.g., an Effect dropdown with no
  // options. Re-render whatever's already open once the registry is ready
  // so any such sheet self-corrects instead of staying stale for its
  // whole lifetime.
  await buildRegistry();
  console.log("FOIL | Ready — vocabulary registry built", CONFIG.FOIL);
  for (const app of Object.values(ui.windows)) app.render();
});

// Every new character has the innate Instruments Body and Voice (PHB 2.5.3).
// Grant them on creation, idempotently, and only on the client that created the
// actor (avoids duplicate creates in play).
Hooks.on("createActor", async (actor, options, userId) => {
  if (actor.type !== "character" || game.userId !== userId) return;
  try {
    const { grantStartingKit } = await import("./apps/chargen.js");
    await grantStartingKit(actor);
  } catch (err) {
    console.error("FOIL | Failed to grant starting kit", err);
  }
});
