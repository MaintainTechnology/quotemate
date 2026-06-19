import pg from 'pg';

const dbUrl = process.env.SUPABASE_DB_URL;
const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

console.log('\n=== PRICING BOOK RATES ===\n');
const pb = await client.query(`
  select t.business_name, pb.trade, 
    pb.hourly_rate, pb.default_markup_pct, pb.call_out_minimum, pb.min_labour_hours
  from pricing_book pb
  join tenants t on t.id = pb.tenant_id
  order by t.business_name, pb.trade
`);
for (const r of pb.rows) {
  console.log(`${r.business_name} (${r.trade}): $${r.hourly_rate}/hr, ${r.default_markup_pct}% markup, call-out $${r.call_out_minimum}, min labour ${r.min_labour_hours}h`);
}

console.log('\n=== SAMPLE QUOTES (last 15) ===\n');
const quotes = await client.query(`
  select q.id, i.created_at, i.job_type, i.trade,
    q.good_total_ex_gst, q.better_total_ex_gst, q.best_total_ex_gst
  from quotes q
  join intakes i on i.id = q.intake_id
  where i.trade in ('electrical', 'plumbing')
  order by i.created_at desc
  limit 15
`);
for (const r of quotes.rows) {
  const date = new Date(r.created_at).toISOString().split('T')[0];
  console.log(`${date} ${r.job_type}: $${r.good_total_ex_gst} / $${r.better_total_ex_gst} / $${r.best_total_ex_gst}`);
}

await client.end();
