import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const q = async (label, sql, params=[]) => {
  try { const r = await c.query(sql, params); console.log('=== ' + label + ' ==='); console.dir(r.rows, { depth: 5 }) }
  catch(e){ console.log('=== ' + label + ' ERR: ' + e.message) }
}
const EV = '52f354d2-a5e3-4d9f-a7c9-aa13cbe020c7'
await q('tenants cols', `select column_name from information_schema.columns where table_name='tenants' order by ordinal_position`)
await q('tenant_assembly_bom for EV', `select * from tenant_assembly_bom where assembly_id=$1`, [EV])
await q('EV assembly row', `select id,name,trade,category,default_labour_hours,default_unit_price_ex_gst,default_enabled,always_inspection,inspection_triggers,price_recipe from shared_assemblies where id=$1`, [EV])
await q('offerings for EV', `select tenant_id, enabled from tenant_service_offerings where assembly_id=$1`, [EV])
await q('overrides for EV', `select * from tenant_assembly_overrides where assembly_id=$1`, [EV])
await q('pricing_book', `select tenant_id, hourly_rate, default_markup_pct, trade from pricing_book`)
await q('job_type_bounds ev', `select * from job_type_bounds where job_type ilike '%ev%'`)
await c.end()
