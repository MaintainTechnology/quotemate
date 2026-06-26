// Service-role Supabase client factory for server routes. Bypasses RLS; routes
// enforce tenant isolation by filtering on tenant_id in app code (consistent
// with the rest of the codebase). Created per-call so a missing env at import
// time never crashes module load in test/build.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function getServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
