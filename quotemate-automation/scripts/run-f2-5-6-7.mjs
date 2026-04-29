// ═══════════════════════════════════════════════════════════════════
// QuoteMate · Re-run beginner-walkthrough.html § F2.5, F2.6, F2.7
//
// Drops the existing pipeline tables and match_intakes function,
// then runs the literal SQL from build-guide.html step 5 verbatim
// — no `if not exists`, no modifications, comments preserved.
//
// Execution order matches what the walkthrough has you click:
//   F2.5 (new query) → F2.6 (new query) → F2.7 (new query)
// ═══════════════════════════════════════════════════════════════════

import pg from "pg";
const { Client } = pg;

// ─── Verbatim F2.5 SQL from build-guide.html step 5 ─────────────────
const F2_5_SQL = `create table calls (
  id uuid primary key default gen_random_uuid(),
  vapi_call_id text unique,
  caller_number text,
  duration_seconds int,
  transcript text,
  recording_url text,
  photo_urls jsonb default '[]'::jsonb,
  ended_at timestamptz,
  created_at timestamptz default now()
);

create table intakes (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calls(id) on delete cascade,
  job_type text,                                          -- enum: downlights, power_points, ceiling_fans, smoke_alarms, outdoor_lighting, switchboard, oven_cooktop, ev_charger, fault_finding, renovation, other
  address text,
  suburb text,
  scope jsonb,                                            -- { item_count, is_new_install, existing_wiring, indoor_outdoor, description }
  access jsonb,                                           -- { roof_access, ceiling_type, wall_type, notes }
  property jsonb,                                         -- { bedrooms, levels, pre_1970, has_solar, phase }
  risks jsonb,                                            -- e.g. ['burning smell', 'ceramic-fuse switchboard', 'water damage near fixture']
  inspection_required boolean default false,                -- true for switchboard / fault_finding / ev_charger / renovation / mains
  caller jsonb,                                           -- { name, phone, email }
  timing jsonb,                                           -- { urgency, preferred_date }
  confidence text,                                        -- LOW / MEDIUM / HIGH
  confidence_reason text,
  embedding vector(1536),
  created_at timestamptz default now()
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid references intakes(id) on delete cascade,
  status text default 'draft',                       -- draft | sent | accepted | declined | expired

  -- Top-level explanatory fields (from Estimator output)
  scope_of_works text,                                  -- plain-English summary
  assumptions jsonb default '[]'::jsonb,
  risk_flags jsonb default '[]'::jsonb,

  -- Three pricing tiers, each storing { label, line_items[], subtotal_ex_gst, timeframe }
  good jsonb,
  better jsonb,
  best jsonb,

  optional_upsells jsonb default '[]'::jsonb,
  estimated_timeframe text,
  needs_inspection boolean default false,
  inspection_reason text,
  gst_note text,

  -- The tier the customer ultimately picks (default 'better' for portal display)
  selected_tier text default 'better',                 -- good | better | best
  subtotal_ex_gst numeric(12,2),                          -- of the selected tier
  gst numeric(12,2),
  total_inc_gst numeric(12,2),

  created_at timestamptz default now(),
  sent_at timestamptz,
  accepted_at timestamptz
);

-- Line items live inside the good/better/best JSONB on quotes.
-- This table is optional — only used to materialise the selected tier's items
-- for invoicing / job-card generation after the customer accepts.
create table quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid references quotes(id) on delete cascade,
  tier text not null,                                    -- which tier this came from
  description text not null,
  quantity numeric(10,2),
  unit text,                                              -- 'each' | 'hr' | 'lm'
  unit_price_ex_gst numeric(10,2),
  total_ex_gst numeric(12,2),
  source text                                              -- 'assembly:UUID' | 'material:UUID' | 'labour' | 'callout'
);`;

// ─── Verbatim F2.6 SQL from beginner-walkthrough.html ───────────────
const F2_6_SQL = `create or replace function match_intakes(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id uuid, scope jsonb, similarity float)
language sql stable as $$
  select id, scope, 1 - (embedding <=> query_embedding) as similarity
  from intakes
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;`;

