// QuoteMate · run migration 185 (Phase 4 R7/R8/R11 BOM columns)
//
// SAFE BY DEFAULT. Without --apply this only prints the SQL and exits
// (dry run, no DB connection). A human opts in explicitly.
//
// Dry run:   node --env-file=.env.local scripts/run-migration-185.mjs
// Apply:     node --env-file=.env.local scripts/run-migration-185.mjs --apply
// Rollback:  node --env-file=.env.local scripts/run-migration-185.mjs --rollback --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes("--rollback");
const file = rollback ? "185_down.sql" : "185_bom_conditions_ratios_pins.sql";
const sqlPath = join(here, "..", "sql", "migrations", file);
const sql = readFileSync(sqlPath, "utf8");
const apply = process.argv.includes("--apply");

const COLUMNS = ["include_when", "quantity_per", "catalogue_id"];
const CONSTRAINTS = [
  "tenant_assembly_bom_quantity_per_positive",
  "tenant_assembly_bom_include_when_object",
];

if (!apply) {
  console.log(
    `\nDRY RUN — ${file} NOT applied (no --apply flag).\n` +
      (rollback
        ? "Would DROP include_when, quantity_per and catalogue_id from\n" +
          "tenant_assembly_bom. DESTRUCTIVE: every condition, ratio and product\n" +
          "pin a tradie has set is discarded. See the backup query in 185_down.sql.\n"
        : "Adds three NULLABLE columns to tenant_assembly_bom: include_when (R7),\n" +
          "quantity_per (R8), catalogue_id (R11). NULL means 'behave as today',\n" +
          "so this changes no price on its own.\n") +
      "Re-run with --apply after human approval:\n" +
      `  node --env-file=.env.local scripts/run-migration-185.mjs${rollback ? " --rollback" : ""} --apply\n`,
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
      where table_name = 'tenant_assembly_bom'
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
    console.log("  verified: all three nullable");

    const { rows: cons } = await client.query(
      `select conname from pg_constraint
        where conrelid = 'tenant_assembly_bom'::regclass
          and conname = any($1::text[])`,
      [CONSTRAINTS],
    );
    const missingCons = CONSTRAINTS.filter((c) => !cons.some((r) => r.conname === c));
    if (missingCons.length > 0) {
      console.error(`  FAIL — constraints missing: ${missingCons.join(", ")}`);
      process.exit(1);
    }
    console.log(`  verified: ${cons.length} check constraint(s)`);

    // ON DELETE SET NULL, not CASCADE. Cascade would delete the recipe LINE
    // when a product is removed, silently dropping a required part from
    // every future quote for that job.
    const { rows: fk } = await client.query(
      `select confdeltype from pg_constraint
        where conrelid = 'tenant_assembly_bom'::regclass
          and contype = 'f'
          and conkey = array[
            (select attnum from pg_attribute
              where attrelid = 'tenant_assembly_bom'::regclass
                and attname = 'catalogue_id')
          ]`,
    );
    if (fk[0]?.confdeltype !== "n") {
      console.error(
        `  FAIL — catalogue_id FK delete rule is '${fk[0]?.confdeltype ?? "none"}', expected 'n' (SET NULL)`,
      );
      process.exit(1);
    }
    console.log("  verified: catalogue_id FK is ON DELETE SET NULL");

    const { rows: idx } = await client.query(
      `select indexname from pg_indexes
        where tablename = 'tenant_assembly_bom'
          and indexname = 'tenant_assembly_bom_catalogue_idx'`,
    );
    if (idx.length !== 1) {
      console.error("  FAIL — tenant_assembly_bom_catalogue_idx missing");
      process.exit(1);
    }
    console.log("  verified: catalogue_id index present");

    // Nothing should be populated yet. If it is, this is a re-apply and the
    // operator should know before assuming a clean slate.
    const { rows: used } = await client.query(
      `select count(*)::int as n from tenant_assembly_bom
        where include_when is not null
           or quantity_per is not null
           or catalogue_id is not null`,
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
