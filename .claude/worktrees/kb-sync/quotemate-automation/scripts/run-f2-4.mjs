// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Re-run beginner-walkthrough.html § F2.4 verbatim
//
// Drops the three library tables, then runs the literal SQL block
// from F2.4 of the walkthrough — exactly as written, no `if not exists`
// guards, no modifications. Then re-seeds with the F2.7 inserts.
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";
const { Client } = pg;

// ─── Verbatim F2.4 SQL from beginner-walkthrough.html ──────────────
const F2_4_SQL = `create table shared_assemblies (
  id uuid primary key default gen_random_uuid(),
  trade text not null default 'electrical',
  name text not null,
  description text,
  default_unit text,
  default_unit_price_ex_gst numeric(10,2),
  default_labour_hours numeric(6,2),
  default_exclusions text
);

create table shared_materials (
  id uuid primary key default gen_random_uuid(),
  trade text not null default 'electrical',
  name text not null,
  brand text,
  unit text,
  default_unit_price_ex_gst numeric(10,2)
);

create table pricing_book (
  id uuid primary key default gen_random_uuid(),
  hourly_rate numeric(8,2) default 110,
  call_out_minimum numeric(8,2) default 150,
  apprentice_rate numeric(8,2) default 60,
  default_markup_pct numeric(5,2) default 28,
  risk_buffer_pct numeric(5,2) default 15,
  gst_registered boolean default true,
  licence_type text,
  licence_number text,
  licence_state text,
  licence_expiry date,
  overlays jsonb default '{}'::jsonb
);`;

// ─── Verbatim F2.7 seed SQL from build-guide.html step 5 ────────────
const F2_7_SEEDS = `insert into shared_assemblies (trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions)
values
  ('electrical', 'Install LED downlight',                  'Cut hole, terminate, fit fixture, test',                  'each', 28.00, 0.40, 'Excludes new wiring runs and ceiling repair'),
  ('electrical', 'Replace double GPO',                     'Disconnect, remove old, fit new, test',                   'each', 22.00, 0.30, 'Excludes new circuit work'),
  ('electrical', 'Install customer-supplied ceiling fan',  'Mount, terminate to existing wiring, test',               'each', 35.00, 1.00, 'Excludes ceiling reinforcement and supply of fan'),
  ('electrical', 'Hardwire 240V smoke alarm',              'Mount, terminate, test interconnect',                     'each', 30.00, 0.50, 'Excludes ceiling penetrations beyond standard'),
  ('electrical', 'Install outdoor IP-rated LED light',     'Mount weatherproof fitting on existing circuit',          'each', 32.00, 0.60, 'Excludes new circuit and underground cabling');

insert into shared_materials (trade, name, brand, unit, default_unit_price_ex_gst)
values
  ('electrical', 'Basic LED downlight',              null,         'each', 28.00),
  ('electrical', 'Tri-colour LED downlight',         null,         'each', 48.00),
  ('electrical', 'Dimmable IP-rated downlight',      null,         'each', 72.00),
  ('electrical', 'Standard double GPO',              'Clipsal',    'each', 25.00),
  ('electrical', 'USB double GPO',                   'Clipsal',    'each', 70.00),
  ('electrical', 'Hardwired smoke alarm',            'Clipsal',    'each', 95.00),
  ('electrical', 'RCBO safety switch',               'Clipsal',    'each', 85.00),
  ('electrical', 'Sundries (terminals, wire, clips)', null,        'each', 50.00);

insert into pricing_book (hourly_rate, default_markup_pct, licence_type, licence_state)
values (110, 28, 'NECA', 'NSW');`;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("\n→ Connected to Supabase Postgres.");

try {
  console.log("\n[1/4] Dropping existing library tables (safe — no FK dependents)...");
  await client.query(`
    drop table if exists shared_assemblies cascade;
    drop table if exists shared_materials cascade;
    drop table if exists pricing_book cascade;
  `);
  console.log("       done.");

  console.log("\n[2/4] Running literal F2.4 SQL from beginner-walkthrough.html...");
  console.log("       (verbatim, no `if not exists`, no modifications)");
  await client.query(F2_4_SQL);
  console.log("       Success. No rows returned.");

  console.log("\n[3/4] Running literal F2.7 seeds from build-guide.html step 5...");
  await client.query(F2_7_SEEDS);
  console.log("       Success. No rows returned.");

  console.log("\n[4/4] Verifying counts and column structure...");
  const checks = [
    ["shared_assemblies", 5, 8],
    ["shared_materials", 8, 6],
    ["pricing_book", 1, 12],
  ];
  for (const [table, expectedRows, expectedCols] of checks) {
    const { rows: countRows } = await client.query(
      `select count(*)::int as n from ${table}`
    );
    const { rows: colRows } = await client.query(
      `select count(*)::int as n from information_schema.columns
       where table_schema='public' and table_name=$1`,
      [table]
    );
    const rowsOk = countRows[0].n === expectedRows;
    const colsOk = colRows[0].n === expectedCols;
    const mark = rowsOk && colsOk ? "✓" : "✗";
    console.log(
      `       ${mark} ${table.padEnd(22)} ${countRows[0].n} rows, ${colRows[0].n} cols  (expected ${expectedRows} rows, ${expectedCols} cols)`
    );
  }

  console.log("\n✓ F2.4 + F2.7 re-run complete with literal walkthrough SQL.\n");
} catch (err) {
  console.error(`\n✗ Failed: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
