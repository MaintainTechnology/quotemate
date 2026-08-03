// QuoteMate · run migration 186 (Phase 4 R7/R8 on shared_assembly_bom)
//
// SAFE BY DEFAULT. Without --apply this only prints the SQL and exits
// (dry run, no DB connection). A human opts in explicitly.
//
// Dry run:   node --env-file=.env.local scripts/run-migration-186.mjs
// Apply:     node --env-file=.env.local scripts/run-migration-186.mjs --apply
// Rollback:  node --env-file=.env.local scripts/run-migration-186.mjs --rollback --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes("--rollback");
const file = rollback ? "186_down.sql" : "186_shared_bom_conditions_ratios.sql";
const sqlPath = join(here, "..", "sql", "migrations", file);
const sql = readFileSync(sqlPath, "utf8");
const apply = process.argv.includes("--apply");

const COLUMNS = ["include_when", "quantity_per"];
const CONSTRAINTS = [
  "shared_assembly_bom_quantity_per_positive",
  "shared_assembly_bom_include_when_object",
];

if (!apply) {
  console.log(
    `\nDRY RUN — ${file} NOT applied (no --apply flag).\n` +
      (rollback
        ? "Would DROP include_when and quantity_per from shared_assembly_bom.\n" +
          "DESTRUCTIVE: every condition and ratio seeded on the shared recipes\n" +
          "is discarded. See the backup query in 186_down.sql.\n"
        : "Adds two NULLABLE columns to shared_assembly_bom: include_when (R7)\n" +
          "and quantity_per (R8). NULL means 'behave as today', so this changes\n" +
          "no price on its own. catalogue_id stays tenant-only (185) — a shared\n" +
          "row cannot pin one tenant's product.\n") +
      "Re-run with --apply after human approval:\n" +
      `  node --env-file=.env.local scripts/run-migration-186.mjs${rollback ? " --rollback" : ""} --apply\n`,
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

  // ── verify ───────────────────────────────────────────────────────────
  // A migration that silently half-applies is worse than one that fails, so
  // assert the end state rather than trusting the absence of an error.
  const { rows: cols } = await client.query(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_name = 'shared_assembly_bom'
        and column_name = any($1::text[])
      order by column_name`,
    [COLUMNS],
  );

  if (rollback) {
    if (cols.length !== 0) {
      console.error(`  FAIL — columns still present: ${cols.map((c) => c.column_name).join(", ")}`);
      process.exit(1);
    }
    console.log("  verified: all three columns dropped");
  } else {
    const found = cols.map((c) => c.column_name);
    const missing = COLUMNS.filter((c) => !found.includes(c));
    if (missing.length > 0) {
      console.error(`  FAIL — columns missing: ${missing.join(", ")}`);
      process.exit(1);
    }
    console.table(cols);

    // Every column must be nullable. A NOT NULL here would break every
    // existing recipe line and every insert that does not know about them.
    const notNullable = cols.filter((c) => c.is_nullable !== "YES");
    if (notNullable.length > 0) {
      console.error(
        `  FAIL — must be nullable: ${notNullable.map((c) => c.column_name).join(", ")}`,
      );
      process.exit(1);
    }
    console.log("  verified: both nullable");

    const { rows: cons } = await client.query(
      `select conname from pg_constraint
        where conrelid = 'shared_assembly_bom'::regclass
          and conname = any($1::text[])`,
      [CONSTRAINTS],
    );
    const missingCons = CONSTRAINTS.filter((c) => !cons.some((r) => r.conname === c));
    if (missingCons.length > 0) {
      console.error(`  FAIL — constraints missing: ${missingCons.join(", ")}`);
      process.exit(1);
    }
    console.log(`  verified: ${cons.length} check constraint(s)`);

    // Nothing should be populated yet. If it is, this is a re-apply and the
    // operator should know before assuming a clean slate.
    const { rows: used } = await client.query(
      `select count(*)::int as n from shared_assembly_bom
        where include_when is not null
           or quantity_per is not null
        `,
    );
    console.log(`  rows already using the new columns: ${used[0].n}`);
  }

  console.log("\nDone.\n");
} catch (err) {
  console.error("\nFAILED:", err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end();
}
