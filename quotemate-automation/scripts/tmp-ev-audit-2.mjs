import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (label, sql, params=[]) => {
  try { const r = await c.query(sql, params); console.log('=== ' + label + ' ==='); console.dir(r.rows, { depth: 5 }) }
  catch(e){ console.log('=== ' + label + ' ERR: ' + e.message) }
}
await q('tenants', `select id, business_name, trade, trades, status, billing_exempt from tenants order by business_name`)
await q('EV-enabled tenants pricing electrical', `select t.business_name, pb.hourly_rate, pb.default_markup_pct, pb.trade, pb.callout_fee from pricing_book pb join tenants t on t.id=pb.tenant_id where pb.tenant_id in ('829702af-b7eb-48f6-9574-29bf08ed9106','81ca2712-61db-49e2-83cf-2db044be8c65','6dca084c-10d5-4459-b48f-9b45e4bbc68a')`)
await q('pricing_book columns', `select column_name from information_schema.columns where table_name='pricing_book' order by ordinal_position`)
await q('tenant_material_catalogue ev_charger', `select tenant_id, category, name, unit_price_ex_gst, customer_supply_price_ex_gst, active, trade from tenant_material_catalogue where category ilike '%ev%' or name ilike '%charg%'`)
await q('shared_materials charger', `select id,name,category,trade,default_unit_price_ex_gst from shared_materials where category ilike '%ev%' or name ilike '%charg%'`)
await q('catalogue counts by tenant/category (electrical)', `select tenant_id, category, count(*) from tenant_material_catalogue where trade='electrical' and active group by 1,2 order by 1,2`)
await c.end()
