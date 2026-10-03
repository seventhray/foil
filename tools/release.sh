#!/bin/sh
# Tag the committed version. Pushing the tag runs .github/workflows/release.yml,
# which builds the compendiums and publishes foil.zip plus system.json as a
# GitHub release (the manifest URL is releases/latest/download/system.json).
# Bump "version" and the "download" URL in system.json, commit, then run this.
set -e
cd "$(dirname "$0")/.."
v=$(node -p "require('./system.json').version")
grep -q "releases/download/v$v/foil.zip" system.json || { echo "system.json's download URL isn't v$v"; exit 1; }
git diff --quiet HEAD || { echo "Commit first."; exit 1; }
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -q origin HEAD
git tag "v$v"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin "v$v"
echo "Tagged v$v. The release workflow publishes it: gh run watch, or the repo's Actions tab."
