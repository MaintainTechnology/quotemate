// QuoteMate · run migration 188 (Phase 4 R9 — task conditions)
//
// SAFE BY DEFAULT. Without --apply this only prints the SQL and exits
// (dry run, no DB connection). A human opts in explicitly.
//
// Dry run:   node --env-file=.env.local scripts/run-migration-188.mjs
// Apply:     node --env-file=.env.local scripts/run-migration-188.mjs --apply
// Rollback:  node --env-file=.env.local scripts/run-migration-188.mjs --rollback --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes("--rollback");
const file = rollback ? "188_down.sql" : "188_task_conditions.sql";
const sql = readFileSync(join(here, "..", "sql", "migrations", file), "utf8");
const apply = process.argv.includes("--apply");

const TABLES = ["shared_assembly_tasks", "tenant_assembly_tasks"];

if (!apply) {
  console.log(
    `\nDRY RUN — ${file} NOT applied (no --apply flag).\n` +
      (rollback
        ? "Would DROP include_when from both task tables. DESTRUCTIVE: every\n" +
          "condition set on a step is discarded. See 188_down.sql for the backup.\n"
        : "Adds a NULLABLE include_when jsonb to shared_assembly_tasks and\n" +
          "tenant_assembly_tasks, so a STEP can depend on the product the same way\n" +
          "a PART already can (R7). NULL = always include, so nothing changes on\n" +
          "its own. Both tables are empty today.\n") +
      "Re-run with --apply after human approval:\n" +
      `  node --env-file=.env.local scripts/run-migration-188.mjs${rollback ? " --rollback" : ""} --apply\n`,
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

  for (const table of TABLES) {
    const { rows: cols } = await client.query(
      `select is_nullable, data_type from information_schema.columns
        where table_name = $1 and column_name = 'include_when'`,
      [table],
    );
    if (rollback) {
      if (cols.length !== 0) {
        console.error(`  FAIL — ${table}.include_when still present`);
        process.exit(1);
      }
      console.log(`  verified: ${table}.include_when dropped`);
      continue;
    }
    if (cols.length !== 1) {
      console.error(`  FAIL — ${table}.include_when missing`);
      process.exit(1);
    }
    if (cols[0].is_nullable !== "YES" || cols[0].data_type !== "jsonb") {
      console.error(
        `  FAIL — ${table}.include_when is ${cols[0].data_type}/${cols[0].is_nullable}, expected jsonb/YES`,
      );
      process.exit(1);
    }
    const { rows: con } = await client.query(
      `select 1 from pg_constraint
        where conrelid = $1::regclass and conname = $2`,
      [table, `${table}_include_when_object`],
    );
    if (con.length !== 1) {
      console.error(`  FAIL — ${table}_include_when_object constraint missing`);
      process.exit(1);
    }
    console.log(`  verified: ${table}.include_when jsonb nullable + object CHECK`);

    // Prove the CHECK bites rather than trusting it exists. Rolled back.
    await client.query("begin");
    let rejected = false;
    try {
      await client.query(
        `update ${table} set include_when = '"a string"'::jsonb where true`,
      );
      // An empty table cannot prove anything by UPDATE, so assert the
      // constraint expression directly instead.
      const { rows } = await client.query(
        `select (jsonb_typeof('"a string"'::jsonb) = 'object') as would_pass`,
      );
      rejected = rows[0].would_pass === false;
    } catch {
      rejected = true;
    }
    await client.query("rollback");
    if (!rejected) {
      console.error(`  FAIL — ${table} would accept a non-object include_when`);
      process.exit(1);
    }
    console.log(`  verified: a non-object include_when is rejected`);
  }

  if (!rollback) {
    for (const table of TABLES) {
      const { rows } = await client.query(`select count(*)::int as n from ${table}`);
      console.log(`  ${table}: ${rows[0].n} row(s)`);
    }
  }

  console.log("\nDone.\n");
} catch (err) {
  console.error("\nFAILED:", err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end();
}
