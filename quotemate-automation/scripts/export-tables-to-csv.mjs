// QuoteMate · export every public table to CSV
// Usage:  node --env-file=.env.local scripts/export-tables-to-csv.mjs
//
// Connects with the service-role DB URL, enumerates every base table in the
// `public` schema, and writes one <table>.csv per table into ../db-export/.
// CSV is RFC-4180-ish: CRLF line endings, fields quoted only when they
// contain a comma / quote / newline, inner quotes doubled. jsonb/json/array
// columns are serialised as JSON; timestamps as ISO-8601; bytea as base64.
//
// ⚠ The output contains real customer PII — ../db-export/ is gitignored.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "db-export");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

function toCsvField(v) {
  if (v === null || v === undefined) return "";
  let s;
  if (Buffer.isBuffer(v)) s = v.toString("base64");
  else if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v); // jsonb, json, arrays
  else s = String(v);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(fieldNames, rows) {
  const lines = [fieldNames.map(toCsvField).join(",")];
  for (const row of rows) {
    lines.push(fieldNames.map((f) => toCsvField(row[f])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await c.connect();
  mkdirSync(outDir, { recursive: true });

  const { rows: tables } = await c.query(`
    select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`);

  console.log(`Exporting ${tables.length} table(s) → ${outDir}\n`);

  let totalRows = 0;
  for (const { table_name } of tables) {
    const { rows: cols } = await c.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by ordinal_position`,
      [table_name],
    );
    const fieldNames = cols.map((r) => r.column_name);

    const { rows } = await c.query(`select * from "${table_name}"`);
    const csv = toCsv(fieldNames, rows);
    writeFileSync(join(outDir, `${table_name}.csv`), csv, "utf8");
    totalRows += rows.length;
    console.log(`  ✓ ${table_name.padEnd(34)}${String(rows.length).padStart(7)} rows`);
  }

  console.log(`\nDone. ${tables.length} tables, ${totalRows.toLocaleString()} total rows → ${outDir}`);
} catch (err) {
  console.error("Export failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
