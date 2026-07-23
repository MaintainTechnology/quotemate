// What does "roofing enabled" actually mean per tenant? Dumps every place a
// tenant's trade capability could live, so we can tell whether the SMS
// roofing receptionist has anything tenant-scoped to consult.
// Usage: node --env-file=.env.local scripts/diag-tenant-roofing-config.mjs

import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const q = async (label, sql, params = []) => {
  try {
    const { rows } = await c.query(sql, params)
    console.log(`\n=== ${label} (${rows.length}) ===`)
    for (const r of rows) console.log('  ' + JSON.stringify(r))
    return rows
  } catch (e) {
    console.log(`\n=== ${label} — ERROR: ${e.message}`)
    return []
  }
}

await q(
  'tenants: trade config + provisioned numbers',
  `select business_name, status, trade, trades,
          twilio_phone_number, vapi_assistant_id is not null as has_vapi
     from tenants order by business_name`,
)

await q(
  'pricing_book rows by tenant+trade (a roofing row = priced for roofing)',
  `select t.business_name, p.trade, p.hourly_rate, p.quote_tier_mode
     from pricing_book p left join tenants t on t.id = p.tenant_id
    order by t.business_name nulls first, p.trade`,
)

await q(
  'tenant_service_offerings grouped by tenant + trade',
  `select t.business_name, sa.trade, count(*) as offerings
     from tenant_service_offerings o
     join tenants t on t.id = o.tenant_id
     left join shared_assemblies sa on sa.id = o.assembly_id
    group by t.business_name, sa.trade order by t.business_name`,
)

// Any column anywhere that smells like a per-trade on/off switch.
await q(
  'columns that could be a per-tenant trade toggle',
  `select table_name, column_name, data_type
     from information_schema.columns
    where table_schema = 'public'
      and (column_name ilike '%trade%' or column_name ilike '%enabled%'
           or column_name ilike '%roofing%' or column_name ilike '%active%')
    order by table_name, column_name`,
)

await q(
  'roofing measurements per tenant (who has actually quoted roofing)',
  `select coalesce(t.business_name,'(no tenant)') as tenant, t.trade as tenant_trade,
          count(*) as roof_quotes
     from roofing_measurements m left join tenants t on t.id = m.tenant_id
    group by 1,2 order by 3 desc`,
)

await c.end()
