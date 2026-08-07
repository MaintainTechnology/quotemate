// QuoteMate · run migration 190
// (spec generic-quote-request-form §1 — trade_lead_requests)
//
// SAFE BY DEFAULT. Without --apply this only prints the SQL and exits
// (dry run, no DB connection). A human opts in explicitly.
//
// Dry run:   node --env-file=.env.local scripts/run-migration-190.mjs
// Apply:     node --env-file=.env.local scripts/run-migration-190.mjs --apply
// Rollback:  node --env-file=.env.local scripts/run-migration-190.mjs --rollback --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes("--rollback");
const file = rollback ? "190_trade_lead_requests_down.sql" : "190_trade_lead_requests.sql";
const sql = readFileSync(join(here, "..", "sql", "migrations", file), "utf8");
const apply = process.argv.includes("--apply");

if (!apply) {
  console.log(
    `\nDRY RUN — ${file} NOT applied (no --apply flag).\n` +
      (rollback
        ? "Would DROP public.trade_lead_requests. DESTRUCTIVE: every outstanding\n" +
          "form link dies with it — a customer holding a /quote-request/<token> SMS\n" +
          "gets a dead end. See 190_trade_lead_requests_down.sql for the backup.\n"
        : "Creates public.trade_lead_requests — one row per self-serve quote-request\n" +
          "form link, for any trade (roofing/electrical/plumbing/painting). Additive,\n" +
          "idempotent, writes NO data. painting_lead_requests is NOT touched: painting\n" +
          "keeps running on its own table until a follow-up spec retires it.\n") +
      "Re-run with --apply after human approval:\n" +
      `  node --env-file=.env.local scripts/run-migration-190.mjs${rollback ? " --rollback" : ""} --apply\n`,
  );
  console.log("─".repeat(68));
  console.log(sql);
  process.exit(0);
}

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL missing — run with: node --env-file=.env.local ...");
  process.exit(1);
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

async function tableExists(table) {
  const { rows } = await client.query(
    `select exists (
       select 1 from information_schema.tables
        where table_schema = 'public' and table_name = $1
     ) as present`,
    [table],
  );
  return rows[0].present;
}

try {
  const before = await tableExists("trade_lead_requests");
  console.log(`\n  before · trade_lead_requests exists: ${before}`);

  console.log(`Applying ${file} …`);
  await client.query(sql);
  console.log("  statement block applied");

  const after = await tableExists("trade_lead_requests");
  console.log(`  after  · trade_lead_requests exists: ${after}`);

  if (rollback) {
    if (after) {
      console.error("  FAIL — trade_lead_requests still present");
      process.exit(1);
    }
    console.log("  verified: trade_lead_requests dropped");
  } else {
    if (!after) {
      console.error("  FAIL — trade_lead_requests missing");
      process.exit(1);
    }

    const { rows: cols } = await client.query(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'trade_lead_requests'
        order by ordinal_position`,
    );
    const shape = Object.fromEntries(cols.map((c) => [c.column_name, `${c.data_type}/${c.is_nullable}`]));
    const expected = {
      token: "text/NO",
      trade: "text/NO",
      tenant_id: "uuid/YES",
      conversation_id: "uuid/YES",
      customer_phone: "text/YES",
      status: "text/NO",
      quote_token: "text/YES",
      created_at: "timestamp with time zone/NO",
      submitted_at: "timestamp with time zone/YES",
    };
    const wrong = Object.entries(expected).filter(([k, v]) => shape[k] !== v);
    if (wrong.length) {
      console.error("  FAIL — column shape mismatch:");
      for (const [k, v] of wrong) console.error(`    ${k}: got ${shape[k] ?? "MISSING"}, expected ${v}`);
      process.exit(1);
    }
    console.log(`  verified: ${cols.length} columns, all shapes match the spec`);

    const { rows: idx } = await client.query(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename = 'trade_lead_requests'
        order by indexname`,
    );
    console.log(`  verified: indexes ${idx.map((i) => i.indexname).join(", ")}`);

    const { rows: rls } = await client.query(
      `select relrowsecurity from pg_class
        where oid = 'public.trade_lead_requests'::regclass`,
    );
    if (!rls[0]?.relrowsecurity) {
      console.error("  FAIL — RLS is off; the table holds customer_phone");
      process.exit(1);
    }
    console.log("  verified: RLS enabled (service-role routes bypass it)");

    // painting_lead_requests must be untouched — the spec's one hard boundary.
    const paintingStillThere = await tableExists("painting_lead_requests");
    if (!paintingStillThere) {
      console.error("  FAIL — painting_lead_requests is gone; 190 must never touch it");
      process.exit(1);
    }
    console.log("  verified: painting_lead_requests untouched");
  }

  console.log("\nDone.\n");
} catch (err) {
  console.error("\nFAILED:", err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end();
}
