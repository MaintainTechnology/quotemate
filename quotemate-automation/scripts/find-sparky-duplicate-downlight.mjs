// Find Sparky-tenant quotes with duplicate "Brilliant Halo" / downlight
// line items across tiers. Read-only, observational.

import pg from "pg";
const { Client } = pg;

const SPARKY_ID = "6dca084c-10d5-4459-b48f-9b45e4bbc68a";

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Pull the most recent ~20 Sparky quotes whose JSON contains "downlight" or
// "Brilliant Halo" anywhere in good/better/best.
const { rows } = await c.query(
  `
  select q.id,
         q.intake_id,
         q.tenant_id,
         q.status,
         q.routing_decision,
         q.created_at,
         q.good,
         q.better,
         q.best,
         t.business_name,
         i.job_type,
         i.trade,
         i.suburb,
         i.scope,
         i.confidence
    from quotes q
    left join intakes i on i.id = q.intake_id
    left join tenants  t on t.id = q.tenant_id
   where q.tenant_id = $1
     and (
          q.good::text  ilike '%downlight%' or q.good::text  ilike '%brilliant halo%'
       or q.better::text ilike '%downlight%' or q.better::text ilike '%brilliant halo%'
       or q.best::text   ilike '%downlight%' or q.best::text   ilike '%brilliant halo%'
     )
   order by q.created_at desc
   limit 20
  `,
  [SPARKY_ID]
);

console.log(`\nFound ${rows.length} Sparky quotes mentioning downlight/Brilliant Halo.\n`);

function extractLineItems(tier) {
  if (!tier) return null;
  return tier.line_items ?? tier.lineItems ?? tier.items ?? tier.lines ?? null;
}

function descOf(li) {
  return (
    li?.description ??
    li?.desc ??
    li?.name ??
    li?.label ??
    li?.title ??
    JSON.stringify(li).slice(0, 80)
  );
}

const dupFindings = [];

for (const q of rows) {
  console.log("====================================================================");
  console.log(`Quote ${q.id}`);
  console.log(`  tenant=${q.business_name}  job_type=${q.job_type}  trade=${q.trade}`);
  console.log(`  suburb=${q.suburb}  status=${q.status}  routing=${q.routing_decision}`);
  console.log(`  created=${q.created_at.toISOString()}`);
  console.log(`  intake_id=${q.intake_id}`);
  if (q.scope) {
    console.log(`  intake.scope (truncated):`);
    const s =
      typeof q.scope === "string" ? q.scope : JSON.stringify(q.scope, null, 2);
    console.log(
      s
        .split("\n")
        .map((l) => "    " + l)
        .join("\n")
        .slice(0, 1200)
    );
  }

  for (const tierName of ["good", "better", "best"]) {
    const tier = q[tierName];
    const items = extractLineItems(tier);
    if (!items) {
      console.log(`  ${tierName}: (no recognised line_items key) keys=${tier ? Object.keys(tier).join(",") : "null"}`);
      continue;
    }

    // Build description map to detect dupes.
    const groups = new Map();
    for (const li of items) {
      const d = descOf(li).toLowerCase().trim();
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(li);
    }

    const dups = [...groups.entries()].filter(([, arr]) => arr.length > 1);

    console.log(`\n  --- ${tierName.toUpperCase()} tier (${items.length} line_items) ---`);
    for (const li of items) {
      const desc = descOf(li);
      const unit = li.unit ?? li.uom ?? "";
      const qty = li.qty ?? li.quantity ?? "";
      const unitPrice = li.unit_price_ex_gst ?? li.unitPriceExGst ?? li.unit_price ?? li.price ?? "";
      const lineTotal = li.item_total_ex_gst ?? li.line_total_ex_gst ?? li.total_ex_gst ?? li.total ?? "";
      console.log(
        `    - ${desc}  |  unit=${unit}  qty=${qty}  unit_price_ex_gst=${unitPrice}  item_total_ex_gst=${lineTotal}`
      );
    }

    if (dups.length > 0) {
      console.log(`  >>> DUPLICATES IN ${tierName.toUpperCase()}:`);
      for (const [desc, arr] of dups) {
        console.log(`      "${desc}" appears ${arr.length}x`);
        for (const li of arr) {
          console.log(`        ${JSON.stringify(li)}`);
        }
        dupFindings.push({
          quote_id: q.id,
          tier: tierName,
          description: desc,
          rows: arr,
          intake_id: q.intake_id,
          job_type: q.job_type,
          created_at: q.created_at,
        });
      }
    }
  }
  console.log("");
}

console.log("\n\n====================================================================");
console.log("DUPLICATE FINDINGS SUMMARY");
console.log("====================================================================");
console.log(JSON.stringify(dupFindings, null, 2));

await c.end();
