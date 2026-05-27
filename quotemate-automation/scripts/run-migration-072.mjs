// QuoteMate · run migration 072 (relax three over-broad inspection_triggers)
// Usage:  node --env-file=.env.local scripts/run-migration-072.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, "..", "sql", "migrations", "072_relax_inspection_triggers.sql");

const FAN_ID = "9964b317-9a5e-4938-b94c-5a63f6f8fe0c";
const DOWNLIGHT_ID = "8b5f7b97-367a-431f-8838-0aca658cf21e";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("Missing SUPABASE_DB_URL in .env.local");
  process.exit(1);
}

const sql = readFileSync(sqlPath, "utf8");
const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

async function snapshot(client) {
  const { rows } = await client.query(
    `select id, name, inspection_triggers
     from shared_assemblies
     where id = any($1::uuid[])
     order by name`,
    [[FAN_ID, DOWNLIGHT_ID]],
  );
  return rows;
}

try {
  await c.connect();

  console.log("\nPre-state:");
  const before = await snapshot(c);
  for (const r of before) {
    console.log(`  ${r.name}`);
    console.log(`    triggers (${r.inspection_triggers.length}):`, r.inspection_triggers.join(" · "));
  }

  console.log(`\n-> Applying 072_relax_inspection_triggers.sql (${sql.length.toLocaleString()} chars)...`);
  await c.query(sql);
  console.log("OK migration applied");

  console.log("\nPost-state:");
  const after = await snapshot(c);
  for (const r of after) {
    console.log(`  ${r.name}`);
    console.log(`    triggers (${r.inspection_triggers.length}):`, r.inspection_triggers.join(" · "));
  }

  const violations = [];
  for (const r of after) {
    if (r.id === FAN_ID && r.inspection_triggers.includes("high ceiling")) {
      violations.push("'high ceiling' still present on fan row");
    }
    if (r.id === DOWNLIGHT_ID) {
      if (r.inspection_triggers.includes("switch more than 5 metres")) {
        violations.push("'switch more than 5 metres' still present on downlight row");
      }
      if (r.inspection_triggers.includes("no existing switch")) {
        violations.push("'no existing switch' still present on downlight row");
      }
    }
  }

  if (violations.length > 0) {
    console.error("\nPOST-VERIFY FAIL:");
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log("\nOK All three over-broad triggers are gone. Companion triggers intact.");
} catch (err) {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
} finally {
  await c.end();
}
