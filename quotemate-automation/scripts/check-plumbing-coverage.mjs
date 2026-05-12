// Inspect plumbing catalogue depth per job_type.
// Goal: find a job_type with assembly + 3 distinct material price points
// so the estimator can confidently produce 3 tiers.

import pg from "pg";
const { Client } = pg;
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("=== PRICING BOOK (plumbing) ===");
const pb = await client.query(
  `select hourly_rate, call_out_minimum, apprentice_rate,
          default_markup_pct, risk_buffer_pct, min_labour_hours,
          gst_registered, licence_state, licence_type
     from pricing_book where trade='plumbing' limit 1`,
);
console.log(JSON.stringify(pb.rows[0], null, 2));

console.log("\n=== ASSEMBLIES (plumbing) — grouped by likely job_type ===");
const buckets = {
  blocked_drain:   ["hand rod","jet blast","cctv drain"],
  hot_water:       ["electric hws","gas hws","heat pump hws"],
  tap_repair:      ["tap washer"],
  tap_replace:     ["tap replacement"],
  toilet_repair:   ["toilet cistern"],
  toilet_replace:  ["toilet suite"],
};

const a = await client.query(
  `select name, description, default_unit, default_unit_price_ex_gst,
          default_labour_hours, default_exclusions
     from shared_assemblies where trade='plumbing'
     order by name`,
);
for (const [jobType, keywords] of Object.entries(buckets)) {
  const matches = a.rows.filter(r =>
    keywords.some(k => r.name.toLowerCase().includes(k))
  );
  console.log(`\n${jobType}: ${matches.length} assembly row(s)`);
  for (const m of matches) {
    console.log(`  ${m.name}: $${m.default_unit_price_ex_gst}/each, ${m.default_labour_hours}hr`);
  }
}

console.log("\n=== MATERIALS (plumbing) — by job_type bucket ===");
const matBuckets = {
  hot_water:      ["hws","hot water"],
  tap_repair:     [],
  tap_replace:    ["tap","mixer"],
  toilet_repair:  ["cistern internals"],
  toilet_replace: ["toilet suite","cistern toilet"],
  sundries:       ["sundries"],
};
const m = await client.query(
  `select name, brand, default_unit_price_ex_gst
     from shared_materials where trade='plumbing'
     order by default_unit_price_ex_gst`,
);
for (const [jobType, keywords] of Object.entries(matBuckets)) {
  const matches = m.rows.filter(r =>
    keywords.some(k => r.name.toLowerCase().includes(k))
  );
  if (matches.length === 0) continue;
  console.log(`\n${jobType}: ${matches.length} material row(s)`);
  for (const r of matches) {
    console.log(`  ${r.name} (${r.brand ?? 'no brand'}): $${r.default_unit_price_ex_gst}`);
  }
}

console.log("\n=== BEST 3-TIER-READY CANDIDATES ===");
for (const jobType of ["hot_water","tap_replace","toilet_replace"]) {
  const keywords = matBuckets[jobType] ?? [];
  const matches = m.rows.filter(r =>
    keywords.some(k => r.name.toLowerCase().includes(k))
  );
  const tiers = matches.length;
  console.log(`${jobType}: ${tiers} material price points` + (tiers >= 3 ? "  ✅ 3-tier capable" : "  ⚠️"));
}

await client.end();
