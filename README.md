# Foilbound for Foundry VTT

A game system for Foilbound, a tabletop RPG. Every character has four Attribute dice pools and four FOIL axes. Stress comes from the margin of an opposed roll. One set of rules runs fights of the body, the mind, and the heart.

The system's version matches the rulebook version it follows. The rulebooks are not in this repository.

- System id: `foil`
- Foundry: v13 or later, verified on v14

## Install

Open Foundry's Setup screen, then Game Systems, then Install System. Paste this manifest URL:

```
https://github.com/seventhray/foil/releases/latest/download/system.json
```

To follow unreleased changes, clone the repository into Foundry's systems folder:

```sh
cd <Foundry user data>/Data/systems
git clone https://github.com/seventhray/foil.git foil
```

## What it does

Players get these tools:

- Character sheets. Click a Skill, a Technique, or an Instrument's built-in Technique to roll it.
- Create builds a starting character. Advance spends XP.
- A Technique's Strain lands on the Instrument's Primary Attribute when it is rolled.
- Rest splits hours among Attributes in 2-hour steps and tracks rations.
- Invoke asks the GM for a Foil Token. Foil Tokens can reroll a die or halve Stress.

Target a token before rolling a Technique to run the whole exchange:

- The target's owner is asked to Oppose with a legal Skill.
- The margin, Conditions, Resistance, and Vulnerable become Stress.
- The owner confirms the Stress before it lands.
- Overflow, Foil Exposed, and a reach warning are handled on the way.

Game Masters get these tools:

- Creature sheets, and a Creature Generator in the Actors directory. It builds a creature from a tier, a Threat, or a d20 stat block.
- A playtest log. It records rolls, Opposes, Stress, rests, and Foil Tokens, and exports them as JSON Lines. Settings turn it on or off and label each session.
- Hover any keyword in a Technique or an Instrument for its definition.

## Compendiums

Instruments, Techniques, Feats, Equipment, Backgrounds, and Origins. Instrument Types, Properties, and Effects are the building blocks. A user guide opens inside Foundry.

## Development

Compendium content is JSON in `src/packs/<pack>/`, one file per document. The compiled packs in `packs/` are built from it and are not committed.

Setup needs Node and `npm install`. That brings in the official [Foundry VTT CLI](https://github.com/foundryvtt/foundryvtt-cli). Seeding from the books also needs Python 3 with PyYAML and the rulebook files. The checks need the Foundry install for its Handlebars and application API. Set both paths as environment variables, or in `tools/local-paths.json`, which git ignores:

```json
{ "FOIL_BOOKS": "/path/to/rulebooks", "FOUNDRY_APP": "/path/to/foundryvtt" }
```

- `npm run seed` rebuilds `src/packs/` and the generated data files from the books, then compiles `packs/`. Unchanged books change no file. `--dry-run` writes nothing.
- `npm run build` compiles `packs/` from `src/packs/` alone.
- `npm run verify` runs the checks that need no running Foundry.

To publish, set `version` and the `download` URL in `system.json`, commit, and run `npm run release`. It tags the version. The release workflow in `.github/workflows/release.yml` builds the packs and publishes `foil.zip` and `system.json`. `npm run package` builds the same zip locally.

## License

The code is under the [MIT License](LICENSE). That covers the JavaScript, templates, styles, and build tools.

The Foilbound game content is © 2026 seventhray, all rights reserved. That is the rules text and game data in the compendiums, the Habit Tables in `src/habits.js`, and the text in `tools/guide-content.mjs`.
