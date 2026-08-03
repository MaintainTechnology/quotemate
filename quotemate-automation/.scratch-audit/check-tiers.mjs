// Three different prices on the no-catalogue plumbing quote?
//   node --env-file=.env.local .scratch-audit/check-tiers.mjs
import pg from 'pg'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const INTAKE = process.argv[2] || '39961333-e1b2-4388-9867-14a4efb39d54'

console.log('=== quotes columns ===')
console.log((await c.query(
  `select column_name from information_schema.columns where table_name='quotes' order by ordinal_position`
)).rows.map(r => r.column_name).join(', '))

const { rows } = await c.query(
  `select * from quotes where intake_id=$1 order by created_at desc limit 1`, [INTAKE])

if (!rows[0]) {
  console.log(`\nNo quote row for intake ${INTAKE}`)
  console.log('\n=== most recent quotes overall ===')
  console.log(JSON.stringify((await c.query(
    `select id, intake_id, created_at from quotes order by created_at desc limit 5`)).rows, null, 2))
} else {
  const q = rows[0]
  console.log(`\n=== quote ${q.id} (intake ${INTAKE}) ===`)
  for (const [k, v] of Object.entries(q)) {
    if (['good', 'better', 'best'].includes(k)) continue
    if (v == null || typeof v === 'object') continue
    console.log(`  ${k} = ${String(v).slice(0, 90)}`)
  }
  const money = (t) => {
    if (!t) return { label: 'NULL (tier nulled)', val: null }
    for (const k of ['subtotal_ex_gst', 'total_inc_gst', 'total', 'price_inc_gst', 'price', 'amount', 'subtotal'])
      if (t[k] != null) return { label: `${t.label ?? ''} ${k} = ${t[k]} (inc GST ${(Number(t[k]) * 1.1).toFixed(2)})`, val: Number(t[k]) }
    return { label: 'no total field; keys: ' + Object.keys(t).join(','), val: null }
  }
  const tiers = { good: money(q.good), better: money(q.better), best: money(q.best) }
  console.log('\n  TIERS')
  for (const [name, m] of Object.entries(tiers)) console.log(`    ${name.padEnd(7)} ${m.label}`)
  const vals = Object.values(tiers).map(m => m.val).filter(v => v != null && !Number.isNaN(v))
  const distinct = new Set(vals).size
  console.log(`\n  ==> ${distinct} distinct price(s) across ${vals.length} priced tier(s)`)
  console.log(distinct === 3 ? '  ==> PASS: three different prices' : '  ==> FAIL: not three different prices')
  for (const name of ['good', 'better', 'best']) {
    const t = q[name]
    if (t && Array.isArray(t.line_items)) console.log(`  ${name}: ${t.line_items.length} line item(s)`)
  }
}

console.log('\n=== the SMS the customer actually received (last 4 outbound) ===')
for (const m of (await c.query(
  `select left(body,260) body, created_at from sms_messages
   where direction='outbound' and created_at > now() - interval '40 minutes'
   order by created_at desc limit 4`)).rows)
  console.log(`  [${m.created_at.toISOString()}] ${m.body.replace(/\s+/g, ' ')}`)

console.log('\n=== estimate traces for this intake ===')
for (const t of (await c.query(
  `select step, substep, status, left(coalesce(message,''),160) message
   from pipeline_traces where intake_id=$1 order by created_at asc`, [INTAKE])).rows)
  console.log(`  ${t.step}/${t.substep ?? '-'} [${t.status}] ${t.message}`)

await c.end()
