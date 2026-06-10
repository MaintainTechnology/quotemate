// QuoteMate · run migration 060 (RLS Phase 1 extension)
// Usage:  node --env-file=.env.local scripts/run-migration-060.mjs
//
// Pre-flight: confirms which of the 10 target tables still have RLS off.
// Post-verify: confirms RLS is ON for all 10, and the anon-key probe
// returns 0 rows where it previously leaked.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "060_rls_phase_1_extension.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const TARGETS = [
  "admin_users",
  "categories",
  "import_batches",
  "import_staged_rows",
  "quote_followup_events",
  "supplier_catalogue",
  "tenant_tier_ladder",
  "trade_pricing_defaults",
  "trade_prompts",
  "trades",
];

const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function rlsState(client) {
  const { rows } = await client.query(
    `select c.relname as table_name, c.relrowsecurity as rls_enabled
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1::text[])
      order by c.relname`,
    [TARGETS],
  );
  return rows;
}

async function anonProbe() {
  if (!supaUrl || !anonKey) {
    console.log("  (anon probe skipped: missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)");
    return null;
  }
  const supabase = createClient(supaUrl, anonKey);
  const out = [];
  for (const t of TARGETS) {
    const { count, error } = await supabase
      .from(t)
      .select("*", { count: "exact", head: true });
    out.push({ table: t, rows_visible: error ? null : count, error: error?.message });
  }
  return out;
}

try {
  await c.connect();

  // ── PRE-FLIGHT ─────────────────────────────────────────────────
  const beforeRls = await rlsState(c);
  console.log("\nPre-state RLS:");
  console.table(beforeRls);

  const beforeAnon = await anonProbe();
  if (beforeAnon) {
    console.log("\nPre-state anon-key visibility:");
    console.table(beforeAnon);
  }

  // ── APPLY ──────────────────────────────────────────────────────
  console.log(`\n-> Applying 060_rls_phase_1_extension.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  // ── POST-VERIFY ────────────────────────────────────────────────
  const afterRls = await rlsState(c);
  console.log("\nPost-state RLS:");
  console.table(afterRls);

  const violations = afterRls.filter((r) => !r.rls_enabled);
  if (violations.length > 0) {
    console.error("POST-VERIFY FAIL: RLS still off on:", violations.map((v) => v.table_name));
    process.exit(1);
  }
  console.log("OK All 10 target tables have RLS enabled.");

  const afterAnon = await anonProbe();
  if (afterAnon) {
    console.log("\nPost-state anon-key visibility:");
    console.table(afterAnon);

    const leaks = afterAnon.filter((r) => r.rows_visible !== null && r.rows_visible > 0);
    if (leaks.length > 0) {
      console.error("POST-VERIFY FAIL: anon still sees rows:");
      for (const l of leaks) console.error(`  - ${l.table}: ${l.rows_visible}`);
      process.exit(1);
    }
    console.log("OK Anon-key probe: 0 rows visible across all 10 tables.");
  }

  console.log("\nOK migration 060 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
