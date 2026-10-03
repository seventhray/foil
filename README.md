# Foilbound for Foundry VTT

A Foundry VTT game system for **Foilbound**, a tabletop RPG with four Attribute dice pools, four FOIL value axes, and Stress set by the margin of an opposed roll. Its version matches the Foilbound rulebook version it follows. The rulebooks themselves are not in this repository.

- System id: `foil`
- Foundry: v13 minimum, verified on v14

## Install

In Foundry's Setup screen, open Game Systems, click Install System, and paste this manifest URL:

```
https://github.com/seventhray/foil/releases/latest/download/system.json
```

To track unreleased changes instead, clone the repository into Foundry's systems folder:

```sh
cd <Foundry user data>/Data/systems
git clone https://github.com/seventhray/foil.git foil
```

## What's included

- Character and creature sheets, with a character builder and an advancement window
- Technique pricing from Effects, and a Stress calculator for landed hits
- Compendiums: Instruments, Techniques, Feats, Equipment, Backgrounds, Ancestries, Instrument Types, Qualities, Effects, and an in-app user guide

## Development

Compendium content lives as JSON source in `src/packs/<pack>/`, one file per document. The compiled packs in `packs/` are built from it and aren't committed.

Setup needs Node and `npm install`, which brings in the official [Foundry VTT CLI](https://github.com/foundryvtt/foundryvtt-cli). Seeding from the books also needs Python 3 with PyYAML and the rulebook files. The headless checks need the Foundry install, for its bundled Handlebars and application API. Set both paths as environment variables, or in `tools/local-paths.json` (ignored by git):

```json
{ "FOIL_BOOKS": "/path/to/rulebooks", "FOUNDRY_APP": "/path/to/foundryvtt" }
```

- `npm run seed` regenerates `src/packs/` from the books and compiles `packs/`. IDs come from each document's identity, so reseeding unchanged books changes no file. `--dry-run` writes nothing.
- `npm run build` compiles `packs/` from `src/packs/` alone.
- `npm run verify` runs the headless checks.

To publish a release, bump `version` and the `download` URL in `system.json`, commit, and run `npm run release`. It pushes a version tag, and the release workflow (`.github/workflows/release.yml`) builds the packs and publishes `foil.zip` and `system.json`. `npm run package` builds the same zip locally.

## License

The code is released under the [MIT License](LICENSE). It covers the JavaScript, templates, styles, and build tools.

The Foilbound game content is © 2026 seventhray, all rights reserved. That content is the rules text and game data in the compendiums (`src/packs/`, `packs/`), the Habit Tables in `src/habits.js`, and the rules text in `tools/guide-content.mjs`.
