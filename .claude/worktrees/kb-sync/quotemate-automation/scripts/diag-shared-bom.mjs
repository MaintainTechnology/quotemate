// READ-ONLY: how well-seeded is shared_assembly_bom? (the job-level baseline recipe
// the deterministic builder COULD fall back to, the way buildBomHint already does.)
// Run: node --env-file=.env.local scripts/diag-shared-bom.mjs

import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const totals = await c.query(`
  select a.trade,
         count(distinct a.id)::int as assemblies,
         count(distinct b.assembly_id)::int as assemblies_with_bom
  from shared_assemblies a
  left join shared_assembly_bom b on b.assembly_id = a.id
  group by a.trade order by a.trade
`);
console.log("\n=== shared_assembly_bom coverage of shared_assemblies, by trade ===");
console.table(totals.rows.map(r => ({
  trade: r.trade, assemblies: r.assemblies, with_bom: r.assemblies_with_bom,
  coverage: r.assemblies ? `${Math.round(100 * r.assemblies_with_bom / r.assemblies)}%` : "n/a",
})));

const rows = await c.query(`select count(*)::int as n from shared_assembly_bom`);
console.log(`\nTotal shared_assembly_bom rows: ${rows.rows[0].n}`);

await c.end();
console.log("(done — read-only)");
