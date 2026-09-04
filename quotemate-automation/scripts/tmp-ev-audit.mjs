import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl:{rejectUnauthorized:false} })
await c.connect()
const t = await c.query(`select id, business_name as name, trades, trade from tenants order by business_name`)
for (const row of t.rows) {
  const trades = (row.trades && row.trades.length) ? row.trades : (row.trade ? [row.trade] : [])
  if (!trades.length) { console.log(row.name, 'NO TRADES'); continue }
  // custom assemblies enabled
  const ca = await c.query(`select name, always_inspection from tenant_custom_assemblies where tenant_id=$1 and enabled=true order by trade, name`, [row.id])
  const sa = await c.query(`select id,name,trade,category,default_enabled, clarifying_questions from shared_assemblies where trade = any($1) order by trade, name`, [trades])
  const off = await c.query(`select assembly_id, enabled from tenant_service_offerings where tenant_id=$1`, [row.id])
  const m = new Map(off.rows.filter(o=>o.assembly_id).map(o=>[o.assembly_id, o.enabled ?? false]))
  const CORE = new Set(['downlight','gpo','fan','smoke_alarm','outdoor_light','drain','hot_water','tap','toilet'])
  const hasQ = v => Array.isArray(v) && v.some(q=>typeof q==='string'&&q.trim())
  const extras = sa.rows.filter(r=>{
    const enabled = m.has(r.id) ? m.get(r.id) : (r.default_enabled ?? true)
    const hardEasy = r.default_enabled===true && !hasQ(r.clarifying_questions) && CORE.has(String(r.category??'').trim())
    return enabled && !hardEasy
  })
  const seen = new Set(ca.rows.map(x=>x.name.trim().toLowerCase()))
  const merged = [...ca.rows.map(x=>({name:x.name, ai:x.always_inspection})),
    ...extras.filter(r=>{const k=r.name.trim().toLowerCase(); if(seen.has(k))return false; seen.add(k); return true}).map(r=>({name:r.name, ai:false}))]
  const auto = merged.filter(x=>!x.ai)
  const evIdx = auto.findIndex(x=>/ev charger/i.test(x.name))
  console.log(`${row.name} | trades=${trades.join(',')} | total=${merged.length} auto=${auto.length} | evIdx=${evIdx} ${evIdx>=40?'*** TRUNCATED ***':(evIdx<0?'(not enabled)':'ok')}`)
  if (evIdx>=35) console.log('   tail:', auto.slice(35,45).map(x=>x.name))
}
await c.end()
