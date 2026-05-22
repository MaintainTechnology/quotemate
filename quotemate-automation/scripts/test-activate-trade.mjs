// End-to-end verification of migration 055 — activate_trade_for_tenant()
// (spec §10). Builds a throwaway trade bundle + a throwaway tenant on the
// STAGING sandbox, activates the trade, and asserts the atomic §10
// guarantee: tenants.trades[] appended, a pricing_book row seeded from
// trade_pricing_defaults, and tenant_service_offerings seeded with the
// default_enabled state. Then re-runs it to prove idempotency, and proves
// a trade with no pricing defaults is rejected loud.
//
// Staging only — refuses to run against production. Cleans up either way.
// Usage: node --env-file=.env.staging.local scripts/test-activate-trade.mjs

import pg from "pg";

const { Client } = pg;
const PROD_REF = "bobvihqwhtcbxneelfns";
const TRADE = "zzz_activate_trade";
const TRADE_NO_DEF = "zzz_activate_nodef";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL — run with --env-file=.env.staging.local");
  process.exit(1);
}
if (dbUrl.includes(PROD_REF)) {
  console.error("\n  ✗ REFUSING TO RUN — SUPABASE_DB_URL points at PRODUCTION.\n");
  process.exit(1);
}

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
let pass = 0;
let fail = 0;
function check(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

async function cleanup() {
  await c.query(`delete from shared_assemblies where trade = any($1)`, [[TRADE, TRADE_NO_DEF]]);
  // tenant delete cascades pricing_book + tenant_service_offerings.
  await c.query(`delete from tenants where business_name = 'ZZZ Activate Test Co'`);
  await c.query(`delete from trades where name = any($1)`, [[TRADE, TRADE_NO_DEF]]);
}

try {
  await c.connect();
  await cleanup();

  // ── fixture — a complete new-trade bundle ────────────────────────
  const tradeId = (await c.query(
    `insert into trades (name, display_name, is_job_based, active)
     values ($1, 'ZZZ Activate Test Trade', true, true) returning id`, [TRADE],
  )).rows[0].id;
  await c.query(
    `insert into trade_pricing_defaults (
       trade_id, hourly_rate, call_out_minimum, apprentice_rate, senior_rate,
       default_markup_pct, risk_buffer_pct, min_labour_hours, gst_registered, licence_label)
     values ($1, 118, 130, 62, 152, 26, 15, 2, true, 'ZZZ activate licence')`, [tradeId],
  );
  await c.query(
    `insert into shared_assemblies
       (trade, name, description, default_unit, default_unit_price_ex_gst,
        default_labour_hours, default_exclusions, category, clarifying_questions, default_enabled)
     values
       ($1, 'ZZZ activate core',  'core',  'each', 100, 1, 'none', 'zzz', '[]'::jsonb, true),
       ($1, 'ZZZ activate extra', 'extra', 'each', 200, 2, 'none', 'zzz', '[]'::jsonb, false)`,
    [TRADE],
  );
  // A tenant whose primary trade is electrical (migration 046 backfills it,
  // and tenants.trade FKs trades(name) since migration 051) — proves step 1
  // appends the new trade WITHOUT overwriting the existing primary.
  const tenantId = (await c.query(
    `insert into tenants (business_name, owner_email, owner_mobile, trade, trades, status)
     values ('ZZZ Activate Test Co', 'zzz@example.test', '+61400000000', 'electrical', '{}', 'active')
     returning id`,
  )).rows[0].id;

  // ── activate ──────────────────────────────────────────────────────
  const r = (await c.query(
    `select activate_trade_for_tenant($1, $2) r`, [tenantId, TRADE],
  )).rows[0].r;
  check("activation reports ok", r.ok === true);
  check("pricing_book reported seeded", r.pricing_book_seeded === true);
  check("2 offerings reported seeded", r.offerings_seeded === 2);

  const tradesArr = (await c.query(`select trade, trades from tenants where id = $1`, [tenantId])).rows[0];
  check("trade appended to tenants.trades[]", (tradesArr.trades ?? []).includes(TRADE));
  check("existing primary scalar trade left unchanged", tradesArr.trade === "electrical");

  const pb = (await c.query(
    `select hourly_rate, default_markup_pct, licence_type from pricing_book
      where tenant_id = $1 and trade = $2`, [tenantId, TRADE],
  )).rows[0];
  check("pricing_book row created for (tenant, trade)", !!pb);
  check("pricing_book seeded hourly_rate from defaults", pb && Number(pb.hourly_rate) === 118);
  check("pricing_book seeded markup from defaults", pb && Number(pb.default_markup_pct) === 26);
  check("pricing_book seeded licence label into licence_type", pb && pb.licence_type === "ZZZ activate licence");

  const offerings = (await c.query(
    `select sa.default_enabled, tso.enabled
       from tenant_service_offerings tso
       join shared_assemblies sa on sa.id = tso.assembly_id
      where tso.tenant_id = $1 and sa.trade = $2
      order by sa.default_enabled desc`, [tenantId, TRADE],
  )).rows;
  check("2 offerings seeded", offerings.length === 2);
  check("default_enabled service landed enabled", offerings[0]?.enabled === true);
  check("opt-in extra landed disabled", offerings[1]?.enabled === false);

  // ── idempotency — re-activate ────────────────────────────────────
  const r2 = (await c.query(
    `select activate_trade_for_tenant($1, $2) r`, [tenantId, TRADE],
  )).rows[0].r;
  check("re-activation does not re-seed pricing_book", r2.pricing_book_seeded === false);
  check("re-activation seeds 0 new offerings", r2.offerings_seeded === 0);
  const tradesCount = (await c.query(`select trades from tenants where id = $1`, [tenantId])).rows[0]
    .trades.filter((t) => t === TRADE).length;
  check("re-activation does not duplicate the trade in trades[]", tradesCount === 1);

  // ── negative — a trade with no pricing defaults must be rejected ──
  await c.query(
    `insert into trades (name, display_name, is_job_based, active)
     values ($1, 'ZZZ No Defaults', true, true)`, [TRADE_NO_DEF],
  );
  let rejected = false;
  try {
    await c.query(`select activate_trade_for_tenant($1, $2)`, [tenantId, TRADE_NO_DEF]);
  } catch {
    rejected = true;
  }
  check("activation rejected for a trade with no trade_pricing_defaults", rejected);

  console.log(`\n${pass} passed · ${fail} failed`);
} catch (err) {
  console.error("Test threw:", err.message ?? err);
  fail++;
} finally {
  try {
    await cleanup();
    console.log("cleaned up — no zzz_activate rows left on staging");
  } catch (e) {
    console.error("CLEANUP FAILED:", e.message ?? e);
  }
  await c.end();
}

process.exit(fail > 0 ? 1 : 0);
