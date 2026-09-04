import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (label, sql, params=[]) => {
  try { const r = await c.query(sql, params); console.log('=== ' + label + ' ==='); console.dir(r.rows, { depth: 6 }) }
  catch(e){ console.log('=== ' + label + ' ERR: ' + e.message) }
}
await q('pricing_book EV tenants', `select t.business_name, pb.trade, pb.hourly_rate, pb.default_markup_pct, pb.call_out_minimum, pb.min_labour_hours, pb.risk_buffer_pct, pb.quote_tier_mode from pricing_book pb join tenants t on t.id=pb.tenant_id where pb.tenant_id in ('829702af-b7eb-48f6-9574-29bf08ed9106','81ca2712-61db-49e2-83cf-2db044be8c65','6dca084c-10d5-4459-b48f-9b45e4bbc68a') order by 1,2`)
await q('all electrical catalogue for EV tenants', `select t.business_name, c.category, c.name, c.unit_price_ex_gst, c.customer_supply_price_ex_gst, c.tier_hint, c.active from tenant_material_catalogue c join tenants t on t.id=c.tenant_id where c.tenant_id in ('829702af-b7eb-48f6-9574-29bf08ed9106','81ca2712-61db-49e2-83cf-2db044be8c65','6dca084c-10d5-4459-b48f-9b45e4bbc68a') and c.trade='electrical' order by 1,2`)
await q('shared_materials electrical categories', `select category, count(*), min(default_unit_price_ex_gst), max(default_unit_price_ex_gst) from shared_materials where trade='electrical' group by 1 order by 1`)
await q('shared_assemblies electrical', `select id,name,category,default_labour_hours,default_unit_price_ex_gst,always_inspection,default_enabled from shared_assemblies where trade='electrical' order by name`)
await c.end()
