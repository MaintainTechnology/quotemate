// /signup — Maintain design system. Step 1 of 4 of the onboarding funnel.

'use client'

import { Suspense, useState, useEffect, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { normaliseAuMobile } from '@/lib/onboard/schema'

// Next.js 16 disallows prerendering pages whose default export reads
// useSearchParams() without a Suspense boundary. The signup page reads
// ?intent=<token> to prefill mobile via the SMS magic-link flow — the
// inner component owns that logic; this wrapper provides the boundary.
export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpInner />
    </Suspense>
  )
}

function SignUpInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [businessName, setBusinessName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // SMS intent token state: if ?intent=<token> is present, fetch the
  // mobile from the API to display in the "we've got your mobile" banner.
  const intentToken = params.get('intent') ?? null
  const [intentMobile, setIntentMobile] = useState<string | null>(null)
  const [intentError, setIntentError] = useState<string | null>(null)

  // When SMS-initiated, the intent-resolved mobile auto-populates the
  // mobile field AND locks it (read-only). The tradie already proved
  // possession of the device by texting us — no OTP needed.
  useEffect(() => {
    if (intentMobile) setMobile(intentMobile)
  }, [intentMobile])

  // Path selector — SMS-initiated tradies skip the OTP step because the
  // mobile was already verified by physical possession of the device
  // that sent the inbound SMS. Web-initiated tradies enter their mobile
  // here and verify it via a 6-digit code on /signup/verify.
  const mobileLocked = !!(intentToken && intentMobile)
  const needsOtpVerification = !mobileLocked

  useEffect(() => {
    if (!intentToken) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/onboard/intent/${encodeURIComponent(intentToken)}`)
        if (cancelled) return
        if (!res.ok) {
          setIntentError(
            res.status === 404
              ? "That signup link expired or was already used. You can sign up below as usual."
              : 'Could not load your SMS signup details. Continue below.',
          )
          return
        }
        const json = await res.json()
        setIntentMobile(json.intent?.owner_mobile ?? null)
      } catch {
        if (!cancelled) setIntentError('Could not load your SMS signup details. Continue below.')
      }
    })()
    return () => { cancelled = true }
  }, [intentToken])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const supabase = getBrowserSupabase()
      const cleanEmail = email.trim().toLowerCase()

      // Normalise mobile to E.164 (+614xxxxxxxx) — Supabase Auth + Twilio
      // both require this exact shape. Throws on invalid AU mobile.
      let mobileE164: string
      try {
        mobileE164 = normaliseAuMobile(mobile)
      } catch {
        setError('Enter a valid Australian mobile (04xx xxx xxx)')
        setSubmitting(false)
        return
      }

      // ─── Path A: SMS-initiated (mobile already verified) ──────────
      // The tradie texted us first, proving they own this mobile. Skip
      // OTP — sign them up with email + password, mobile saved as
      // metadata + passed straight to the wizard.
      if (mobileLocked) {
        // Carry-over fields the wizard expects when the user comes back
        // from email verification (if it gets re-enabled later). Encoded
        // into emailRedirectTo so /auth/callback can forward them.
        const carryOver = new URLSearchParams({
          business_name: businessName.trim(),
          owner_first_name: firstName.trim(),
          owner_email: cleanEmail,
          owner_mobile: mobileE164,
        })
        if (intentToken) carryOver.set('intent', intentToken)

        const origin =
          typeof window !== 'undefined' ? window.location.origin : ''
        const emailRedirectTo = `${origin}/auth/callback?${carryOver.toString()}`

        const { data, error: authErr } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo,
            data: {
              business_name: businessName.trim(),
              first_name: firstName.trim(),
              intent_token: intentToken ?? null,
              owner_mobile: mobileE164,
            },
          },
        })
        if (authErr) throw authErr

        // Two sub-paths depending on Supabase "Confirm email" setting:
        //   (A1) ON  → session is null → route to /onboard/check-email
        //   (A2) OFF → session present → straight to wizard
        if (!data.session) {
          router.push(`/onboard/check-email?email=${encodeURIComponent(cleanEmail)}`)
          return
        }

        const next = new URLSearchParams({
          business_name: businessName.trim(),
          owner_first_name: firstName.trim(),
          owner_email: cleanEmail,
          owner_user_id: data.user?.id ?? '',
          owner_mobile: mobileE164,
        })
        if (intentToken) next.set('intent', intentToken)
        router.push(`/onboard?${next.toString()}`)
        return
      }

      // ─── Path B: Web-initiated (mobile needs OTP verification) ────
      // signUp with both phone + email + password. Supabase auto-fires
      // an OTP to the phone via Twilio (Phone provider must be enabled
      // in the Supabase dashboard). Session stays null until the OTP
      // is verified on /signup/verify.
      const { error: authErr } = await supabase.auth.signUp({
        email: cleanEmail,
        phone: mobileE164,
        password,
        options: {
          data: {
            business_name: businessName.trim(),
            first_name: firstName.trim(),
            owner_mobile: mobileE164,
          },
        },
      })
      if (authErr) throw authErr

      // Forward all the carry-over fields the verify page needs.
      // /signup/verify will call verifyOtp({ phone, token }) on the
      // tradie's typed code, then push them to /onboard with the same
      // identity payload.
      const verifyParams = new URLSearchParams({
        phone: mobileE164,
        business_name: businessName.trim(),
        owner_first_name: firstName.trim(),
        owner_email: cleanEmail,
      })
      router.push(`/signup/verify?${verifyParams.toString()}`)
    } catch (err: any) {
      setError(err?.message ?? 'Sign up failed')
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      step="01 / 04"
      title={
        <>
          Create your <span className="text-accent">QuoteMate</span>
        </>
      }
      subtitle="Takes 30 seconds. The next 3 steps are your trade, pricing, and a quick review."
      footer={
        <>
          Already onboard?{' '}
          <Link href="/signin" className="text-accent hover:text-accent-press font-semibold">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* SMS-prefill banner — only renders when the URL has ?intent=...
            and the token resolved to a mobile. Confirms to the tradie
            that we skip the OTP step because they already proved
            mobile possession by texting us. */}
        {intentMobile && (
          <div className="border border-accent/40 bg-accent/5 px-4 py-3 -mx-2">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-accent font-bold">
              Verified via SMS
            </div>
            <div className="mt-1 text-sm text-text-pri">
              Mobile <span className="font-mono">{intentMobile}</span> — no
              code needed.
            </div>
          </div>
        )}
        {intentError && (
          <ErrorBanner>{intentError}</ErrorBanner>
        )}

        <Field label="Business name" hint="Shows on every quote you send.">
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Jon's Sparky Co."
            className={INPUT}
            required
            maxLength={80}
            autoComplete="organization"
          />
        </Field>

        <Field label="Your first name">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Jon"
            className={INPUT}
            required
            maxLength={40}
            autoComplete="given-name"
          />
        </Field>

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

        <Field
          label="Mobile"
          hint={
            mobileLocked
              ? 'Verified via SMS'
              : "We'll text you a 6-digit code"
          }
        >
          <input
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            placeholder="04xx xxx xxx"
            className={
              mobileLocked
                ? `${INPUT} bg-ink-card/60 cursor-not-allowed text-text-sec`
                : INPUT
            }
            required
            readOnly={mobileLocked}
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
          />
        </Field>

        <Field label="Password" hint="Minimum 8 characters.">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
        >
          {submitting
            ? mobileLocked
              ? 'Creating your account…'
              : 'Sending code…'
            : mobileLocked
              ? 'Continue'
              : 'Send verification code'}
          {!submitting && <Arrow />}
        </button>

        <p className="text-center text-[0.7rem] font-mono uppercase tracking-[0.14em] text-text-dim">
          No card · We never auto-send quotes without your review
        </p>
      </form>
    </AuthShell>
  )
}

/* ─── Shared auth shell + primitives ────────────────────────── */

export function AuthShell({
  step,
  title,
  subtitle,
  children,
  footer,
}: {
  step?: string
  title: React.ReactNode
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <main className="min-h-screen flex flex-col">
      <nav className="border-b border-ink-line">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center bg-accent font-black text-white text-xs">
              Q
            </span>
            <span className="font-extrabold uppercase tracking-tight text-text-pri">
              QuoteMate
            </span>
          </Link>
          {footer && (
            <div className="text-sm text-text-sec">{footer}</div>
          )}
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          {step && (
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-accent font-bold mb-3">
              Step {step}
            </div>
          )}
          <h1 className="font-extrabold uppercase text-[clamp(2rem,5vw,2.75rem)] leading-[1] tracking-[-0.035em]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 text-text-sec leading-relaxed">{subtitle}</p>
          )}
          <div className="mt-10 bg-ink-card border border-ink-line p-6 md:p-8">
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}

export const INPUT =
  'w-full bg-ink-deep border border-ink-line text-text-pri placeholder:text-text-dim px-4 py-3.5 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft transition-colors'

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  error?: string
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-pri font-semibold">
          {label}
        </span>
        {hint && (
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-text-dim">
            {hint}
          </span>
        )}
      </div>
      {children}
      {error && (
        <div className="mt-2 text-xs text-rose-400 font-mono">{error}</div>
      )}
    </label>
  )
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-rose-900/70 bg-rose-950/50 text-rose-200 px-4 py-3 text-sm">
      {children}
    </div>
  )
}

export function Arrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  )
}
