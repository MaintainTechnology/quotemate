// Sparky offerings + materials for BOTH electrical and plumbing (ground truth).
import pg from 'pg'
const SPARKY = '6dca084c-10d5-4459-b48f-9b45e4bbc68a'
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()
const L = (s = '') => console.log(s)

for (const trade of ['electrical', 'plumbing']) {
  L(`\n${'='.repeat(82)}\n${trade.toUpperCase()} — OFFERED SERVICES (enabled only)\n${'='.repeat(82)}`)
  const { rows: svc } = await c.query(
    `select tso.enabled, sa.name, sa.category, sa.default_unit, sa.default_unit_price_ex_gst p,
            sa.default_labour_hours h, sa.always_inspection, sa.clarifying_questions cq, sa.inspection_triggers it
       from tenant_service_offerings tso join shared_assemblies sa on sa.id = tso.assembly_id
      where tso.tenant_id=$1 and sa.trade=$2 and tso.enabled=true and sa.retired_at is null
      order by sa.category, sa.name`, [SPARKY, trade])
  for (const s of svc) {
    L(`  ${String(s.name).padEnd(46)} $${s.p}/${s.default_unit} hrs=${s.h} cat=${s.category}${s.always_inspection ? ' ⛔INSPECTION' : ''}`)
    if (Array.isArray(s.it) && s.it.length) L(`      inspect-if: ${JSON.stringify(s.it)}`)
  }
  L(`  (${svc.length} enabled ${trade} services)`)

  L(`\n${trade.toUpperCase()} — MATERIAL CATALOGUE (deterministic-BOM recipes, tenant_material_catalogue)`)
  const { rows: cat } = await c.query(
    `select category, name, brand, tier_hint, unit_price_ex_gst p from tenant_material_catalogue
       where tenant_id=$1 and trade=$2 and active=true order by category, tier_hint, name`, [SPARKY, trade])
  let cc = ''
  for (const r of cat) { if (r.category!==cc){cc=r.category;L(`   ── ${cc} ──`)} L(`     [${r.tier_hint??'—'}] ${String(r.name).padEnd(38)} ${String(r.brand??'—').padEnd(12)} $${r.p}`) }
  if (!cat.length) L('   (no tenant recipes — uses shared_materials + LLM pick)')

  L(`\n${trade.toUpperCase()} — SHARED MATERIALS (catalogue fallback)`)
  const { rows: sm } = await c.query(
    `select category, name, brand, default_unit_price_ex_gst p from shared_materials where trade=$1 order by category, name`, [trade])
  cc=''
  for (const r of sm) { if (r.category!==cc){cc=r.category;L(`   ── ${cc} ──`)} L(`     ${String(r.name).padEnd(42)} ${String(r.brand??'—').padEnd(12)} $${r.p}`) }
}
await c.end()
