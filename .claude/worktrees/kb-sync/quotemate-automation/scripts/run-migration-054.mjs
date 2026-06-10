// QuoteMate · run migration 054 (loader commit/rollback — trade_pricing_defaults + trade_prompts)
//
// Phase 2 — applied to the STAGING sandbox first:
//   node --env-file=.env.staging.local scripts/run-migration-054.mjs
// then to production at ship time, with explicit approval:
//   node --env-file=.env.local         scripts/run-migration-054.mjs
//
// create-or-replace only — no schema change, no data change, idempotent.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "054_loader_commit_trade_defaults_prompts.sql");
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL (use --env-file=.env.staging.local)");
  process.exit(1);
}
const target = dbUrl.includes("bobvihqwhtcbxneelfns") ? "PRODUCTION" : "staging";
const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();
  console.log(`→ Running 054_loader_commit_trade_defaults_prompts.sql against ${target} (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  // Post-verify: both functions still resolve.
  let bad = 0;
  for (const fn of ["commit_import_batch", "rollback_import_batch"]) {
    const { rows } = await c.query(
      `select count(*)::int n from pg_proc where proname = $1`,
      [fn],
    );
    if (rows[0].n >= 1) {
      console.log(`  ✓ function ${fn} present`);
    } else {
      console.error(`  ✗ function ${fn} missing`);
      bad++;
    }
  }
  if (bad > 0) {
    console.error(`\nFAIL — ${bad} post-verify check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nOK — migration 054 verified on ${target}.`);
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
