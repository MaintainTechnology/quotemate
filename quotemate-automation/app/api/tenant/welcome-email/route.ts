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

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(
      'id, status, welcome_email_sent_at, owner_email, business_name, owner_first_name, twilio_sms_number, trades',
    )
    .eq('owner_user_id', user.id)
    .maybeSingle()

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
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
