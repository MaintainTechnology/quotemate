// POST /api/tenant/password — let a signed-in tradie change their own
// login password from the dashboard Account tab.
//
// Auth pattern mirrors /api/tenant/me: the client sends
// `Authorization: Bearer <supabase-access-token>`; we validate it with the
// service-role client (auth.getUser) to resolve the user.
//
// Why a server route instead of a bare client `auth.updateUser({password})`:
// we require the CURRENT password before allowing a change — the UX tradies
// expect for a security action, and a guard against someone changing the
// password on a session left open on a shared device. We prove the current
// password by attempting a throwaway `signInWithPassword` on an anon client
// (persistSession:false so it leaves no session behind), then apply the new
// password with the admin API.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { passwordSchema } from '@/lib/auth/password'

export const dynamic = 'force-dynamic'

// Service-role client: validates the bearer token + performs the privileged
// password write. Never persists a session (it's a server identity).
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const BodySchema = z.object({
  current_password: z.string().min(1, 'Enter your current password.'),
  new_password: passwordSchema,
})

async function userFromBearer(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(req: Request) {
  const user = await userFromBearer(req)
  if (!user) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (!user.email) {
    // Password change requires an email to re-verify the current password
    // against. Every tradie account is created with an email, so this is a
    // defensive guard rather than an expected path.
    return Response.json(
      { ok: false, error: 'This account has no email on file — contact support.' },
      { status: 400 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid request.',
      },
      { status: 400 },
    )
  }

  const { current_password, new_password } = parsed.data

  if (current_password === new_password) {
    return Response.json(
      { ok: false, error: 'New password must be different from your current password.' },
      { status: 400 },
    )
  }

  // ─── 1. Prove the current password ──────────────────────────────
  // A fresh anon client that never persists — we only care whether the
  // sign-in succeeds, not the session it would mint.
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { error: signInErr } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  })
  if (signInErr) {
    return Response.json(
      { ok: false, error: 'Current password is incorrect.' },
      { status: 400 },
    )
  }

  // ─── 2. Apply the new password ──────────────────────────────────
  const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
    password: new_password,
  })
  if (updateErr) {
    return Response.json(
      { ok: false, error: updateErr.message || 'Could not update password.' },
      { status: 500 },
    )
  }

  return Response.json({ ok: true })
}
