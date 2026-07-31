// READ-ONLY probe. Reconstructs loadCandidatePrices() + buildCandidatePrices()
// + categorise() for tenant Sparky / trade=electrical and asks:
//   which candidates sit at $6.40 (+/- $0.50), and does ANY of them carry
//   the `sundry` tag that the line "Cable, terminals, clips" needs?
import pg from 'pg'

const T = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
const TRADE = 'electrical'
const TARGET = 6.4
const TOL = 0.5

// ── verbatim copy of categorise() from lib/estimate/validate.ts:122-194 ──
function categorise(text) {
  const t = (text ?? '').toLowerCase()
  const cats = new Set()
  if (/\b(outdoor|exterior|deck|weatherproof|ip[-\s]?rated|garden|patio|wall\s*pack|flood\s*light|floodlight)\b/.test(t)) cats.add('outdoor_light')
  if (/\bdownlight/.test(t)) cats.add('downlight')
  if (/\b(gpo|power\s*point|socket|wall\s*outlet|\busb\s*out)/.test(t)) cats.add('gpo')
  if (/\bsmoke\s*alarm|\binterconnect(?:ed)?\s+alarm|\b240v\s*alarm|\bhardwire[ds]?\b.*\balarm|\balarm\s+(?:install|replace|terminate|hardwire|kit)/.test(t)) cats.add('smoke_alarm')
  if (/\b(ceiling\s*fan|\bfan\b)/.test(t)) cats.add('fan')
  if (/\b(rcbo|safety\s*switch|safety\s*breaker|circuit\s*breaker)\b/.test(t)) cats.add('rcbo')
  if (/\b(oven|cooktop|stove|range\s*hood)\b/.test(t)) cats.add('oven_cooktop')
  if (/\b(ev\s*charger|electric\s*vehicle|wallbox)\b/.test(t)) cats.add('ev_charger')
  if (/\b(switchboard|switch\s*board|main\s*board|distribution\s*board)\b/.test(t)) cats.add('switchboard')
  if (/\b(fault[-\s]?find(?:ing)?|diagnostic|diagnose)\b/.test(t)) cats.add('fault_find')
  if (/\b(led\s*strip|strip\s*light(?:ing)?|cove\s*light(?:ing)?)\b/.test(t)) cats.add('strip_light')
  if (/\b(security\s*camera|surveillance\s*camera|cctv\s*camera)\b/.test(t)) cats.add('security_camera')
  if (/\b(doorbell|door\s*bell|intercom)\b/.test(t)) cats.add('doorbell_intercom')
  if (/\b(cctv|drain[-\s]?camera|camera\s*inspection)/.test(t)) cats.add('cctv')
  if (/\b(drain|blockage|blocked\s*pipe|jet[-\s]?blast(?:ing)?|hand[-\s]?rod(?:ding)?|jet[-\s]?clear)/.test(t)) cats.add('drain')
  if (/\b(hot\s*water|\bhws\b|heat\s*pump|continuous[-\s]?flow|storage\s*tank|water\s*heater)/.test(t)) cats.add('hot_water')
  if (/\b(tap[s]?\b|mixer|tap\s*washer|faucet|spout)/.test(t)) cats.add('tap')
  if (/\b(toilet|cistern|close[-\s]?coupled|wall[-\s]?faced|in[-\s]?wall\s*cistern|flush\s*valve|fill\s*valve)/.test(t)) cats.add('toilet')
  if (/\b(gas\s*(?:appliance|leak|fitting|cooktop|oven|line|supply|pipe|connection)|gas[-\s]?bayonet|\blpg\b)\b/.test(t)) cats.add('gas')
  if (/\b(pressure[-\s]?reduction\s*valve|\bprv\b|pressure\s*valve)/.test(t)) cats.add('prv')
  if (/\bdish\s*washer\b/.test(t)) cats.add('dishwasher')
  if (/\b(rain\s*water\s*tank|rainwater\s*tank)\b/.test(t)) cats.add('rainwater_tank')
  if (/\b(water\s*filter|filtration|whole[-\s]?house\s*(?:water\s*)?filter)\b/.test(t)) cats.add('water_filter')
  if (/\bleak\s*detect(?:ion|or)?\b/.test(t)) cats.add('leak_detection')
  if (/\b(shower\s*head|showerhead|shower\s*rose)\b/.test(t)) cats.add('shower')
  if (/\b(sundries|sundry|terminals|consumables|miscellaneous|extras|disposal|removal\s*of\s*old|fittings\s*and\s*seals|pipe\s*tape|plumbing\s*sundries|teflon|ptfe)\b/.test(t)) cats.add('sundry')
  if (cats.size === 0) cats.add('general')
  return cats
}

