// Faithful check of what the APP sees. Run with Next's dev precedence:
//   node --env-file=.env.local --env-file=.env.development.local scripts/diag-app-env.mjs
// (later --env-file wins, matching Next loading .env.development.local over .env.local)

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const ref = (url || '').match(/https:\/\/([^.]+)\./)?.[1]
console.log('effective NEXT_PUBLIC_SUPABASE_URL project ref:', ref)
console.log('SUPABASE_SERVICE_ROLE_KEY present:', !!key)

const supabase = createClient(url, key, { auth: { persistSession: false } })

// Exactly the route's select.
const { data, error } = await supabase
  .from('tenant_file_documents')
  .select('id, display_name, source_kind, trade, state, created_at, bytes')
  .order('created_at', { ascending: false })
  .limit(1)

console.log('\nroute select error:', error ? JSON.stringify(error) : 'none')
console.log('rows:', data?.length ?? 0)
