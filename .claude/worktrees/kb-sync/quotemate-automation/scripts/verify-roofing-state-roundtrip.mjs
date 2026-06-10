// Verify the app layer (supabase-js / PostgREST) can now read+write
// roofing_state — i.e. the schema-cache reload took effect. Uses a
// throwaway conversation row that is deleted at the end.
// Usage: node --env-file=.env.local scripts/verify-roofing-state-roundtrip.mjs

import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const probe = { slots: { address: 'ROUNDTRIP TEST', address_confirmed: true }, last_step: 'confirm_address' }

const { data: ins, error: insErr } = await sb
  .from('sms_conversations')
  .insert({ from_number: '+19990000001', to_number: '+19990000002', status: 'open' })
  .select('id')
  .single()

if (insErr) {
  console.log('INSERT failed:', insErr.message)
  process.exit(1)
}
const id = ins.id

const { error: upErr } = await sb
  .from('sms_conversations')
  .update({ roofing_state: probe })
  .eq('id', id)
console.log('UPDATE roofing_state error:', upErr ? `${upErr.code} ${upErr.message}` : 'NONE (success)')

const { data: read, error: readErr } = await sb
  .from('sms_conversations')
  .select('roofing_state')
  .eq('id', id)
  .single()
console.log('READ BACK error:', readErr ? readErr.message : 'none')
console.log('READ BACK roofing_state:', JSON.stringify(read?.roofing_state))

const roundTripOk =
  !upErr && !readErr && read?.roofing_state?.last_step === 'confirm_address'
console.log('\nROUND-TRIP OK:', roundTripOk)

await sb.from('sms_conversations').delete().eq('id', id)
console.log('cleaned up throwaway row', id)

process.exit(roundTripOk ? 0 : 2)
