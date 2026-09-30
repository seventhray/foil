/**
 * tools/verify/run.mjs — headless checks for the FOIL system.
 *
 * Catches the class of bug `node --check` cannot: a template key with no
 * context entry, a system.* path that no longer exists on its model, an
 * unregistered helper, a migrateData that throws. All of those render blank
 * or fail at the table rather than erroring at parse time.
 *
 * Run with:  node tools/verify/run.mjs
 * This does not replace opening a world. It replaces most of the reasons to.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
const HERE = path.dirname(new URL(import.meta.url).pathname);
let failed = 0;
for (const f of ["verify-templates.mjs", "verify-keys.mjs", "verify-context.mjs", "verify-models.mjs", "verify-guide.mjs", "verify-app-fields.mjs"]) {
  console.log(`\n─── ${f} ${"─".repeat(Math.max(0, 46 - f.length))}`);
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll headless checks passed.");
process.exit(failed ? 1 : 0);
