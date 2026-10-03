#!/bin/sh
# Publish the committed tree as a GitHub release: foil.zip plus system.json,
# which the manifest URL (releases/latest/download/system.json) points at.
# Bump "version" and the "download" URL in system.json, commit, then run this.
# The zip holds the runtime files and the compendiums compiled from src/packs.
set -e
cd "$(dirname "$0")/.."
v=$(node -p "require('./system.json').version")
grep -q "releases/download/v$v/foil.zip" system.json || { echo "system.json's download URL isn't v$v"; exit 1; }
git diff --quiet HEAD || { echo "Commit first."; exit 1; }
npm ci --no-audit --no-fund
npm run build
git archive --format=zip -o foil.zip HEAD -- . ':(exclude)src/packs' ':(exclude)tools' ':(exclude)package.json' ':(exclude)package-lock.json' ':(exclude).gitignore'
zip -qr foil.zip packs -x 'packs/*/LOCK' 'packs/*/LOG' 'packs/*/LOG.old'
git tag "v$v"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin "v$v"
gh release create "v$v" foil.zip system.json --title "Foilbound v$v" --notes "Foilbound v$v for Foundry VTT. Install with the manifest URL in the README."
rm foil.zip
