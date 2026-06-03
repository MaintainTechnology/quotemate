// QuoteMate · seed a demo signage-compliance org + studios so the
// /dashboard/signage surface has data to drive.
//
// The org is created with owner_email only; on the first signed-in load
// the signage API self-heals owner_user_id by matching the email (same
// pattern as tenant/me). So sign in with this email to "own" the demo org.
//
// Usage:
//   node --env-file=.env.local scripts/seed-signage-demo.mjs you@example.com
//   SIGNAGE_DEMO_EMAIL=you@example.com node --env-file=.env.local scripts/seed-signage-demo.mjs

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const email = (process.argv[2] || process.env.SIGNAGE_DEMO_EMAIL || '').trim().toLowerCase()
if (!email) {
  console.error('Provide the HQ owner email: scripts/seed-signage-demo.mjs you@example.com')
  process.exit(1)
}

const ORG_NAME = 'F45 Global (demo)'
const STUDIOS = [
  { name: 'F45 Bondi', region: 'AU-NSW', contact_phone: '+61400000001' },
  { name: 'F45 Surry Hills', region: 'AU-NSW', contact_phone: '+61400000002' },
  { name: 'F45 South Yarra', region: 'AU-VIC', contact_phone: '+61400000003' },
  { name: 'F45 Fortitude Valley', region: 'AU-QLD', contact_phone: '+61400000004' },
  { name: 'F45 Austin Downtown', region: 'US-TX', contact_phone: '+15120000005' },
]

const supabase = createClient(url, key, { auth: { persistSession: false } })

// Org — idempotent by name.
let { data: org } = await supabase.from('orgs').select('id').eq('name', ORG_NAME).maybeSingle()
if (!org) {
  const { data, error } = await supabase
    .from('orgs')
    .insert({ name: ORG_NAME, brand_slug: 'f45', owner_email: email })
    .select('id')
    .single()
  if (error) {
    console.error('org insert failed:', error.message)
    process.exit(1)
  }
  org = data
  console.log(`Created org ${ORG_NAME} (${org.id}) owned by ${email}`)
} else {
  await supabase.from('orgs').update({ owner_email: email }).eq('id', org.id)
  console.log(`Org ${ORG_NAME} exists (${org.id}); owner_email set to ${email}`)
}

// Studios — idempotent by (org_id, name).
const { data: existing } = await supabase
  .from('studios')
  .select('name')
  .eq('org_id', org.id)
const have = new Set((existing ?? []).map((s) => s.name))
const toAdd = STUDIOS.filter((s) => !have.has(s.name)).map((s) => ({ ...s, org_id: org.id, status: 'open' }))

if (toAdd.length > 0) {
  const { error } = await supabase.from('studios').insert(toAdd)
  if (error) {
    console.error('studios insert failed:', error.message)
    process.exit(1)
  }
}
console.log(`Studios: ${have.size} existing + ${toAdd.length} added = ${have.size + toAdd.length} total.`)
console.log('\nNext: sign in as', email, 'and open /dashboard/signage')
