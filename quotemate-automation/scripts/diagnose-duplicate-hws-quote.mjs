// Find the quote with the duplicate Dux Proflo 315L line items and dump
// its full structure so we can see exactly what the estimator produced.
//
// Reference: quote_ref "3669A680" (visible on the customer quote page).
// We don't know the column it's derived from, so we search a few likely
// shapes (first 8 chars of UUID, etc.) plus a content match on the JSONB
// line items.

import pg from "pg";
const { Client } = pg;

const c = new Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

console.log("\n=== Searching by quote_ref pattern (3669A680) ===");
// Try matching by first 8 chars of UUID, case-insensitive.
const byRef = await c.query(`
  select id, intake_id, tenant_id, status, created_at,
         good->'product' as good_product,
         good->'line_items' as good_line_items
  from quotes
  where id::text ilike '3669a680%' or id::text ilike '%3669a680%'
  limit 5
`);
console.log(`  found ${byRef.rowCount} match(es) by UUID prefix`);
for (const r of byRef.rows) console.log(`    `, r.id, r.created_at);

console.log("\n=== Searching by line-item content (Dux Proflo 315L duplicates) ===");
// Find quotes where the good tier's line_items contains "Dux Proflo 315L"
// more than once.
const byContent = await c.query(`
  select q.id, q.intake_id, q.tenant_id, q.status, q.created_at,
         t.business_name,
         i.job_type, i.trade, i.suburb,
         q.good
  from quotes q
  left join intakes i on i.id = q.intake_id
  left join tenants t on t.id = q.tenant_id
  where (
    select count(*) from jsonb_array_elements(q.good->'line_items') li
    where li->>'name' ilike '%Dux Proflo 315L%'
  ) > 1
  order by q.created_at desc
  limit 5
`);
console.log(`  found ${byContent.rowCount} quote(s) with duplicate Dux Proflo 315L lines`);
for (const r of byContent.rows) {
  console.log(`\n  --- quote ${r.id} ---`);
  console.log(`    tenant:    ${r.business_name}`);
  console.log(`    intake:    ${r.intake_id}  (${r.job_type} / ${r.trade} / ${r.suburb})`);
  console.log(`    status:    ${r.status}`);
  console.log(`    created:   ${r.created_at.toISOString()}`);
  console.log(`    GOOD tier line items:`);
  const lineItems = r.good?.line_items ?? [];
  for (const li of lineItems) {
    console.log(`      • ${li.name}`);
    console.log(`        ${li.quantity ?? '?'} × ${li.unit ?? '?'} @ $${li.unit_price_ex_gst ?? '?'} ex GST = $${li.subtotal_ex_gst ?? '?'}`);
    if (li.is_customer_supply !== undefined) console.log(`        is_customer_supply: ${li.is_customer_supply}`);
    if (li.source) console.log(`        source: ${JSON.stringify(li.source)}`);
  }
  console.log(`    GOOD totals:`);
  console.log(`      subtotal_ex_gst: $${r.good?.subtotal_ex_gst}`);
  console.log(`      total_inc_gst:   $${r.good?.total_inc_gst}`);
  console.log(`    routing_decision:`, JSON.stringify(r.good?.routing ?? null));
}

await c.end();
