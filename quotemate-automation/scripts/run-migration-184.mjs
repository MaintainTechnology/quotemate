// QuoteMate · run migration 184 (per-job task checklists)
//
// SAFE BY DEFAULT. Without --apply this only prints the SQL and exits
// (dry run, no DB connection). A human opts in explicitly.
//
// Dry run:   node --env-file=.env.local scripts/run-migration-184.mjs
// Apply:     node --env-file=.env.local scripts/run-migration-184.mjs --apply
// Rollback:  node --env-file=.env.local scripts/run-migration-184.mjs --rollback --apply

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const rollback = process.argv.includes("--rollback");
const file = rollback ? "184_down.sql" : "184_assembly_tasks.sql";
const sqlPath = join(here, "..", "sql", "migrations", file);
const sql = readFileSync(sqlPath, "utf8");
const apply = process.argv.includes("--apply");
const TABLES = ["shared_assembly_tasks", "tenant_assembly_tasks"];

if (!apply) {
  console.log(
    `\nDRY RUN — ${file} NOT applied (no --apply flag).\n` +
      (rollback
        ? "Would DROP shared_assembly_tasks and tenant_assembly_tasks.\n"
        : "Creates shared_assembly_tasks + tenant_assembly_tasks (per-job step checklists).\n") +
      "Re-run with --apply after human approval:\n" +
      `  node --env-file=.env.local scripts/run-migration-184.mjs${rollback ? " --rollback" : ""} --apply\n\n` +
      `--- SQL (${sql.length.toLocaleString()} chars) ---\n${sql}`,
  );
  process.exit(0);
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  console.log(`\n→ Applying ${file} (${sql.length.toLocaleString()} chars)...`);
  await client.query(sql);
  const { rows } = await client.query(
    `select table_name from information_schema.tables
      where table_schema='public' and table_name = any($1::text[])`,
    [TABLES],
  );
  const found = rows.map((r) => r.table_name).sort();
  if (rollback) {
    if (found.length !== 0) {
      console.error(`FAIL — still present after rollback: ${found.join(", ")}`);
      process.exit(1);
    }
    console.log("OK — both task tables dropped.");
  } else {
    if (found.length !== TABLES.length) {
      console.error(`FAIL — expected ${TABLES.join(", ")}; found ${found.join(", ") || "none"}`);
      process.exit(1);
    }
    console.log(`OK — ${found.join(", ")} created.`);

    // RLS is the easiest thing to leave off and the hardest to notice: the
    // routes use the service-role key, so a missing `enable row level
    // security` changes nothing observable while quietly making these the
    // only tenant-scoped tables in `public` without it. Assert, don't assume.
    const { rows: rls } = await client.query(
      `select relname, relrowsecurity from pg_class
        where relname = any($1::text[]) and relkind = 'r'`,
      [TABLES],
    );
    const off = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    if (off.length > 0) {
      console.error(`FAIL — RLS is OFF on: ${off.join(", ")}`);
      process.exit(1);
    }
    console.log(`OK — RLS enabled on ${rls.map((r) => r.relname).sort().join(", ")}.`);
  }
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
