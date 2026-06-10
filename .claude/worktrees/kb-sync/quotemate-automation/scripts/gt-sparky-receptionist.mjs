// READ-ONLY ground-truth dump for testing the Sparky SMS receptionist.
// Resolves the tenant that owns the agent number, then prints its pricing
// book, offered services (joined to the catalogue), the electrical material
// catalogue, brand preferences, and any deterministic-BOM recipes.
// Usage: node --env-file=.env.local scripts/gt-sparky-receptionist.mjs

import pg from 'pg'
const AGENT_NUMBER = '+61481613464'

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const line = (s = '') => console.log(s)
const hr = (t) => { line('\n' + '═'.repeat(80)); line(t); line('═'.repeat(80)) }

try {
  // 1. Which tenant owns the agent number?
  hr(`1. TENANT routing — who owns ${AGENT_NUMBER} (SMS) ?`)
  const { rows: byNum } = await c.query(
    `select id, business_name, trade, trades, status, twilio_sms_number, twilio_voice_number, vapi_assistant_id
       from tenants where twilio_sms_number = $1`, [AGENT_NUMBER])
  if (byNum.length === 0) line(`  ⚠ NO tenant has twilio_sms_number = ${AGENT_NUMBER}`)
  for (const t of byNum) line(`  ${t.business_name} | id=${t.id} | trade=${t.trade} | trades=${JSON.stringify(t.trades)} | status=${t.status}`)

  // 2. All active tenants (so we can see Sparky + numbers)
  hr('2. ALL active tenants')
  const { rows: tenants } = await c.query(
    `select id, business_name, trade, trades, status, twilio_sms_number, twilio_voice_number
       from tenants where status = 'active' order by business_name`)
  for (const t of tenants) line(`  ${(t.business_name||'').padEnd(24)} | ${String(t.trade).padEnd(11)} | trades=${JSON.stringify(t.trades)} | sms=${t.twilio_sms_number ?? '(none)'} | voice=${t.twilio_voice_number ?? '(none)'} | id=${t.id}`)

  // Pick the tenant under test = owner of the agent number (fallback: name ilike sparky)
  let tenant = byNum[0]
  if (!tenant) {
    const { rows } = await c.query(`select * from tenants where business_name ilike '%sparky%' and status='active' limit 1`)
    tenant = rows[0]
    line(`\n  (no number match — falling back to name match: ${tenant?.business_name})`)
  }
  if (!tenant) { line('NO tenant under test — aborting'); process.exit(0) }
  const TID = tenant.id

  hr(`TENANT UNDER TEST: ${tenant.business_name}  (id=${TID})`)

  // 3. pricing_book
  hr('3. PRICING BOOK (rate card)')
  const { rows: pb } = await c.query(`select * from pricing_book where tenant_id = $1`, [TID])
  for (const r of pb) {
    line(`  trade=${r.trade}`)
    for (const [k, v] of Object.entries(r)) {
      if (['id','tenant_id','created_at','updated_at'].includes(k)) continue
      const s = v === null ? '(null)' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      line(`    ${k.padEnd(26)} ${s}`)
    }
  }

  // 4. Offered services joined to catalogue (electrical only — trade under test)
  hr('4. OFFERED ELECTRICAL SERVICES (tenant_service_offerings ⋈ shared_assemblies)')
  const { rows: svc } = await c.query(
    `select tso.enabled, sa.id as assembly_id, sa.name, sa.trade, sa.category,
            sa.default_unit, sa.default_unit_price_ex_gst, sa.default_labour_hours,
            sa.always_inspection, sa.clarifying_questions, sa.inspection_triggers,
            sa.price_recipe, sa.retired_at
       from tenant_service_offerings tso
       join shared_assemblies sa on sa.id = tso.assembly_id
      where tso.tenant_id = $1 and sa.trade = 'electrical'
      order by sa.category, sa.name`, [TID])
  line(`  ${svc.length} electrical offerings:\n`)
  for (const s of svc) {
    const price = s.default_unit_price_ex_gst != null ? `$${s.default_unit_price_ex_gst}/${s.default_unit ?? 'ea'} ex` : '(no base price)'
    line(`  [${s.enabled ? 'ON ' : 'off'}] ${String(s.name).padEnd(46)} ${price.padEnd(16)} hrs=${String(s.default_labour_hours ?? '?').padEnd(4)} cat=${(s.category ?? '?').padEnd(14)}${s.always_inspection ? ' ⛔ALWAYS-INSPECTION' : ''}${s.retired_at ? ' (RETIRED)' : ''}${s.price_recipe ? ' 📐recipe' : ''}`)
  }

  // 5. Clarifying questions + inspection triggers per enabled service
  hr('5. CLARIFYING QUESTIONS + INSPECTION TRIGGERS per enabled service')
  for (const s of svc.filter(x => x.enabled)) {
    const q = s.clarifying_questions
    const hasQ = q && (Array.isArray(q) ? q.length : Object.keys(q).length)
    const trig = s.inspection_triggers
    const hasT = Array.isArray(trig) && trig.length
    if (hasQ || hasT || s.always_inspection) {
      line(`  • ${s.name}${s.always_inspection ? '  ⛔ALWAYS-INSPECTION' : ''}`)
      if (hasQ) line(`      ask:     ${JSON.stringify(q)}`)
      if (hasT) line(`      inspect: ${JSON.stringify(trig)}`)
    }
  }

  // 6. Electrical material catalogue (shared_materials)
  hr('6. SHARED MATERIALS — electrical catalogue (brand/price ground truth)')
  const { rows: mats } = await c.query(
    `select category, name, brand, unit, default_unit_price_ex_gst as price, properties
       from shared_materials where trade = 'electrical' order by category, name`)
  let cat = ''
  for (const m of mats) {
    if (m.category !== cat) { cat = m.category; line(`\n  ── ${cat} ──`) }
    line(`    ${String(m.name).padEnd(42)} ${String(m.brand??'—').padEnd(14)} $${m.price}/${m.unit ?? 'ea'}`)
  }

  // 7. Brand preferences
  hr('7. TENANT MATERIAL PREFERENCES (brand hints)')
  const { rows: prefs } = await c.query(`select * from tenant_material_preferences where tenant_id = $1`, [TID])
  if (!prefs.length) line('  (none)')
  for (const p of prefs) line(`  ${JSON.stringify(p)}`)

  // 8. Deterministic-BOM recipes for this tenant (tier-pinned materials)
  hr('8. DETERMINISTIC-BOM recipes (tenant_material_catalogue)')
  try {
    const { rows: cats } = await c.query(
      `select trade, category, name, brand, range_series, tier_hint, unit, unit_price_ex_gst, is_preferred, active
         from tenant_material_catalogue where tenant_id = $1 and trade='electrical'
         order by category, tier_hint, name limit 200`, [TID])
    line(`  ${cats.length} electrical rows`)
    let cc = ''
    for (const r of cats) {
      if (r.category !== cc) { cc = r.category; line(`\n  ── ${cc} ──`) }
      line(`    [${r.tier_hint ?? '—'}] ${String(r.name).padEnd(38)} ${String(r.brand??'—').padEnd(14)} $${r.unit_price_ex_gst}/${r.unit ?? 'ea'}${r.is_preferred ? ' ★preferred' : ''}${r.active === false ? ' (inactive)' : ''}`)
    }
  } catch (e) { line(`  (table missing or error: ${e.message})`) }

} catch (e) {
  console.error('FAILED:', e.message ?? e)
  process.exit(1)
} finally {
  await c.end()
}
