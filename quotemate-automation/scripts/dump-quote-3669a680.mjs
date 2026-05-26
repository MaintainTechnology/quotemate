// Dump the full structure of the duplicate-HWS quote so we can see
// exactly where the duplicate Dux Proflo 315L line is and how the
// estimator stored it.

import pg from "pg";
const { Client } = pg;

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const { rows } = await c.query(`
  select q.id, q.intake_id, q.tenant_id, q.status, q.created_at,
         q.good, q.better, q.best,
         t.business_name,
         i.job_type, i.trade, i.suburb, i.scope, i.confidence
  from quotes q
  left join intakes i on i.id = q.intake_id
  left join tenants t on t.id = q.tenant_id
  where q.id = '3669a680-ab14-41b6-9255-1eca3c73d5c4'
`);
if (rows.length === 0) {
  console.log("Quote not found.");
  process.exit(1);
}
const q = rows[0];

console.log("=== Quote header ===");
console.log(`  id:       ${q.id}`);
console.log(`  tenant:   ${q.business_name}`);
console.log(`  job_type: ${q.job_type}`);
console.log(`  trade:    ${q.trade}`);
console.log(`  suburb:   ${q.suburb}`);
console.log(`  status:   ${q.status}`);
console.log(`  created:  ${q.created_at.toISOString()}`);

for (const tier of ["good", "better", "best"]) {
  const t = q[tier];
  console.log(`\n=== ${tier.toUpperCase()} tier ===`);
  if (!t) {
    console.log("  (null tier)");
    continue;
  }
  // Print top-level keys so we know the shape.
  console.log(`  keys:`, Object.keys(t));
  // Try common shapes for line items.
  const lineItems =
    t.line_items ?? t.lineItems ?? t.items ?? t.lines ?? null;
  if (lineItems) {
    console.log(`  line_items (${lineItems.length}):`);
    for (const li of lineItems) {
      console.log("   ", JSON.stringify(li, null, 2).split("\n").join("\n    "));
    }
  } else {
    // No recognised key — dump the whole tier so we can see what's there.
    console.log(`  FULL TIER DUMP:`);
    console.log("   ", JSON.stringify(t, null, 2).split("\n").join("\n    "));
  }
}

await c.end();
