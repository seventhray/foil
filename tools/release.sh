#!/bin/sh
# Publish the committed tree as a GitHub release: foil.zip plus system.json,
# which the manifest URL (releases/latest/download/system.json) points at.
# Bump "version" and the "download" URL in system.json, commit, then run this.
set -e
cd "$(dirname "$0")/.."
v=$(node -p "require('./system.json').version")
grep -q "releases/download/v$v/foil.zip" system.json || { echo "system.json's download URL isn't v$v"; exit 1; }
git diff --quiet HEAD -- . ':!packs' || { echo "Commit first."; exit 1; }
git archive --format=zip -o foil.zip HEAD
git tag "v$v"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin "v$v"
gh release create "v$v" foil.zip system.json --title "Foilbound v$v" --notes "Foilbound v$v for Foundry VTT. Install with the manifest URL in the README."
rm foil.zip
