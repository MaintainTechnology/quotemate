// /auth/callback — handles the redirect after a user clicks the email
// verification link Supabase sends on sign up.
//
// Supabase has THREE email-link shapes in the wild and this callback
// MUST handle all three so the tradie is auto-signed-in and routed to
// the wizard regardless of which one their project uses:
//
//   (A) PKCE flow (modern, our default — set in lib/supabase/client.ts):
//       link → ?code=<short-lived auth code>
//       → exchangeCodeForSession(code) swaps it for a real session
//
//   (B) OTP token-hash flow (Supabase email template default for projects
//       that haven't been migrated):
//       link → ?token_hash=<hash>&type=signup
//       → verifyOtp({ token_hash, type }) creates the session
//
//   (C) Legacy implicit/hash-fragment flow (older Supabase versions):
//       link → #access_token=<jwt>&refresh_token=<jwt>
//       → detectSessionInUrl picks this up automatically on client init
//
// After ANY of these succeeds, the tradie's session is live and the
// existing carry-over routing (intent + mobile + business_name) takes
// them to the right place in the wizard.

'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'

// Next.js 16 disallows prerendering pages whose default export reads
// useSearchParams() without a Suspense boundary. The callback page MUST
// run client-side (it inspects the URL fragment Supabase appended), so
// the inner component is split out and wrapped here.
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackFallback />}>
      <AuthCallbackInner />
    </Suspense>
  )
}

function CallbackFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <Spinner />
        <h1 className="mt-6 font-extrabold uppercase text-2xl tracking-[-0.02em]">
          Verifying your email…
        </h1>
      </div>
    </main>
  )
}

function AuthCallbackInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [status, setStatus] = useState<'verifying' | 'ok' | 'error'>('verifying')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = getBrowserSupabase()
      try {
        // ─── 1. PKCE flow — exchange the `?code=` for a real session ─────
        // This is our default since lib/supabase/client.ts sets
        // flowType: 'pkce'. The code is single-use and short-lived;
        // exchanging it sets the access/refresh tokens in storage.
        const code = params.get('code')
        if (code) {
          const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code)
          if (exchErr) throw exchErr
        }

        // ─── 2. OTP token-hash flow — verify the hashed token ────────────
        // Older Supabase email-confirmation template default. Even if the
        // project flips to PKCE, an unmigrated email template will still
        // send these — handle both so we never strand the tradie.
        const tokenHash = params.get('token_hash')
        const otpType = params.get('type') // 'signup' | 'recovery' | 'invite' | ...
        if (!code && tokenHash && otpType) {
          const { error: otpErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType as
              | 'signup'
              | 'email'
              | 'recovery'
              | 'invite'
              | 'email_change',
          })
          if (otpErr) throw otpErr
        }

        // ─── 3. Hash fragment flow — handled implicitly by the client ────
        // If the link came back as #access_token=...&refresh_token=...
        // (older deployments), detectSessionInUrl: true on the browser
        // client picks it up during createClient(). Wait briefly so the
        // listener has time to settle before we read the session.
        if (!code && !tokenHash) {
          await new Promise((r) => setTimeout(r, 120))
        }

        // ─── 4. Sanity-check that one of the above produced a session ────
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (cancelled) return

        if (!data.session) {
          // One last retry — covers a slow hash-fragment parse on iOS Mail.
          await new Promise((r) => setTimeout(r, 250))
          const second = await supabase.auth.getSession()
          if (!second.data.session) {
            setStatus('error')
            setError('We couldn’t pick up your sign-in session. Try signing in directly.')
            return
          }
        }

        // ─── 5. Pull the user + decide where to send them next ───────────
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setStatus('error')
          setError('Verified but no user attached — sign in to continue.')
          return
        }

        // ─── 6. If a tenant already exists for this user, branch ─────────
        const { data: tenant } = await supabase
          .from('tenants')
          .select('id, status, business_name')
          .eq('owner_user_id', user.id)
          .maybeSingle()

        // Pull any carry-over fields the signup pre-stuffed into params
        // (business_name, first_name) — Supabase also stashes these on
        // user.user_metadata since we passed them as `options.data`.
        // SMS-initiated signups also carry an `intent` token and the
        // pre-resolved owner_mobile through this same callback.
        const meta = user.user_metadata ?? {}
        const next = new URLSearchParams({
          business_name: String(params.get('business_name') ?? meta.business_name ?? ''),
          owner_first_name: String(params.get('owner_first_name') ?? meta.first_name ?? ''),
          owner_email: user.email ?? '',
          owner_user_id: user.id,
        })
        const intent = params.get('intent') ?? meta.intent_token ?? null
        if (intent) next.set('intent', String(intent))
        const ownerMobile = params.get('owner_mobile') ?? meta.owner_mobile ?? null
        if (ownerMobile) next.set('owner_mobile', String(ownerMobile))

        setStatus('ok')

        if (tenant && tenant.status === 'active') {
          // Already onboarded — straight home.
          router.replace(`/?welcome=${encodeURIComponent(tenant.business_name)}`)
        } else if (tenant) {
          // Tenant row exists but not active — back to wizard to finish.
          router.replace(`/onboard?tenant=${tenant.id}`)
        } else {
          // Fresh user — continue the wizard from step 2.
          router.replace(`/onboard?${next.toString()}`)
        }
      } catch (e: any) {
        if (cancelled) return
        setStatus('error')
        setError(e?.message ?? 'Verification failed')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        {status === 'verifying' && (
          <>
            <Spinner />
            <h1 className="mt-6 font-extrabold uppercase text-2xl tracking-[-0.02em]">
              Verifying your email…
            </h1>
            <p className="mt-3 text-text-sec text-sm">
              One moment. We&rsquo;re finishing your sign-in and routing you to the wizard.
            </p>
          </>
        )}
        {status === 'ok' && (
          <>
            <h1 className="font-extrabold uppercase text-2xl tracking-[-0.02em]">
              <span className="text-accent">Verified.</span> Taking you to the wizard…
            </h1>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="font-extrabold uppercase text-2xl tracking-[-0.02em]">
              <span className="text-accent">Hmm.</span> Something went sideways.
            </h1>
            {error && (
              <p className="mt-4 text-text-sec text-sm">{error}</p>
            )}
            <div className="mt-8 flex items-center justify-center gap-3">
              <Link
                href="/signin"
                className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-sm uppercase tracking-wider transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 border border-ink-line bg-transparent hover:bg-ink-card text-text-pri font-semibold px-6 py-3 text-sm uppercase tracking-wider transition-colors"
              >
                Try again
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function Spinner() {
  return (
    <div
      className="inline-block h-8 w-8 border-2 border-ink-line border-t-accent animate-spin"
      aria-label="Loading"
      role="status"
    />
  )
}
