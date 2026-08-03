// QuoteMate · run migration 187 (Phase 7 — custom-assembly recipe parent)
//
// SAFE BY DEFAULT. Without --apply this only prints the SQL and exits
// (dry run, no DB connection). A human opts in explicitly.
//
// Dry run:   node --env-file=.env.local scripts/run-migration-187.mjs
// Apply:     node --env-file=.env.local scripts/run-migration-187.mjs --apply
// Rollback:  node --env-file=.env.local scripts/run-migration-187.mjs --rollback --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes("--rollback");
const file = rollback ? "187_down.sql" : "187_bom_custom_assembly_parent.sql";
const sql = readFileSync(join(here, "..", "sql", "migrations", file), "utf8");
const apply = process.argv.includes("--apply");

if (!apply) {
  console.log(
    `\nDRY RUN — ${file} NOT applied (no --apply flag).\n` +
      (rollback
        ? "Would DROP custom_assembly_id, restore NOT NULL on assembly_id, and\n" +
          "DELETE every recipe line belonging to a tenant's OWN job (they cannot\n" +
          "survive assembly_id becoming NOT NULL again). See 187_down.sql for the\n" +
          "backup query to run first.\n"
        : "Adds custom_assembly_id to tenant_assembly_bom, makes assembly_id\n" +
          "NULLABLE, and adds a CHECK that EXACTLY ONE parent is set. Lets a tradie\n" +
          "give their own custom job a recipe; today only shared jobs can have one.\n") +
      "Re-run with --apply after human approval:\n" +
      `  node --env-file=.env.local scripts/run-migration-187.mjs${rollback ? " --rollback" : ""} --apply\n`,
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
  // Pre-flight: the rollback DELETES rows, so say how many before doing it.
  if (rollback) {
    const { rows } = await client.query(
      `select count(*)::int as n from tenant_assembly_bom where assembly_id is null`,
    );
    console.log(`\nRollback will DELETE ${rows[0].n} custom-parented recipe line(s).`);
    if (rows[0].n > 0) {
      console.log("  ⚠ Back them up first — see the query in 187_down.sql.");
    }
  }

  console.log(`\nApplying ${file} …`);
  await client.query(sql);
  console.log("  statement block applied");

  // ── verify ───────────────────────────────────────────────────────────
  // Assert the end state rather than trusting the absence of an error: a
  // half-applied migration here leaves a table that accepts orphan rows.
  const { rows: cols } = await client.query(
    `select column_name, is_nullable
       from information_schema.columns
      where table_name = 'tenant_assembly_bom'
        and column_name in ('assembly_id','custom_assembly_id')
      order by column_name`,
  );
  console.table(cols);

  const byName = Object.fromEntries(cols.map((c) => [c.column_name, c.is_nullable]));

  if (rollback) {
    if ("custom_assembly_id" in byName) {
      console.error("  FAIL — custom_assembly_id still present");
      process.exit(1);
    }
    if (byName.assembly_id !== "NO") {
      console.error("  FAIL — assembly_id should be NOT NULL again");
      process.exit(1);
    }
    console.log("  verified: column dropped, assembly_id NOT NULL restored");
  } else {
    if (byName.custom_assembly_id !== "YES") {
      console.error("  FAIL — custom_assembly_id missing or not nullable");
      process.exit(1);
    }
    if (byName.assembly_id !== "YES") {
      console.error("  FAIL — assembly_id must be NULLABLE for a custom-parented row");
      process.exit(1);
    }
    console.log("  verified: custom_assembly_id nullable, assembly_id nullable");

    // The CHECK must be VALIDATED, not merely present. A NOT VALID constraint
    // guards future writes but leaves existing rows unproven, which is exactly
    // the ambiguity this verification exists to remove.
    const { rows: con } = await client.query(
      `select convalidated from pg_constraint
        where conrelid = 'tenant_assembly_bom'::regclass
          and conname = 'tenant_assembly_bom_one_parent'`,
    );
    if (con.length !== 1) {
      console.error("  FAIL — tenant_assembly_bom_one_parent missing");
      process.exit(1);
    }
    if (con[0].convalidated !== true) {
      console.error("  FAIL — the CHECK is NOT VALID; existing rows are unproven");
      process.exit(1);
    }
    console.log("  verified: one-parent CHECK present and VALIDATED");

    // ON DELETE CASCADE, unlike 185's catalogue_id (SET NULL). A deleted
    // assembly means the job is gone and its recipe lines describe nothing.
    const { rows: fk } = await client.query(
      `select confdeltype from pg_constraint
        where conrelid = 'tenant_assembly_bom'::regclass
          and contype = 'f'
          and conkey = array[(
            select attnum from pg_attribute
             where attrelid = 'tenant_assembly_bom'::regclass
               and attname = 'custom_assembly_id')]`,
    );
    if (fk[0]?.confdeltype !== "c") {
      console.error(
        `  FAIL — custom_assembly_id FK delete rule is '${fk[0]?.confdeltype ?? "none"}', expected 'c' (CASCADE)`,
      );
      process.exit(1);
    }
    console.log("  verified: custom_assembly_id FK is ON DELETE CASCADE");

    // Prove the CHECK actually bites, rather than trusting that it exists.
    // Rolled back either way, so this writes nothing.
    for (const [label, sqlText] of [
      ["no parent", `insert into tenant_assembly_bom (tenant_id, trade, material_category, quantity)
                       select tenant_id, trade, 'probe', 1 from tenant_assembly_bom limit 1`],
      ["both parents", `insert into tenant_assembly_bom (tenant_id, trade, material_category, quantity, assembly_id, custom_assembly_id)
                          select tenant_id, trade, 'probe', 1, assembly_id,
                                 (select id from tenant_custom_assemblies limit 1)
                            from tenant_assembly_bom where assembly_id is not null limit 1`],
    ]) {
      await client.query("begin");
      let rejected = false;
      try {
        await client.query(sqlText);
      } catch {
        rejected = true;
      }
      await client.query("rollback");
      if (!rejected) {
        console.error(`  FAIL — the CHECK accepted a row with ${label}`);
        process.exit(1);
      }
      console.log(`  verified: a row with ${label} is rejected`);
    }

    const { rows: used } = await client.query(
      `select count(*)::int as n from tenant_assembly_bom where custom_assembly_id is not null`,
    );
    console.log(`  rows already using a custom parent: ${used[0].n}`);
  }

  console.log("\nDone.\n");
} catch (err) {
  console.error("\nFAILED:", err.message ?? err);
  process.exitCode = 1;
} finally {
  await client.end();
}
