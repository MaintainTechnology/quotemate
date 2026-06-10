// Dump the tier line items from the quotes row JSONB columns.

import pg from "pg";
const { Client } = pg;
const dbUrl = process.env.SUPABASE_DB_URL;

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const shareToken = getArg("--token");
if (!shareToken) { console.error("Need --token <share_token>"); process.exit(1); }

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = await client.query(
  `select id, share_token, selected_tier, good, better, best
     from quotes where share_token = $1`,
  [shareToken],
);
if (q.rows.length === 0) { console.log("Not found"); process.exit(1); }
const r = q.rows[0];

console.log("Selected tier:", r.selected_tier);
console.log("\n=== GOOD tier ===");
console.log(JSON.stringify(r.good, null, 2));
console.log("\n=== BETTER tier ===");
console.log(JSON.stringify(r.better, null, 2));
console.log("\n=== BEST tier ===");
console.log(JSON.stringify(r.best, null, 2));

await client.end();
