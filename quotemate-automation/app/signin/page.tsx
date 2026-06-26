// /signin — Maintain design system. Returning-tradie login.
//
// Why the Suspense boundary: `useSearchParams()` forces a CSR bailout
// during prerender (Next 16, see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md
// §Prerendering — production builds fail with
// "missing-suspense-with-csr-bailout" otherwise). We wrap ONLY the inner
// SignInForm (the bit that needs `redirectTo`) so the AuthShell, title,
// subtitle, and footer can still be statically prerendered.

'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { AuthShell, Field, INPUT, ErrorBanner, Arrow } from '../signup/page'

function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?redirectTo= lets deep-links (e.g. the "Sign in to edit" CTA on a
  // held quote's /q/<token>?edit=1 page) round-trip the user back to
  // where they came from after auth. Whitelist same-origin paths only
  // — never honour a fully-qualified URL or a protocol-relative one,
  // both of which would be open-redirect vectors.
  const redirectTo = (() => {
    const raw = searchParams?.get('redirectTo')
    if (!raw) return null
    if (!raw.startsWith('/') || raw.startsWith('//')) return null
    return raw
  })()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const supabase = getBrowserSupabase()
      const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (authErr) throw authErr
      if (!authData.user || !authData.session) throw new Error('Sign in returned no user')

      // Look up the tenant via the server-side endpoint so the read uses
      // the service role (same as the dashboard). A browser-side
      // `from('tenants').select()` here returns silently-empty when RLS is
      // enabled on the table — the symptom is that a returning tradie
      // who finished onboarding still gets bounced to /onboard.
      const meRes = await fetch('/api/tenant/me', {
        headers: { Authorization: `Bearer ${authData.session.access_token}` },
        cache: 'no-store',
      })

      // Routing rules:
      //   • 404 (no tenant row yet) → start onboarding wizard.
      //   • Tenant exists           → dashboard, regardless of status.
      //
      // We deliberately do NOT route status='onboarding' back to the
      // wizard. A tenant in that state means activation persisted the
      // form data but provisioning (Twilio/Vapi) failed mid-chain. The
      // tradie should NOT be asked to refill the wizard — their data is
      // safe in the DB. The dashboard surfaces a "retry provisioning"
      // affordance for stuck tenants.
      if (meRes.status === 404) {
        router.push(`/onboard?owner_user_id=${authData.user.id}`)
        return
      }
      if (!meRes.ok) {
        const body = await meRes.json().catch(() => ({}))
        throw new Error(body?.error ?? `Tenant lookup failed (HTTP ${meRes.status})`)
      }
      // Honour redirectTo for deep-link round-trips (e.g. the "Edit
      // first" SMS → /q/<token>?edit=1 → sign in → back to the editor).
      router.push(redirectTo ?? '/dashboard')
    } catch (err: any) {
      setError(err?.message ?? 'Sign in failed')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Field label="Email">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@business.com.au"
          className={INPUT}
          required
          autoComplete="email"
        />
      </Field>

      <Field label="Password">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
          required
          autoComplete="current-password"
        />
      </Field>

      <div className="-mt-1 text-right">
        <Link
          href="/forgot-password"
          className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim hover:text-accent transition-colors"
        >
          Forgot password?
        </Link>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
        {!submitting && <Arrow />}
      </button>
    </form>
  )
}

// Static skeleton shown while the form's CSR bundle hydrates. Same
// visual footprint as the real form so the layout doesn't shift.
function SignInFormSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-[3.25rem] border border-ink-line bg-ink-deep/40" />
      <div className="h-[3.25rem] border border-ink-line bg-ink-deep/40" />
      <div className="h-[3.25rem] bg-accent/40" />
    </div>
  )
}

export default function SignInPage() {
  return (
    <AuthShell
      title={<>Welcome <span className="text-accent">back</span></>}
      subtitle="Sign in to manage your pricing, view quotes, and check on your AI receptionist."
      footer={
        <>
          New here?{' '}
          <Link href="/signup" className="text-accent hover:text-accent-press font-semibold">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={<SignInFormSkeleton />}>
        <SignInForm />
      </Suspense>
    </AuthShell>
  )
}