// ─── Verbatim F2.7 SQL from build-guide.html step 5 ─────────────────
const F2_7_SQL = `-- One assembly per "easy 5" job type — covers v1 auto-quote scope
insert into shared_assemblies (trade, name, description, default_unit, default_unit_price_ex_gst, default_labour_hours, default_exclusions)
values
  ('electrical', 'Install LED downlight',                  'Cut hole, terminate, fit fixture, test',                  'each', 28.00, 0.40, 'Excludes new wiring runs and ceiling repair'),
  ('electrical', 'Replace double GPO',                    'Disconnect, remove old, fit new, test',                   'each', 22.00, 0.30, 'Excludes new circuit work'),
  ('electrical', 'Install customer-supplied ceiling fan',  'Mount, terminate to existing wiring, test',               'each', 35.00, 1.00, 'Excludes ceiling reinforcement and supply of fan'),
  ('electrical', 'Hardwire 240V smoke alarm',             'Mount, terminate, test interconnect',                     'each', 30.00, 0.50, 'Excludes ceiling penetrations beyond standard'),
  ('electrical', 'Install outdoor IP-rated LED light',    'Mount weatherproof fitting on existing circuit',           'each', 32.00, 0.60, 'Excludes new circuit and underground cabling');

-- A handful of materials so lookup_material has something to find
insert into shared_materials (trade, name, brand, unit, default_unit_price_ex_gst)
values
  ('electrical', 'Basic LED downlight',             null,         'each', 28.00),
  ('electrical', 'Tri-colour LED downlight',        null,         'each', 48.00),
  ('electrical', 'Dimmable IP-rated downlight',     null,         'each', 72.00),
  ('electrical', 'Standard double GPO',             'Clipsal',    'each', 25.00),
  ('electrical', 'USB double GPO',                  'Clipsal',    'each', 70.00),
  ('electrical', 'Hardwired smoke alarm',           'Clipsal',    'each', 95.00),
  ('electrical', 'RCBO safety switch',              'Clipsal',    'each', 85.00),
  ('electrical', 'Sundries (terminals, wire, clips)', null,        'each', 50.00);

-- Pricing book row with AU sparky defaults; update licence_* before sending real quotes
insert into pricing_book (hourly_rate, default_markup_pct, licence_type, licence_state)
values (110, 28, 'NECA', 'NSW');`;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log("\n→ Connected to Supabase Postgres.");

try {
  // ── Cleanup: drop pipeline tables (FK-safe via CASCADE) and the function ──
  console.log("\n[prep] Dropping existing pipeline tables and match_intakes function...");
  await client.query(`
    drop table if exists quote_line_items cascade;
    drop table if exists quotes cascade;
    drop table if exists intakes cascade;
    drop table if exists calls cascade;
    drop function if exists match_intakes(vector, int);
  `);
  console.log("       done.");

  // ── Cleanup: truncate library tables so F2.7 seeds don't duplicate ──
  console.log("\n[prep] Truncating library tables for fresh F2.7 seed...");
  await client.query(`truncate shared_assemblies, shared_materials, pricing_book;`);
  console.log("       done.");

  // ── F2.5 — Pipeline tables ──
  console.log("\n[F2.5] Running literal pipeline-tables SQL from build-guide step 5...");
  console.log("       (calls, intakes, quotes, quote_line_items — verbatim with comments)");
  await client.query(F2_5_SQL);
  console.log("       Success. No rows returned.");

  // ── F2.6 — match_intakes function ──
  console.log("\n[F2.6] Running literal match_intakes function SQL...");
  await client.query(F2_6_SQL);
  console.log("       Success. No rows returned.");

  // ── F2.7 — Seed inserts ──
  console.log("\n[F2.7] Running literal seed inserts (5 assemblies + 8 materials + 1 pricing_book)...");
  await client.query(F2_7_SQL);
  console.log("       Success.");

  // ── Verification ──
  console.log("\n[done] Verifying...");

  const tableChecks = [
    ["calls", 0, 9],
    ["intakes", 0, 16],
    ["quotes", 0, 21],
    ["quote_line_items", 0, 9],
    ["shared_assemblies", 5, 8],
    ["shared_materials", 8, 6],
    ["pricing_book", 1, 12],
  ];

  for (const [table, expRows, expCols] of tableChecks) {
    const { rows: c } = await client.query(`select count(*)::int as n from ${table}`);
    const { rows: cols } = await client.query(
      `select count(*)::int as n from information_schema.columns where table_schema='public' and table_name=$1`,
      [table]
    );
    const ok = c[0].n === expRows && cols[0].n === expCols;
    console.log(
      `       ${ok ? "✓" : "✗"} ${table.padEnd(22)} ${c[0].n} rows, ${cols[0].n} cols  (expected ${expRows} rows, ${expCols} cols)`
    );
  }

  // Verify match_intakes function exists with correct signature
  const { rows: fn } = await client.query(`
    select proname, pg_get_function_identity_arguments(oid) as args
    from pg_proc where proname = 'match_intakes'
  `);
  if (fn.length) {
    console.log(`       ✓ match_intakes function     ${fn[0].args}`);
  } else {
    console.log(`       ✗ match_intakes function     MISSING`);
  }

  // Verify intakes.embedding is vector(1536)
  const { rows: embCol } = await client.query(`
    select format_type(atttypid, atttypmod) as type
    from pg_attribute where attrelid = 'public.intakes'::regclass and attname = 'embedding'
  `);
  console.log(`       ${embCol[0]?.type === "vector(1536)" ? "✓" : "✗"} intakes.embedding type     ${embCol[0]?.type ?? "missing"}`);

  console.log("\n✓ F2.5, F2.6, F2.7 re-run complete with literal walkthrough SQL.\n");
} catch (err) {
  console.error(`\n✗ Failed: ${err.message}`);
  if (err.position) console.error(`  at SQL position ${err.position}`);
  process.exit(1);
} finally {
  await client.end();
}
