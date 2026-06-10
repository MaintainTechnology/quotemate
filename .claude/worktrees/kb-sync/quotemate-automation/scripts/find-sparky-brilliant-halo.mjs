// Wider hunt: find any Sparky quote whose JSON contains "Brilliant Halo"
// OR contains a $19.50 / $22.23 unit price (with qty=10) — that's the
// duplicate the user is staring at on the edit page.

import pg from "pg";
const { Client } = pg;

const SPARKY_ID = "6dca084c-10d5-4459-b48f-9b45e4bbc68a";

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// 1. Any Sparky quote with "Brilliant Halo" text anywhere.
const halo = await c.query(
  `
  select id, intake_id, created_at, status, routing_decision,
         good, better, best
    from quotes
   where tenant_id = $1
     and (good::text ilike '%brilliant halo%'
       or better::text ilike '%brilliant halo%'
       or best::text  ilike '%brilliant halo%')
   order by created_at desc
   limit 20
  `,
  [SPARKY_ID]
);
console.log(`\n[Brilliant Halo] match count: ${halo.rows.length}`);

// 2. Any Sparky quote whose JSON contains BOTH 19.5 and 22.23 (the
//    two unit prices the user reports), or the round 195 / 222.23 totals.
const dupePrices = await c.query(
  `
  select id, intake_id, created_at, status, routing_decision,
         good, better, best
    from quotes
   where tenant_id = $1
     and (
       (good::text   like '%19.5%' and good::text   like '%22.23%')
    or (better::text like '%19.5%' and better::text like '%22.23%')
    or (best::text   like '%19.5%' and best::text   like '%22.23%')
     )
   order by created_at desc
   limit 20
  `,
  [SPARKY_ID]
);
console.log(`[$19.50 + $22.23 co-occur] match count: ${dupePrices.rows.length}`);

// 3. Same as #2 but looking across ALL tenants in case the edit page
//    is showing somebody else's tenant after an account switch.
const dupePricesAny = await c.query(
  `
  select id, tenant_id, intake_id, created_at, status, routing_decision,
         good, better, best
    from quotes
   where (
       (good::text   like '%19.5%' and good::text   like '%22.23%')
    or (better::text like '%19.5%' and better::text like '%22.23%')
    or (best::text   like '%19.5%' and best::text   like '%22.23%')
     )
   order by created_at desc
   limit 20
  `
);
console.log(`[$19.50 + $22.23 co-occur ANY tenant] match count: ${dupePricesAny.rows.length}`);

// 4. ANY quote (any tenant) whose tier contains TWO line items with the
//    same description.  Crude scan: pull the last 200 quotes and check
//    each tier for description duplicates.
const recent = await c.query(
  `
  select id, tenant_id, intake_id, created_at, status,
         good, better, best
    from quotes
   where tenant_id = $1
   order by created_at desc
   limit 200
  `,
  [SPARKY_ID]
);

function extract(tier) {
  if (!tier) return null;
  return tier.line_items ?? tier.lineItems ?? tier.items ?? tier.lines ?? null;
}
function desc(li) {
  return (li?.description ?? li?.desc ?? li?.name ?? li?.label ?? JSON.stringify(li))
    .toLowerCase()
    .trim();
}

const dupQuotes = [];
for (const q of recent.rows) {
  for (const t of ["good", "better", "best"]) {
    const items = extract(q[t]);
    if (!items) continue;
    const seen = new Map();
    for (const li of items) {
      const d = desc(li);
      if (!seen.has(d)) seen.set(d, []);
      seen.get(d).push(li);
    }
    for (const [d, arr] of seen.entries()) {
      if (arr.length > 1) {
        dupQuotes.push({
          quote_id: q.id,
          tenant_id: q.tenant_id,
          tier: t,
          description: d,
          dup_count: arr.length,
          rows: arr,
          created_at: q.created_at,
        });
      }
    }
  }
}
console.log(`\nALL Sparky tiers with duplicate-description line items: ${dupQuotes.length}`);

// Print first 5 candidates with full JSON
for (const f of dupQuotes.slice(0, 10)) {
  console.log("\n====================================================================");
  console.log(`Quote ${f.quote_id}  tier=${f.tier}  desc="${f.description}"  ${f.dup_count}x  created=${f.created_at.toISOString()}`);
  for (const li of f.rows) {
    console.log("   ", JSON.stringify(li));
  }
}

// Also print any Brilliant Halo matches in full
for (const q of halo.rows) {
  console.log("\n====================================================================");
  console.log(`[BRILLIANT-HALO HIT] ${q.id}  created=${q.created_at.toISOString()}`);
  for (const t of ["good", "better", "best"]) {
    const items = extract(q[t]);
    if (!items) continue;
    console.log(`  --- ${t} ---`);
    for (const li of items) console.log("   ", JSON.stringify(li));
  }
}

for (const q of dupePrices.rows) {
  console.log("\n====================================================================");
  console.log(`[$19.50/$22.23 HIT - SPARKY] ${q.id}  created=${q.created_at.toISOString()}  status=${q.status}`);
  for (const t of ["good", "better", "best"]) {
    const items = extract(q[t]);
    if (!items) continue;
    console.log(`  --- ${t} ---`);
    for (const li of items) console.log("   ", JSON.stringify(li));
  }
}

for (const q of dupePricesAny.rows) {
  console.log("\n====================================================================");
  console.log(`[$19.50/$22.23 HIT - ANY TENANT] ${q.id}  tenant=${q.tenant_id}  created=${q.created_at.toISOString()}`);
  for (const t of ["good", "better", "best"]) {
    const items = extract(q[t]);
    if (!items) continue;
    console.log(`  --- ${t} ---`);
    for (const li of items) console.log("   ", JSON.stringify(li));
  }
}

await c.end();
