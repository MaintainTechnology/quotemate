// POST /api/tenant/welcome-email — fire the one-time onboarding welcome email.
//
// The dashboard calls this once on load (fire-and-forget) after a tradie
// activates. All the single-send + retry logic lives in
// lib/onboard/welcome-email.ts; this route is the thin authenticated wrapper:
// it resolves the caller's tenant from their Supabase bearer token, then hands
// the row to sendWelcomeEmailOnce. The send is awaited within this request (it
// IS the request's whole job), so no next/server after() is needed.
//
// Auth pattern mirrors /api/tenant/me: client sends
// `Authorization: Bearer <supabase-access-token>`; the server validates it,
// then looks up that user's tenant. Service-role key is used for the data
// access (RLS is bypassed; the email send claim must be able to write the
// tenants row).

import { createClient } from '@supabase/supabase-js'
import { sendWelcomeEmailOnce } from '@/lib/onboard/welcome-email'
import { resolveTenantRequest } from '@/lib/tenant/from-request'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  // Dual-auth: Clerk session token (→ clerk_user_id) OR legacy Supabase token.
  const resolved = await resolveTenantRequest(
    supabase,
    req,
    'id, status, welcome_email_sent_at, owner_email, business_name, owner_first_name, twilio_sms_number, trades',
  )
  if (!resolved) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const tenant = resolved.tenant as Parameters<typeof sendWelcomeEmailOnce>[1] | null
  if (!tenant) {
    return Response.json({ ok: false, error: 'no_tenant' }, { status: 404 })
  }

  const outcome = await sendWelcomeEmailOnce(supabase, tenant)

  // Always 200 for a resolved tenant — "didn't send" (already sent / not
  // active yet) is a normal, expected outcome, not an error the client should
  // surface. The dashboard fires this fire-and-forget and ignores the body.
  const status = outcome.ok ? 200 : 502
  return Response.json(outcome, { status })
}
