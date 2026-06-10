// READ-ONLY: list all shared_assembly_bom rows with timestamps to verify 084.
// Run: node --env-file=.env.local scripts/diag-verify-084.mjs

import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const rows = await c.query(`
  select a.name as assembly, b.material_category, b.quantity, b.required, b.sort, b.created_at
  from shared_assembly_bom b
  join shared_assemblies a on a.id = b.assembly_id
  order by b.created_at, a.name, b.sort
`);
console.log("\n=== ALL shared_assembly_bom rows (by created_at) ===");
console.table(rows.rows.map(r => ({
  assembly: r.assembly, category: r.material_category, qty: r.quantity,
  required: r.required, sort: r.sort, created_at: r.created_at?.toISOString?.() ?? String(r.created_at),
})));

await c.end();
console.log("(done — read-only)");
