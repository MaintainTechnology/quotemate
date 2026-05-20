// QuoteMate · run migration 038 (drop stub Sparky tenant + partial unique email)
// Usage:  node --env-file=.env.local scripts/run-migration-038.mjs
//
// Pre-flight: confirms the stub tenant still matches the expected fingerprint
// (id + business_name + vapi_assistant_id + zero traffic) AND that no other
// active/pending tenant shares the live Sparky's owner_email, before
// applying. Post-verify: confirms the stub is gone, the live Sparky
// remains, and the new partial unique index exists.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "038_drop_stub_sparky_tenant.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const STUB_ID = "4f93e688-deb1-41f0-84d9-0f57e956720d";
const LIVE_ID = "6dca084c-10d5-4459-b48f-9b45e4bbc68a";
const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();

  // ── PRE-FLIGHT ─────────────────────────────────────────────────
  const { rows: stub } = await c.query(
    `select id, business_name, vapi_assistant_id, status from tenants where id = $1`,
    [STUB_ID],
  );
  if (stub.length === 0) {
    console.log(`  • stub already absent — migration is a no-op on the DELETE.`);
  } else {
    const ok =
      stub[0].business_name === "Sparky" &&
      stub[0].vapi_assistant_id === "vapi-stub-4f93e688";
    if (!ok) {
      console.error(`PRE-FLIGHT FAIL: stub fingerprint mismatch`, stub[0]);
      process.exit(1);
    }
    console.log(`  ✓ stub fingerprint matches: business_name=${stub[0].business_name}, vapi=${stub[0].vapi_assistant_id}`);
  }

  const { rows: stubTraffic } = await c.query(
    `select
       (select count(*) from intakes where tenant_id = $1)::int as intakes,
       (select count(*) from sms_conversations where tenant_id = $1)::int as sms_convs,
       (select count(*) from quotes where tenant_id = $1)::int as quotes,
       (select count(*) from calls where tenant_id = $1)::int as calls,
       (select count(*) from customers where tenant_id = $1)::int as customers`,
    [STUB_ID],
  );
  const tr = stubTraffic[0] || {};
  const totalTraffic = (tr.intakes ?? 0) + (tr.sms_convs ?? 0) + (tr.quotes ?? 0) + (tr.calls ?? 0) + (tr.customers ?? 0);
  console.log(`  ✓ stub traffic: intakes=${tr.intakes} sms=${tr.sms_convs} quotes=${tr.quotes} calls=${tr.calls} customers=${tr.customers}`);
  if (totalTraffic > 0) {
    console.error(`PRE-FLIGHT FAIL: stub has live traffic (${totalTraffic} rows total) — refusing to delete`);
    process.exit(1);
  }

  const { rows: emailDupes } = await c.query(`
    select lower(owner_email) e, count(*) c, array_agg(id) ids
      from tenants where status in ('active', 'pending')
      group by lower(owner_email) having count(*) > 1`);
  if (emailDupes.length > 0) {
    console.error(`PRE-FLIGHT FAIL: active/pending tenants have duplicate owner_email — partial unique index would fail`);
    for (const r of emailDupes) console.error(`    ${r.e} x${r.c} (${r.ids.join(", ")})`);
    process.exit(1);
  }
  console.log(`  ✓ no duplicate owner_email in active/pending tenants`);

  // ── APPLY ──────────────────────────────────────────────────────
  console.log(`\n→ Applying 038_drop_stub_sparky_tenant.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  // ── POST-VERIFY ────────────────────────────────────────────────
  const { rows: stubAfter } = await c.query(
    `select id from tenants where id = $1`,
    [STUB_ID],
  );
  if (stubAfter.length > 0) {
    console.error("POST-VERIFY FAIL: stub tenant still exists");
    process.exit(1);
  }
  console.log(`  ✓ stub tenant ${STUB_ID} gone`);

  const { rows: liveAfter } = await c.query(
    `select id, business_name, status from tenants where id = $1`,
    [LIVE_ID],
  );
  if (liveAfter.length === 0 || liveAfter[0].status !== "active") {
    console.error("POST-VERIFY FAIL: live Sparky missing or not active", liveAfter);
    process.exit(1);
  }
  console.log(`  ✓ live Sparky ${LIVE_ID} still active`);

  const { rows: idx } = await c.query(`
    select indexname from pg_indexes
      where schemaname='public' and tablename='tenants'
        and indexname='tenants_active_owner_email_unique'`);
  if (idx.length === 0) {
    console.error("POST-VERIFY FAIL: partial unique index not created");
    process.exit(1);
  }
  console.log(`  ✓ partial unique index tenants_active_owner_email_unique present`);

  // 4. Orphan check (SET-NULL FKs that *would* have pointed at the stub)
  const { rows: orphans } = await c.query(`
    select
      (select count(*) from intakes where tenant_id is null)::int as intakes_null,
      (select count(*) from sms_conversations where tenant_id is null)::int as sms_null,
      (select count(*) from quotes where tenant_id is null)::int as quotes_null,
      (select count(*) from calls where tenant_id is null)::int as calls_null,
      (select count(*) from customers where tenant_id is null)::int as customers_null`);
  console.log(`\n  Orphan check (tenant_id IS NULL counts after delete):`);
  for (const [k, v] of Object.entries(orphans[0])) console.log(`    ${k.padEnd(20)} ${v}`);

  const { rows: tenants } = await c.query(
    `select business_name, status, count(*) c from tenants group by business_name, status order by business_name`,
  );
  console.log(`\n  Tenants now:`);
  for (const r of tenants) console.log(`    ${r.business_name.padEnd(20)} [${r.status}] x${r.c}`);

  console.log("\nOK — migration 038 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