const MARKUPS = [0, 23, 28, 33] // default 28 +/- 5pp drift, plus raw
const money = (x) => +x.toFixed(2)

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const rows = []
const sm = await c.query('select id, name, category, default_unit_price_ex_gst from shared_materials where trade=$1', [TRADE])
for (const r of sm.rows) rows.push({ src: 'shared_materials', kind: 'material', name: r.name, category: r.category, price: Number(r.default_unit_price_ex_gst) })

const sa = await c.query('select id, name, category, default_unit_price_ex_gst from shared_assemblies where trade=$1', [TRADE])
for (const r of sa.rows) rows.push({ src: 'shared_assemblies', kind: 'assembly', name: r.name, category: r.category, price: Number(r.default_unit_price_ex_gst) })

const tca = await c.query('select id, name, category, default_unit_price_ex_gst from tenant_custom_assemblies where tenant_id=$1 and trade=$2 and always_inspection=false', [T, TRADE])
for (const r of tca.rows) rows.push({ src: 'tenant_custom_assemblies', kind: 'assembly', name: r.name, category: r.category, price: Number(r.default_unit_price_ex_gst) })

const tmc = await c.query('select id, name, category, unit_price_ex_gst, customer_supply_price_ex_gst from tenant_material_catalogue where tenant_id=$1 and trade=$2', [T, TRADE])
for (const r of tmc.rows) {
  rows.push({ src: 'tenant_material_catalogue', kind: 'material', name: r.name, category: r.category, price: Number(r.unit_price_ex_gst) })
  if (r.customer_supply_price_ex_gst != null) rows.push({ src: 'tenant_material_catalogue(cust-supply)', kind: 'material', name: r.name, category: r.category, price: Number(r.customer_supply_price_ex_gst) })
}
await c.end()

console.log(`candidate ROWS loaded: ${rows.length}`)

// Which rows anywhere in the whole candidate set carry `sundry`?
const sundryRows = rows.filter((r) => {
  const cats = categorise(r.name); if (r.category) cats.add(r.category)
  return cats.has('sundry')
})
console.log(`\n--- rows tagged [sundry] anywhere in the candidate set: ${sundryRows.length}`)
for (const r of sundryRows) console.log(`   ${r.src.padEnd(30)} $${r.price}  "${r.name}"  cats=[${[...categorise(r.name)].join(',')}]`)

// Every markup variant within +/-0.50 of $6.40
console.log(`\n--- candidates whose price is within $${TOL} of $${TARGET}:`)
let hits = 0
for (const r of rows) {
  if (!Number.isFinite(r.price) || r.price <= 0) continue
  for (const m of MARKUPS) {
    const p = money(r.price * (1 + m / 100))
    if (Math.abs(p - TARGET) > TOL) continue
    const cats = categorise(r.name); if (r.category) cats.add(r.category)
    hits++
    console.log(`   $${p.toFixed(2)}  = $${r.price} x ${m}%   ${r.src}  "${r.name}"  cats=[${[...cats].join(',')}]`)
  }
}
if (hits === 0) console.log('   (none)')

console.log(`\n--- line under test`)
const lineCats = categorise('Cable, terminals, clips')
console.log(`   "Cable, terminals, clips" -> [${[...lineCats].join(',')}]`)
console.log(`   any $6.40 candidate carrying 'sundry'? ${
  rows.some((r) => {
    if (!Number.isFinite(r.price) || r.price <= 0) return false
    const cats = categorise(r.name); if (r.category) cats.add(r.category)
    return cats.has('sundry') && MARKUPS.some((m) => Math.abs(money(r.price * (1 + m / 100)) - TARGET) <= TOL)
  }) ? 'YES' : 'NO'
}`)

// At what price COULD a [sundry] line ground?
console.log(`\n--- prices at which a [sundry] line COULD ground (whole candidate set):`)
const ok = new Set()
for (const r of sundryRows) for (const m of MARKUPS) ok.add(money(r.price * (1 + m / 100)))
console.log('   ', [...ok].sort((a, b) => a - b).join(', ') || '(none)')
