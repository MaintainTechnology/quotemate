// Quick view of what's actually in Supabase after F2.6 + F2.7 ran.
import pg from "pg";
const { Client } = pg;
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("\n── F2.6 · match_intakes function signature ──────────────────────────");
const { rows: fn } = await client.query(`
  select pg_get_function_identity_arguments(oid) as args,
         pg_get_function_result(oid) as returns
  from pg_proc where proname = 'match_intakes'
`);
console.log(`  match_intakes(${fn[0].args})`);
console.log(`  returns ${fn[0].returns}`);

console.log("\n── F2.7 · shared_assemblies (5 rows) ────────────────────────────────");
const { rows: a } = await client.query(`
  select name, default_unit_price_ex_gst as price, default_labour_hours as hrs
  from shared_assemblies order by name
`);
for (const r of a) {
  console.log(`  · ${r.name.padEnd(42)}  $${r.price}  ${r.hrs} hrs labour`);
}

console.log("\n── F2.7 · shared_materials (8 rows) ─────────────────────────────────");
const { rows: m } = await client.query(`
  select name, brand, default_unit_price_ex_gst as price
  from shared_materials order by default_unit_price_ex_gst
`);
for (const r of m) {
  console.log(`  · ${r.name.padEnd(42)}  ${(r.brand ?? "—").padEnd(8)}  $${r.price}`);
}

console.log("\n── F2.7 · pricing_book (1 row) ──────────────────────────────────────");
const { rows: p } = await client.query(`
  select hourly_rate, default_markup_pct, licence_type, licence_state from pricing_book
`);
for (const r of p) {
  console.log(`  · hourly_rate=$${r.hourly_rate}/hr · markup=${r.default_markup_pct}% · licence=${r.licence_type} ${r.licence_state}`);
}

console.log("");
await client.end();
