// POST /api/auth/signup — test-mode signup that bypasses email
// verification regardless of the Supabase dashboard "Confirm email"
// setting.
//
// How it works:
//   1. Validate payload via Zod
//   2. Use the service-role admin API (`auth.admin.createUser`) to
//      create the user with `email_confirm: true` so the email is
//      marked verified at the database level — no link required.
//   3. Stamp the same user_metadata the client-side signUp would
//      have stamped (business_name, first_name, intent_token,
//      owner_mobile) so the wizard + downstream flows still see them.
//   4. Return { ok: true, user_id } — the client then calls
//      supabase.auth.signInWithPassword to establish a local session
//      and navigates to the wizard.
//
// When email verification needs to come back (production), swap this
// route's body to use the regular signUp flow with emailRedirectTo,
// OR delete this route + revert /signup to client-side signUp.
//
// NOTE on duplicates: admin.createUser throws on existing email.
// We catch the unique-violation explicitly and return a friendly
// "An account with that email already exists" message.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { passwordSchema } from '@/lib/auth/password'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      // Admin client never needs to persist sessions or refresh tokens
      // — it acts as a server identity, not a logged-in user.
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

const SignupSchema = z.object({
  email: z.string().trim().email().max(120).transform((s) => s.toLowerCase()),
  password: passwordSchema,
  business_name: z.string().trim().min(2).max(80),
  owner_first_name: z.string().trim().min(1).max(40),
  // E.164 already-normalised on the client; allow optional in case the
  // SMS path provides it from the intent token.
  owner_mobile: z.string().trim().min(8).max(20).optional().or(z.literal('')),
  intent_token: z.string().trim().min(4).max(16).optional().or(z.literal('')),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = SignupSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: 'validation_failed',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  const { email, password, business_name, owner_first_name, owner_mobile, intent_token } =
    parsed.data

  // ─── Create the user with email pre-confirmed ──────────────────
  // email_confirm: true tells Supabase to mark email_confirmed_at as
  // NOW() at row creation. The user can sign in immediately. The
  // dashboard's "Confirm email" toggle becomes irrelevant for this
  // flow — even if it's ON, the admin override pre-confirms.
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      business_name,
      first_name: owner_first_name,
      intent_token: intent_token || null,
      owner_mobile: owner_mobile || null,
    },
  })

  if (error) {
    // Friendly handling for the common duplicate-email case. Supabase's
    // error message varies by version; check both code and substring.
    const msg = error.message ?? ''
    const code = (error as { code?: string }).code
    const isDuplicate =
      code === 'email_exists' ||
      msg.toLowerCase().includes('already been registered') ||
      msg.toLowerCase().includes('already registered') ||
      msg.toLowerCase().includes('user already')
    if (isDuplicate) {
      return Response.json(
        {
          ok: false,
          error: 'An account with that email already exists. Sign in instead.',
          duplicate: true,
        },
        { status: 409 },
      )
    }
    return Response.json(
      { ok: false, error: msg || 'Signup failed' },
      { status: 500 },
    )
  }

  if (!data.user) {
    return Response.json(
      { ok: false, error: 'Signup succeeded but no user returned' },
      { status: 500 },
    )
  }

  return Response.json({
    ok: true,
    user_id: data.user.id,
    email: data.user.email,
  })
}
