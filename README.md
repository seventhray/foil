# Foilbound for Foundry VTT

A Foundry VTT game system for **Foilbound**, a tabletop RPG with four Attribute dice pools, four FOIL value axes, and Stress set by the margin of an opposed roll. It follows the Foilbound v0.6.0 rules. The rulebooks themselves are not in this repository.

- System id: `foil`
- Foundry: v12 minimum, verified on v14

## Install

There is no manifest URL yet. Clone the repository into Foundry's systems folder, then restart Foundry and create a world with the Foilbound system:

```sh
cd <Foundry user data>/Data/systems
git clone https://github.com/seventhray/foil.git foil
```

## What's included

- Character and creature sheets, with a character builder and an advancement window
- Technique pricing from Effects, and a Stress calculator for landed hits
- Compendiums: Instruments, Techniques, Feats, Equipment, Backgrounds, Ancestries, Instrument Types, Qualities, Effects, and an in-app user guide

## Development

The tools in `tools/` rebuild the compendiums from the rulebook Markdown and check the system against it. They need Node, Python 3 with PyYAML, the Foundry install (for its bundled `node_modules`), and the rulebook files. Set two paths as environment variables, or in `tools/local-paths.json` (ignored by git):

```json
{ "FOIL_BOOKS": "/path/to/rulebooks", "FOUNDRY_APP": "/path/to/foundryvtt" }
```

- `node tools/populate-packs.mjs` rebuilds the compendiums. Close Foundry first; its compendiums can't be written while it's running. `--dry-run` writes nothing.
- `node tools/verify/run.mjs` runs the headless checks.

## License

No license yet. All rights reserved.
