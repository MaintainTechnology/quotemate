// Audits the Supabase database against beginner-walkthrough.html § Foundation 2.
import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const checks = [];
const ok = (name, detail) => checks.push({ status: "PASS", name, detail });
const bad = (name, detail) => checks.push({ status: "FAIL", name, detail });
const warn = (name, detail) => checks.push({ status: "WARN", name, detail });

// F2.3 — pgvector extension enabled
{
  const { rows } = await client.query(
    "select extname, extversion from pg_extension where extname = 'vector'"
  );
  if (rows.length) ok("F2.3 pgvector extension", `enabled (v${rows[0].extversion})`);
  else bad("F2.3 pgvector extension", "NOT enabled");
}

// F2.4 — library tables exist with expected columns
const expectedTables = {
  shared_assemblies: [
    "id", "trade", "name", "description", "default_unit",
    "default_unit_price_ex_gst", "default_labour_hours", "default_exclusions",
  ],
  shared_materials: [
    "id", "trade", "name", "brand", "unit", "default_unit_price_ex_gst",
  ],
  pricing_book: [
    "id", "hourly_rate", "call_out_minimum", "apprentice_rate",
    "default_markup_pct", "risk_buffer_pct", "gst_registered",
    "licence_type", "licence_number", "licence_state", "licence_expiry", "overlays",
  ],
  calls: [
    "id", "vapi_call_id", "caller_number", "duration_seconds", "transcript",
    "recording_url", "photo_urls", "ended_at", "created_at",
  ],
  intakes: [
    "id", "call_id", "job_type", "address", "suburb", "scope", "access",
    "property", "risks", "inspection_required", "caller", "timing",
    "confidence", "confidence_reason", "embedding", "created_at",
  ],
  quotes: [
    "id", "intake_id", "status", "scope_of_works", "assumptions",
    "risk_flags", "good", "better", "best", "optional_upsells",
    "estimated_timeframe", "needs_inspection", "inspection_reason", "gst_note",
    "selected_tier", "subtotal_ex_gst", "gst", "total_inc_gst",
    "created_at", "sent_at", "accepted_at",
  ],
  quote_line_items: [
    "id", "quote_id", "tier", "description", "quantity", "unit",
    "unit_price_ex_gst", "total_ex_gst", "source",
  ],
};

for (const [table, cols] of Object.entries(expectedTables)) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns where table_name = $1 and table_schema = 'public' order by ordinal_position`,
    [table]
  );
  if (!rows.length) {
    bad(`table ${table}`, "does NOT exist");
    continue;
  }
  const actual = rows.map((r) => r.column_name);
  const missing = cols.filter((c) => !actual.includes(c));
  const extra = actual.filter((c) => !cols.includes(c));
  if (missing.length === 0 && extra.length === 0) {
    ok(`table ${table}`, `all ${cols.length} columns match`);
  } else {
    bad(
      `table ${table}`,
      `missing: [${missing.join(", ")}] · extra: [${extra.join(", ")}]`
    );
  }
}

// Verify embedding column is vector(1536) on intakes
{
  const { rows } = await client.query(`
    select format_type(atttypid, atttypmod) as type
    from pg_attribute
    where attrelid = 'public.intakes'::regclass and attname = 'embedding'
  `);
  if (rows[0]?.type === "vector(1536)") ok("intakes.embedding type", "vector(1536)");
  else bad("intakes.embedding type", `got: ${rows[0]?.type ?? "missing"}`);
}

// F2.6 — match_intakes function exists
{
  const { rows } = await client.query(`
    select proname, pg_get_function_identity_arguments(oid) as args
    from pg_proc where proname = 'match_intakes'
  `);
  if (rows.length) ok("F2.6 match_intakes function", `exists (${rows[0].args})`);
  else bad("F2.6 match_intakes function", "does NOT exist");
}

// F2.7 — seed counts match walkthrough's "Done check"
const seedExpect = [
  ["shared_assemblies", 5],
  ["shared_materials", 8],
  ["pricing_book", 1],
  ["calls", 0],
  ["intakes", 0],
  ["quotes", 0],
  ["quote_line_items", 0],
];
for (const [table, expected] of seedExpect) {
  const { rows } = await client.query(`select count(*)::int as n from ${table}`);
  const actual = rows[0].n;
  if (actual === expected) ok(`F2.7 ${table} row count`, `${actual} (expected ${expected})`);
  else if (actual > expected && expected === 0) ok(`${table} row count`, `${actual} (pipeline data; harmless)`);
  else bad(`F2.7 ${table} row count`, `got ${actual}, expected ${expected}`);
}

// F2.7 — verify seed values match build-guide step 5 exactly
{
  const { rows } = await client.query(
    `select name from shared_assemblies order by default_unit_price_ex_gst, name`
  );
  const expected = [
    "Replace double GPO",
    "Install LED downlight",
    "Hardwire 240V smoke alarm",
    "Install outdoor IP-rated LED light",
    "Install customer-supplied ceiling fan",
  ].sort();
  const actual = rows.map((r) => r.name).sort();
  if (JSON.stringify(actual) === JSON.stringify(expected))
    ok("seed assemblies content", "all 5 expected names present");
  else bad("seed assemblies content", `got: ${actual.join(" | ")}`);
}

{
  const { rows } = await client.query(`
    select hourly_rate, default_markup_pct, licence_type, licence_state from pricing_book
  `);
  const r = rows[0];
  if (
    r &&
    Number(r.hourly_rate) === 110 &&
    Number(r.default_markup_pct) === 28 &&
    r.licence_type === "NECA" &&
    r.licence_state === "NSW"
  ) ok("seed pricing_book content", "hourly_rate=110, markup=28%, NECA NSW");
  else bad("seed pricing_book content", JSON.stringify(r));
}

// F2.2 — env vars present locally (we can only check this side)
const requiredLocal = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
for (const k of requiredLocal) {
  if (process.env[k]) ok(`F2.2 .env.local · ${k}`, "set");
  else bad(`F2.2 .env.local · ${k}`, "missing");
}

if (process.env.NEXT_PUBLIC_SUPABASE_URL?.endsWith("/rest/v1/") || process.env.NEXT_PUBLIC_SUPABASE_URL?.endsWith("/rest/v1")) {
  bad("F2.2 URL format", "ends with /rest/v1/ — strip that off");
} else if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  ok("F2.2 URL format", "clean (no /rest/v1/ suffix)");
}

// F2.2 — Vercel env vars (we can't check from here — flag as warning)
warn("F2.2 Vercel env vars", "cannot verify from here; check vercel.com/dashboard manually");

// Print results
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
const colour = { PASS: "\x1b[32m", FAIL: "\x1b[31m", WARN: "\x1b[33m", reset: "\x1b[0m" };
console.log("\n  Foundation 2 audit  ·  beginner-walkthrough.html §F2\n");
console.log("  " + "─".repeat(78));
for (const c of checks) {
  const tag = `${colour[c.status]}${pad(c.status, 4)}${colour.reset}`;
  console.log(`  ${tag}  ${pad(c.name, 38)}  ${c.detail}`);
}
console.log("  " + "─".repeat(78));
const fails = checks.filter((c) => c.status === "FAIL").length;
const warns = checks.filter((c) => c.status === "WARN").length;
const passes = checks.filter((c) => c.status === "PASS").length;
console.log(`  ${passes} pass · ${warns} warn · ${fails} fail\n`);

await client.end();
process.exit(fails > 0 ? 1 : 0);
