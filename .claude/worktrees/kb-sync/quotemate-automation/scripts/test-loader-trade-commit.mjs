// End-to-end verification of migrations 053 + 054 — the full new-trade
// bundle commit/rollback path: trades, categories, trade_pricing_defaults,
// trade_prompts, and a service. Stages the bundle IN THE WRONG ORDER so it
// proves the commit's ORDER BY reorders correctly — the trade must insert
// before anything that FKs to it (categories, pricing defaults, prompts) and
// before any service that names it; rollback must delete in reverse order.
//
// Staging only — refuses to run against production. Cleans up either way.
// Usage: node --env-file=.env.staging.local scripts/test-loader-trade-commit.mjs

import pg from "pg";

const { Client } = pg;
const PROD_REF = "bobvihqwhtcbxneelfns";
const TRADE = "zzz_test_trade";

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
  await c.query(`delete from shared_assemblies where trade = $1`, [TRADE]);
  // trades cascades categories + trade_pricing_defaults + trade_prompts.
  await c.query(`delete from trades where name = $1`, [TRADE]);
  await c.query(`delete from import_batches where source = 'trade-commit-test'`);
}

async function createBatch(key) {
  const { rows } = await c.query(
    `insert into import_batches (idempotency_key, admin_user_id, source, status)
     values ($1, gen_random_uuid(), 'trade-commit-test', 'staged') returning id`,
    [key],
  );
  return rows[0].id;
}

async function stage(batchId, table, payload) {
  await c.query(
    `insert into import_staged_rows
       (batch_id, target_table, row_class, payload, validation_status, smoke_status)
     values ($1, $2, 'NEW', $3, 'passed', 'passed')`,
    [batchId, table, JSON.stringify(payload)],
  );
}

try {
  await c.connect();
  await cleanup();

  const batch = await createBatch(`trade-test-${Date.now()}`);
  // Stage in the WRONG order on purpose — commit's ORDER BY must fix it:
  // service + categories + prompts + defaults all FK to a trade staged last.
  await stage(batch, "shared_assemblies", {
    trade: TRADE,
    name: "ZZZ trade test service",
    description: "loader trade-commit test",
    default_unit: "each",
    default_unit_price_ex_gst: 100,
    default_labour_hours: 1,
    default_exclusions: "none",
    category: "zzz_cat_a",
    clarifying_questions: [],
    default_enabled: false,
  });
  await stage(batch, "categories", { trade: TRADE, name: "zzz_cat_a", grounding_tag: "general" });
  await stage(batch, "categories", { trade: TRADE, name: "zzz_cat_b", grounding_tag: "general" });
  await stage(batch, "trade_prompts", {
    trade: TRADE,
    estimator_system_prompt: "ZZZ test estimator prompt",
    sms_scope_blurb: "We do zzz test work.",
    sms_trade_rules: "",
    voice_greeting: "",
    voice_system_prompt: "",
  });
  await stage(batch, "trade_pricing_defaults", {
    trade: TRADE,
    hourly_rate: 115,
    call_out_minimum: 120,
    apprentice_rate: 60,
    senior_rate: 150,
    default_markup_pct: 25,
    risk_buffer_pct: 15,
    min_labour_hours: 2,
    gst_registered: true,
    licence_label: "ZZZ test licence",
  });
  await stage(batch, "trades", { name: TRADE, display_name: "ZZZ Test Trade", is_job_based: true });

  const commit = (await c.query(`select commit_import_batch($1) r`, [batch])).rows[0].r;
  check("commit reports 6 rows committed", commit.committed === 6);

  const tradeRow = (await c.query(`select id from trades where name = $1`, [TRADE])).rows[0];
  check("trade row created", !!tradeRow);
  const catN = (await c.query(
    `select count(*)::int n from categories cat
       join trades tr on tr.id = cat.trade_id where tr.name = $1`, [TRADE],
  )).rows[0].n;
  check("2 categories created + linked to the trade", catN === 2);
  const asmN = (await c.query(
    `select count(*)::int n from shared_assemblies where trade = $1`, [TRADE],
  )).rows[0].n;
  check("service created under the new trade", asmN === 1);

  const pd = (await c.query(
    `select tpd.hourly_rate, tpd.licence_label from trade_pricing_defaults tpd
       join trades tr on tr.id = tpd.trade_id where tr.name = $1`, [TRADE],
  )).rows[0];
  check("trade_pricing_defaults created + linked", !!pd);
  check("pricing defaults carry the staged hourly_rate", pd && Number(pd.hourly_rate) === 115);
  check("pricing defaults carry the staged licence_label", pd && pd.licence_label === "ZZZ test licence");

  const tp = (await c.query(
    `select tp.estimator_system_prompt from trade_prompts tp
       join trades tr on tr.id = tp.trade_id where tr.name = $1`, [TRADE],
  )).rows[0];
  check("trade_prompts created + linked", !!tp);
  check(
    "prompt pack carries the staged estimator prompt",
    tp && tp.estimator_system_prompt === "ZZZ test estimator prompt",
  );

  const commit2 = (await c.query(`select commit_import_batch($1) r`, [batch])).rows[0].r;
  check("re-commit is idempotent", commit2.already_committed === true);

  // Rollback — must delete service + categories + prompts + defaults, then
  // the trade itself (every FK reference gone before the trade row).
  const rb = (await c.query(`select rollback_import_batch($1) r`, [batch])).rows[0].r;
  check("rollback deleted 6 rows", rb.deleted === 6);
  const tradeAfter = (await c.query(`select count(*)::int n from trades where name = $1`, [TRADE])).rows[0].n;
  check("trade gone after rollback", tradeAfter === 0);
  const asmAfter = (await c.query(`select count(*)::int n from shared_assemblies where trade = $1`, [TRADE])).rows[0].n;
  check("service gone after rollback", asmAfter === 0);
  const pdAfter = (await c.query(
    `select count(*)::int n from trade_pricing_defaults tpd
       join trades tr on tr.id = tpd.trade_id where tr.name = $1`, [TRADE],
  )).rows[0].n;
  check("pricing defaults gone after rollback", pdAfter === 0);
  const tpAfter = (await c.query(
    `select count(*)::int n from trade_prompts tp
       join trades tr on tr.id = tp.trade_id where tr.name = $1`, [TRADE],
  )).rows[0].n;
  check("prompt pack gone after rollback", tpAfter === 0);

  const rb2 = (await c.query(`select rollback_import_batch($1) r`, [batch])).rows[0].r;
  check("re-rollback is idempotent", rb2.already_rolled_back === true);

  console.log(`\n${pass} passed · ${fail} failed`);
} catch (err) {
  console.error("Test threw:", err.message ?? err);
  fail++;
} finally {
  try {
    await cleanup();
    console.log("cleaned up — no zzz_test_trade rows left on staging");
  } catch (e) {
    console.error("CLEANUP FAILED:", e.message ?? e);
  }
  await c.end();
}

process.exit(fail > 0 ? 1 : 0);
