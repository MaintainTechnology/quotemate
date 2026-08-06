// QuoteMate · run migration 189 (spec painting-auto-send R3 — quote_sent_at)
//
// SAFE BY DEFAULT. Without --apply this only prints the SQL and exits
// (dry run, no DB connection). A human opts in explicitly.
//
// Dry run:   node --env-file=.env.local scripts/run-migration-189.mjs
// Apply:     node --env-file=.env.local scripts/run-migration-189.mjs --apply
// Rollback:  node --env-file=.env.local scripts/run-migration-189.mjs --rollback --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes("--rollback");
const file = rollback ? "189_down.sql" : "189_painting_quote_sent_at.sql";
const sql = readFileSync(join(here, "..", "sql", "migrations", file), "utf8");
const apply = process.argv.includes("--apply");

if (!apply) {
  console.log(
    `\nDRY RUN — ${file} NOT applied (no --apply flag).\n` +
      (rollback
        ? "Would DROP painting_measurements.quote_sent_at. DESTRUCTIVE: the delivery\n" +
          "evidence is discarded and /p goes back to claiming 'Sent' off released_at,\n" +
          "which is the false positive 189 removed. See 189_down.sql for the backup.\n"
        : "Adds a NULLABLE quote_sent_at timestamptz to painting_measurements — set\n" +
          "only when a carrier ACCEPTS the customer quote SMS, so /p can show 'Sent'\n" +
          "off delivery evidence rather than off the release gate. Writes NO data:\n" +
          "every existing row starts NULL, because 3 of the 8 previously-released\n" +
          "rows are known to have texted nobody and nothing distinguishes them.\n") +
      "Re-run with --apply after human approval:\n" +
      `  node --env-file=.env.local scripts/run-migration-189.mjs${rollback ? " --rollback" : ""} --apply\n`,
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

try {
  console.log(`\nApplying ${file} …`);
  await client.query(sql);
  console.log("  statement block applied");

  const { rows: cols } = await client.query(
    `select is_nullable, data_type from information_schema.columns
      where table_name = 'painting_measurements' and column_name = 'quote_sent_at'`,
  );

  if (rollback) {
    if (cols.length !== 0) {
      console.error("  FAIL — painting_measurements.quote_sent_at still present");
      process.exit(1);
    }
    console.log("  verified: quote_sent_at dropped");
  } else {
    if (cols.length !== 1) {
      console.error("  FAIL — painting_measurements.quote_sent_at missing");
      process.exit(1);
    }
    if (cols[0].is_nullable !== "YES" || cols[0].data_type !== "timestamp with time zone") {
      console.error(
        `  FAIL — quote_sent_at is ${cols[0].data_type}/${cols[0].is_nullable}, expected timestamptz/YES`,
      );
      process.exit(1);
    }
    console.log("  verified: quote_sent_at timestamptz nullable");

    // Post-state report only. There is deliberately NO pass/fail assertion on
    // the data: this migration writes none, so any such check would be
    // incapable of failing on a first apply — and it would run after the SQL
    // above had already committed, with nothing to roll back.
    const { rows: counts } = await client.query(
      `select
         count(*) filter (where quote_sent_at is not null)::int as sent,
         count(*) filter (where released_at is not null)::int as released,
         count(*)::int as total
       from public.painting_measurements`,
    );
    console.log(
      `  painting_measurements: ${counts[0].total} row(s), ${counts[0].released} released, ${counts[0].sent} with send evidence`,
    );
    console.log(
      `  NOTE: every pre-existing row starts with NO send evidence by design — an\n` +
        `  attempted send is not an accepted one, and 3 of the 8 previously-released\n` +
        `  rows are known to have texted nobody. Expect up to 5 tradies to resend a\n` +
        `  quote the customer already has; that is the intended trade.`,
    );
  }

  console.log("\nDone.\n");
} catch (err) {
  console.error("\nFAILED:", err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end();
}
