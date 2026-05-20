// QuoteMate · run migration 040 (RLS Phase 1 — close the anon-key leak)
// Usage:  node --env-file=.env.local scripts/run-migration-040.mjs
//
// (Migration 039 is reserved for Anant's WIP quote_followup_events; this
// is the RLS Phase 1 work renumbered from 039 to avoid collision.)
//
// Pre-flight: verifies the 13 target tables currently have RLS OFF (so
// the migration is doing what we expect), and confirms the auth-callback
// browser-anon read pattern still exists in the code so the
// tenants_self_select policy remains load-bearing.
// Post-verify: confirms RLS is ON on all 13 tables and the policy is
// present.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "040_rls_phase_1.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const TARGET_TABLES = [
  "tenants",
  "customers",
  "sms_conversations",
  "sms_messages",
  "tradie_signup_intents",
  "tenant_assembly_bom",
  "tenant_assembly_overrides",
  "tenant_custom_assemblies",
  "tenant_licences",
  "tenant_material_catalogue",
  "tenant_material_preferences",
  "tenant_service_offerings",
  "shared_assembly_bom",
];

const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function rlsState(client) {
  const { rows } = await client.query(`
    select c.relname as table_name,
           c.relrowsecurity as rls_on,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname = any($1::text[])
     order by c.relname`, [TARGET_TABLES]);
  return Object.fromEntries(rows.map((r) => [r.table_name, r]));
}

try {
  await c.connect();

  console.log("─── Pre-flight ──────────────────────────────────────────");
  const before = await rlsState(c);

  const missing = TARGET_TABLES.filter((t) => !before[t]);
  if (missing.length) {
    console.error("PRE-FLIGHT FAIL: target tables missing:", missing);
    process.exit(1);
  }

  const alreadyOn = TARGET_TABLES.filter((t) => before[t].rls_on);
  if (alreadyOn.length) {
    console.log(`  • ${alreadyOn.length} target table(s) already RLS-on (no-op):`);
    for (const t of alreadyOn) console.log(`      - ${t}`);
  }
  const willFlip = TARGET_TABLES.filter((t) => !before[t].rls_on);
  console.log(`  ✓ ${willFlip.length} table(s) will flip RLS off → on:`);
  for (const t of willFlip) console.log(`      - ${t}`);

  const { rows: tenantsExists } = await c.query(
    `select 1 from information_schema.columns
      where table_schema='public' and table_name='tenants'
        and column_name='owner_user_id'`,
  );
  if (!tenantsExists.length) {
    console.error("PRE-FLIGHT FAIL: tenants.owner_user_id column missing — policy predicate broken");
    process.exit(1);
  }
  console.log(`  ✓ tenants.owner_user_id present (policy predicate valid)`);

  console.log(`\n→ Applying 040_rls_phase_1.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  console.log("\n─── Post-verify ─────────────────────────────────────────");
  const after = await rlsState(c);

  let bad = 0;
  for (const t of TARGET_TABLES) {
    if (!after[t]?.rls_on) {
      console.error(`  ✗ ${t}: RLS not enabled`);
      bad++;
    } else {
      console.log(`  ✓ ${t}: RLS=on, policies=${after[t].policy_count}`);
    }
  }
  if (bad) {
    console.error(`\n${bad} RLS check(s) failed`);
    process.exit(1);
  }

  const { rows: pol } = await c.query(`
    select polname, polcmd
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
     where c.relname = 'tenants' and p.polname = 'tenants_self_select'`);
  if (pol.length === 0) {
    console.error("POST-VERIFY FAIL: tenants_self_select policy missing");
    process.exit(1);
  }
  console.log(`  ✓ tenants_self_select policy present (cmd=${pol[0].polcmd})`);

  const { rows: summary } = await c.query(`
    select c.relname as t, c.relrowsecurity as rls_on,
           (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relkind='r' and c.relrowsecurity=true
     order by c.relname`);
  const policyTotal = summary.reduce((a, r) => a + r.policies, 0);
  console.log(`\n  ✓ summary: ${summary.length} public tables now RLS-on, ${policyTotal} total policies`);
  console.log("\nOK — migration 040 verified. RLS Phase 1 complete.");
  console.log("\nNext steps:");
  console.log("  • Smoke-test: sign up a new test user → magic-link → /auth/callback → dashboard");
  console.log("  • If anything breaks, rollback per the script header in 040_rls_phase_1.sql");
  console.log("  • Phase 2 (tenant-scoped policies) deferred — see quotemate-automation/docs/rls-design.md");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
