// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Enable Row-Level Security on all tables
//
// Sets RLS = enabled with NO policies → deny-by-default for anon &
// authenticated roles. service_role still bypasses RLS, so the
// pipeline keeps working.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";
const { Client } = pg;

const TABLES = [
  "shared_assemblies",
  "shared_materials",
  "pricing_book",
  "calls",
  "intakes",
  "quotes",
  "quote_line_items",
];

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("\n→ Checking RLS status before...\n");
async function status() {
  const { rows } = await client.query(`
    select c.relname as table, c.relrowsecurity as rls_enabled,
           coalesce((select count(*) from pg_policies p where p.tablename = c.relname and p.schemaname = 'public'), 0) as policies
    from pg_class c
    join pg_namespace n on c.relnamespace = n.oid
    where n.nspname = 'public' and c.relname = any($1::text[])
    order by c.relname
  `, [TABLES]);
  return rows;
}

const before = await status();
for (const r of before) {
  const tag = r.rls_enabled ? "✓ RLS on " : "  rls off";
  console.log(`  ${tag}  ${r.table.padEnd(22)}  ${r.policies} policies`);
}

console.log("\n→ Enabling RLS on each table (no policies → deny-by-default)...\n");
for (const t of TABLES) {
  await client.query(`alter table ${t} enable row level security`);
  console.log(`  ✓ ${t}`);
}

console.log("\n→ Verifying...\n");
const after = await status();
for (const r of after) {
  const tag = r.rls_enabled ? "✓ RLS on " : "✗ rls OFF";
  console.log(`  ${tag}  ${r.table.padEnd(22)}  ${r.policies} policies`);
}

console.log("\n→ Smoke-testing service_role can still read calls...");
const { rows: smoke } = await client.query(`select count(*)::int as n from calls`);
console.log(`  ✓ service_role read OK — calls has ${smoke[0].n} rows`);

await client.end();
console.log(`\n✓ All 7 tables now RLS-enabled with no policies.`);
console.log(`  anon and authenticated roles cannot touch them.`);
console.log(`  service_role (your webhook + scripts) bypasses RLS as before.\n`);
