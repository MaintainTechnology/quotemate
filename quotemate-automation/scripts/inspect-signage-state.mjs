// READ-ONLY inspection of the live signage state. No writes.
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(url, key, { auth: { persistSession: false } })

function line() { console.log('─'.repeat(72)) }

// brands
const { data: brands, error: bErr } = await supabase
  .from('brands')
  .select('slug, name, active, kb_store_ids, shots')
console.log('BRANDS', bErr ? bErr.message : '')
for (const b of brands ?? []) {
  const shotCount = Array.isArray(b.shots) ? b.shots.length : 0
  console.log(`  ${b.slug.padEnd(18)} ${b.name.padEnd(20)} active=${b.active} shots=${shotCount} stores=${JSON.stringify(b.kb_store_ids)}`)
}
line()

// orgs
const { data: orgs } = await supabase
  .from('orgs')
  .select('id, name, brand_slug, owner_user_id, owner_email, created_at')
  .order('created_at')
console.log('ORGS')
for (const o of orgs ?? []) {
  console.log(`  ${o.id}  brand=${(o.brand_slug||'').padEnd(16)} owner_user=${o.owner_user_id ? 'SET' : 'null'} email=${o.owner_email ?? ''}  "${o.name}"`)
}
line()

// studios per org
const { data: studios } = await supabase
  .from('studios')
  .select('id, org_id, name, region, state, postcode, address, status, lat, lng, created_at')
  .order('created_at')
console.log(`STUDIOS (${(studios ?? []).length})`)
for (const s of studios ?? []) {
  console.log(`  org=${s.org_id.slice(0,8)} region=${String(s.region).padEnd(8)} state=${String(s.state).padEnd(6)} status=${String(s.status).padEnd(7)} "${s.name}"  addr=${s.address ? 'Y' : 'n'} geo=${s.lat!=null?'Y':'n'}`)
}
line()

// sweeps
const { data: sweeps } = await supabase
  .from('signage_sweeps')
  .select('id, org_id, name, required_shots, studio_filter, status, created_at')
  .order('created_at')
console.log(`SWEEPS (${(sweeps ?? []).length})`)
for (const s of sweeps ?? []) {
  console.log(`  org=${s.org_id.slice(0,8)} filter=${JSON.stringify(s.studio_filter)} shots=${(s.required_shots||[]).length} "${s.name}"`)
}
line()

// requests count per sweep
const { data: reqs } = await supabase
  .from('signage_requests')
  .select('id, sweep_id, org_id, studio_id, state')
const bySweep = {}
for (const r of reqs ?? []) bySweep[r.sweep_id] = (bySweep[r.sweep_id] || 0) + 1
console.log(`REQUESTS (${(reqs ?? []).length}) per sweep:`, JSON.stringify(bySweep))
line()

// rules per brand
const { data: rules } = await supabase
  .from('signage_rules')
  .select('brand_slug, active')
const byBrand = {}
for (const r of rules ?? []) {
  byBrand[r.brand_slug] = byBrand[r.brand_slug] || { active: 0, total: 0 }
  byBrand[r.brand_slug].total++
  if (r.active) byBrand[r.brand_slug].active++
}
console.log('SIGNAGE_RULES per brand:', JSON.stringify(byBrand))
line()

// auth users (to map owner emails)
const { data: au } = await supabase.auth.admin.listUsers()
console.log('AUTH USERS:')
for (const u of (au?.users ?? [])) console.log(`  ${u.id.slice(0,8)}  ${u.email}`)
