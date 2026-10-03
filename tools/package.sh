#!/bin/sh
# Build the compendiums and zip the runtime files with them into foil.zip.
# Used by the release workflow; run it locally to inspect a release zip.
set -e
cd "$(dirname "$0")/.."
npm run build
rm -f foil.zip
git archive --format=zip -o foil.zip HEAD -- . ':(exclude)src/packs' ':(exclude)tools' ':(exclude).github' \
  ':(exclude)package.json' ':(exclude)package-lock.json' ':(exclude).gitignore'
zip -qr foil.zip packs -x 'packs/*/LOCK' 'packs/*/LOG' 'packs/*/LOG.old'
echo "wrote foil.zip"
