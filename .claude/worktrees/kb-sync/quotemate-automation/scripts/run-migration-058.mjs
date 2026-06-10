// QuoteMate · run migration 058 (drop Pilot Sparky + Pilot Plumber seed tenants)
// Usage:  node --env-file=.env.local scripts/run-migration-058.mjs
//
// Pre-flight: re-verifies both pilot tenants still match the expected
// fingerprint (id + business_name + owner_email + vapi_assistant_id IS NULL)
// AND have zero customer traffic. Post-verify: confirms both are gone,
// the four real tenants remain, and the cascaded counts add up.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "058_drop_pilot_seed_tenants.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const PILOT_PLUMBER_ID = "dc744841-f09d-4edb-a08e-e36d2025351f";
const PILOT_SPARKY_ID = "f77d5b1d-8cff-418d-94fa-a434c57ab88c";
const PILOT_IDS = [PILOT_PLUMBER_ID, PILOT_SPARKY_ID];

const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();

  // ── PRE-FLIGHT ─────────────────────────────────────────────────
  const { rows: pilots } = await c.query(
    `select id, business_name, owner_email, vapi_assistant_id, status
     from tenants where id = any($1::uuid[]) order by business_name`,
    [PILOT_IDS],
  );
  if (pilots.length === 0) {
    console.log("  • both pilots already absent — migration is a no-op.");
  } else {
    for (const p of pilots) {
      const expectedName =
        p.id === PILOT_PLUMBER_ID ? "Pilot Plumber" : "Pilot Sparky";
      const expectedEmail =
        p.id === PILOT_PLUMBER_ID ? "plumber@quotemate.dev" : "sparky@quotemate.dev";
      const ok =
        p.business_name === expectedName &&
        p.owner_email === expectedEmail &&
        p.vapi_assistant_id === null;
      if (!ok) {
        console.error(`PRE-FLIGHT FAIL: pilot fingerprint mismatch for ${p.id}`, p);
        process.exit(1);
      }
      console.log(
        `  OK ${p.business_name} fingerprint matches (vapi=null, status=${p.status})`,
      );
    }
  }

  const { rows: traffic } = await c.query(
    `select
       (select count(*) from intakes where tenant_id = any($1::uuid[]))::int as intakes,
       (select count(*) from quotes where tenant_id = any($1::uuid[]))::int as quotes,
       (select count(*) from calls where tenant_id = any($1::uuid[]))::int as calls,
       (select count(*) from customers where tenant_id = any($1::uuid[]))::int as customers,
       (select count(*) from sms_conversations where tenant_id = any($1::uuid[]))::int as sms_convs`,
    [PILOT_IDS],
  );
  const tr = traffic[0];
  const total = tr.intakes + tr.quotes + tr.calls + tr.customers + tr.sms_convs;
  console.log(
    `  OK pilot traffic: intakes=${tr.intakes} quotes=${tr.quotes} calls=${tr.calls} customers=${tr.customers} sms=${tr.sms_convs}`,
  );
  if (total > 0) {
    console.error(`PRE-FLIGHT FAIL: pilots have live traffic (${total} rows) — refusing to delete`);
    process.exit(1);
  }

  // Snapshot cascaded counts BEFORE so we can assert deltas afterwards.
  const { rows: before } = await c.query(
    `select
       (select count(*) from pricing_book where tenant_id = any($1::uuid[]))::int as pricing_book,
       (select count(*) from tenant_service_offerings where tenant_id = any($1::uuid[]))::int as tso,
       (select count(*) from tenant_material_catalogue where tenant_id = any($1::uuid[]))::int as tmc,
       (select count(*) from tenants)::int as total_tenants`,
    [PILOT_IDS],
  );
  console.log(
    `  Pre-state: pilots own pricing_book=${before[0].pricing_book}, tso=${before[0].tso}, tmc=${before[0].tmc}; total tenants=${before[0].total_tenants}`,
  );

  // ── APPLY ──────────────────────────────────────────────────────
  console.log(`\n-> Applying 058_drop_pilot_seed_tenants.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  // ── POST-VERIFY ────────────────────────────────────────────────
  const { rows: pilotsAfter } = await c.query(
    `select id from tenants where id = any($1::uuid[])`,
    [PILOT_IDS],
  );
  if (pilotsAfter.length > 0) {
    console.error("POST-VERIFY FAIL: pilot tenant(s) still exist", pilotsAfter);
    process.exit(1);
  }
  console.log(`  OK both pilot tenants gone`);

  // Cascade should have wiped their downstream rows too.
  const { rows: cascaded } = await c.query(
    `select
       (select count(*) from pricing_book where tenant_id = any($1::uuid[]))::int as pricing_book,
       (select count(*) from tenant_service_offerings where tenant_id = any($1::uuid[]))::int as tso,
       (select count(*) from tenant_material_catalogue where tenant_id = any($1::uuid[]))::int as tmc`,
    [PILOT_IDS],
  );
  const cas = cascaded[0];
  if (cas.pricing_book !== 0 || cas.tso !== 0 || cas.tmc !== 0) {
    console.error("POST-VERIFY FAIL: cascade left rows behind", cas);
    process.exit(1);
  }
  console.log(`  OK CASCADE cleared: pricing_book=0, tso=0, tmc=0 for the pilots`);

  // SET-NULL orphan delta check — should be 0 because pre-flight confirmed 0.
  const { rows: orphans } = await c.query(`
    select
      (select count(*) from intakes where tenant_id is null)::int as intakes_null,
      (select count(*) from quotes where tenant_id is null)::int as quotes_null,
      (select count(*) from calls where tenant_id is null)::int as calls_null,
      (select count(*) from customers where tenant_id is null)::int as customers_null,
      (select count(*) from sms_conversations where tenant_id is null)::int as sms_null`);
  console.log(`\n  Orphan check (tenant_id IS NULL counts, system-wide):`);
  for (const [k, v] of Object.entries(orphans[0])) console.log(`    ${k.padEnd(20)} ${v}`);

  const { rows: tenants } = await c.query(
    `select business_name, status, count(*)::int c
     from tenants group by business_name, status order by business_name`,
  );
  console.log(`\n  Tenants now:`);
  for (const r of tenants) console.log(`    ${r.business_name.padEnd(20)} [${r.status}] x${r.c}`);

  const { rows: bookCount } = await c.query(
    `select count(*)::int as n from pricing_book`,
  );
  console.log(`\n  pricing_book rows now: ${bookCount[0].n}`);

  console.log("\nOK migration 058 verified.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
