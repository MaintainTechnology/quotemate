// QuoteMate · run migration 023 (tenant_custom_assemblies)
// Usage:  node --env-file=.env.local scripts/run-migration-023.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(
  here,
  "..",
  "sql",
  "migrations",
  "023_tenant_custom_assemblies.sql",
);

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const client = new Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(
    `\n→ Running 023_tenant_custom_assemblies.sql (${sql.length.toLocaleString()} chars)...`,
  );
  await client.query(sql);
  console.log("OK migration applied");

  // Verify table + columns + indexes are in place.
  const { rows: cols } = await client.query(
    `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_name = 'tenant_custom_assemblies'
       order by ordinal_position`,
  );
  console.log(`\n  Table columns (${cols.length}):`);
  for (const c of cols) {
    const dflt = c.column_default ? ` default ${c.column_default}` : "";
    const nullable = c.is_nullable === "YES" ? " NULL" : " NOT NULL";
    console.log(
      `    ${c.column_name.padEnd(28)} ${c.data_type.padEnd(25)}${nullable}${dflt}`,
    );
  }

  const { rows: indexes } = await client.query(
    `select indexname, indexdef
       from pg_indexes
       where tablename = 'tenant_custom_assemblies'
       order by indexname`,
  );
  console.log(`\n  Indexes (${indexes.length}):`);
  for (const i of indexes) {
    console.log(`    ${i.indexname}`);
  }

  // Sanity: how many rows exist today (should be 0 — table is brand new).
  const { rows: cnt } = await client.query(
    `select count(*)::int as n from tenant_custom_assemblies`,
  );
  console.log(`\n  Existing rows: ${cnt[0].n}`);
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
