// /sign-up — QuoteMax onboarding, step 01 (Account), CLERK-powered.
//
// The branded "Set up your QuoteMax" funnel (same FunnelShell as /signup +
// /onboard steps 02–04), but the account is created in CLERK. On success we
// forward the identity — including the new clerk_user_id — to /onboard, which
// finishes steps 02–04 and activates the tenant linked by clerk_user_id.
//
// Uses Clerk's signal-based sign-up API (useSignUp → signUp.password(),
// signUp.verifications.sendEmailCode()/verifyEmailCode(), signUp.finalize()).
// Email verification is handled BOTH ways: if the Clerk instance doesn't
// require it, sign-up completes instantly; if it does, a 6-digit code step
// appears inline (still step 01) before we finalize the session.

'use client'

import { Suspense, useState, useEffect, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useSignUp } from '@clerk/nextjs'
import { normaliseAuMobile } from '@/lib/onboard/schema'
import { FunnelShell } from '@/app/_components/funnel-shell'
import { Field, INPUT, RequiredLegend, ErrorBanner, Arrow } from '@/app/signup/page'

export default function ClerkSignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpInner />
    </Suspense>
  )
}

const PRIMARY_BTN =
  'w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep'

/** Pull a human-readable message (+ code) out of a Clerk error (or anything). */
function clerkErr(error: unknown): { message: string; code?: string } {
  const e = error as {
    code?: string
    message?: string
    longMessage?: string
    errors?: { code?: string; longMessage?: string; message?: string }[]
  }
  const nested = Array.isArray(e?.errors) ? e.errors[0] : undefined
  return {
    message: e?.longMessage ?? nested?.longMessage ?? e?.message ?? nested?.message ?? 'Sign up failed',
    code: e?.code ?? nested?.code,
  }
}

/** A Clerk-valid username derived from the email local-part + a random suffix.
 *  Supplied ONLY when the Clerk instance requires a username (the QuoteMax form
 *  doesn't collect one). [a-z0-9_], 4–64 chars, unique enough for sign-up. */
function deriveUsername(email: string): string {
  const local = (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'user'
  const rand = Math.random().toString(36).slice(2, 8)
  return `qm_${local}_${rand}`.slice(0, 64)
}

function SignUpInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { signUp } = useSignUp()

  const [businessName, setBusinessName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailExists, setEmailExists] = useState(false)

  // Email-verification sub-view (only when the Clerk instance requires it).
  const [pendingVerification, setPendingVerification] = useState(false)
  const [code, setCode] = useState('')
  // The E.164-normalised mobile captured at create time, reused by the
  // verification path's hand-off so it never forwards a raw value.
  const [pendingMobile, setPendingMobile] = useState('')

  // SMS intent (?intent=<token>) — same as /signup: prefill + lock the mobile
  // because the tradie already proved possession by texting us.
  const intentToken = params.get('intent') ?? null
  const [intentMobile, setIntentMobile] = useState<string | null>(null)
  const [intentError, setIntentError] = useState<string | null>(null)
  const mobileLocked = !!(intentToken && intentMobile)

  useEffect(() => {
    if (intentMobile) setMobile(intentMobile)
  }, [intentMobile])

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
              ? 'That signup link expired or was already used. You can sign up below as usual.'
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
    return () => {
      cancelled = true
    }
  }, [intentToken])

  /** Forward the identity fields the wizard needs, incl. the new Clerk id. */
  function goToOnboard(clerkUserId: string | null, mobileE164: string) {
    const next = new URLSearchParams({
      business_name: businessName.trim(),
      owner_first_name: firstName.trim(),
      owner_email: email.trim().toLowerCase(),
      clerk_user_id: clerkUserId ?? '',
      owner_mobile: mobileE164,
    })
    if (intentToken) next.set('intent', intentToken)
    const invite = params.get('code') ?? ''
    if (invite) next.set('code', invite)
    router.push(`/onboard?${next.toString()}`)
  }

  /** Complete a sign-up whose status is (or becomes) 'complete': supply an
   *  instance-required username the form doesn't collect, then finalize the
   *  session and hand off to /onboard. Returns true if it navigated. */
  async function finish(mobileE164: string): Promise<boolean> {
    if (!signUp) return false
    // Some Clerk instances make username a required field. Supply a derived one
    // on demand so a sign-up that's otherwise complete isn't stuck.
    if (signUp.status !== 'complete' && signUp.missingFields?.includes('username')) {
      const { error: uErr } = await signUp.update({ username: deriveUsername(email.trim().toLowerCase()) })
      if (uErr) {
        setError(clerkErr(uErr).message)
        return false
      }
    }
    if (signUp.status === 'complete') {
      const uid = signUp.createdUserId
      await signUp.finalize()
      goToOnboard(uid, mobileE164)
      return true
    }
    return false
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!signUp) return
    setError(null)
    setEmailExists(false)
    setSubmitting(true)
    try {
      const cleanEmail = email.trim().toLowerCase()
      let mobileE164: string
      try {
        mobileE164 = normaliseAuMobile(mobile)
      } catch {
        setError('Enter a valid Australian mobile (04xx xxx xxx)')
        setSubmitting(false)
        return
      }
      setPendingMobile(mobileE164)

      // Password-based sign-up. business_name + mobile ride along as Clerk
      // unsafeMetadata (copied to the user on completion); the wizard also
      // carries them via the URL, so it's belt-and-braces.
      const { error: createErr } = await signUp.password({
        emailAddress: cleanEmail,
        password,
        firstName: firstName.trim(),
        unsafeMetadata: { business_name: businessName.trim(), owner_mobile: mobileE164 },
      })
      if (createErr) {
        const { message, code: errCode } = clerkErr(createErr)
        if (errCode === 'form_identifier_exists') {
          setEmailExists(true)
          setError('An account with that email already exists.')
        } else {
          setError(message)
        }
        setSubmitting(false)
        return
      }

      // Complete now if the instance needs nothing further (finish() also
      // supplies a required username on demand). Otherwise fall through to the
      // email-code step below.
      if (await finish(mobileE164)) return

      // Verification required → email a 6-digit code and show the code step.
      const { error: sendErr } = await signUp.verifications.sendEmailCode()
      if (sendErr) {
        setError(clerkErr(sendErr).message)
        setSubmitting(false)
        return
      }
      setPendingVerification(true)
      setSubmitting(false)
    } catch (err) {
      setError(clerkErr(err).message)
      setSubmitting(false)
    }
  }

  async function handleVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!signUp) return
    setError(null)
    setSubmitting(true)
    try {
      const { error: verifyErr } = await signUp.verifications.verifyEmailCode({ code: code.trim() })
      if (verifyErr) {
        setError(clerkErr(verifyErr).message)
        setSubmitting(false)
        return
      }
      if (await finish(pendingMobile)) return
      setError('Could not finish creating your account. Please try again.')
      setSubmitting(false)
    } catch (err) {
      setError(clerkErr(err).message)
      setSubmitting(false)
    }
  }

  // ─── Verification sub-view (still step 01) ───────────────────────
  if (pendingVerification) {
    return (
      <FunnelShell
        currentNum="01"
        heading="Confirm your email"
        subtitle={`We emailed a 6-digit code to ${email.trim().toLowerCase()}. Enter it to finish creating your account.`}
      >
        <div className="mt-up border border-ink-line bg-ink-card p-7 md:p-10">
          <form onSubmit={handleVerify} className="space-y-7">
            <Field label="Verification code" hint="Check your inbox" required>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={INPUT}
                required
                maxLength={6}
              />
            </Field>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button type="submit" disabled={submitting} className={PRIMARY_BTN}>
              {submitting ? 'Verifying…' : 'Verify & continue'}
              {!submitting && <Arrow />}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingVerification(false)
                setError(null)
              }}
              className="w-full text-center font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim hover:text-accent"
            >
              ← Back
            </button>
          </form>
        </div>
      </FunnelShell>
    )
  }

  // ─── Account step ────────────────────────────────────────────────
  return (
    <FunnelShell
      currentNum="01"
      heading="Create your account"
      subtitle="Takes about 30 seconds. Next you'll add your trade, pricing, and a quick review."
    >
      <div className="mt-up border border-ink-line bg-ink-card p-7 md:p-10">
        <form onSubmit={handleSubmit} className="space-y-7">
          {intentMobile && (
            <div className="border border-accent/40 bg-accent/5 px-4 py-3">
              <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-accent font-bold">
                Verified via SMS
              </div>
              <div className="mt-1 text-sm text-text-pri">
                Mobile <span className="font-mono">{intentMobile}</span> · no code needed.
              </div>
            </div>
          )}
          {intentError && <ErrorBanner>{intentError}</ErrorBanner>}

          <RequiredLegend />

          <Field label="Business name" hint="Shows on every quote you send." required>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className={INPUT}
              required
              maxLength={80}
              autoComplete="organization"
            />
          </Field>

          <Field label="Your first name" required>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={INPUT}
              required
              maxLength={40}
              autoComplete="given-name"
            />
          </Field>

          <Field label="Email" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT}
              required
              autoComplete="email"
            />
          </Field>

          <Field label="Mobile" hint={mobileLocked ? 'Verified via SMS' : 'Customers see this on quotes'} required>
            <input
              type="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className={mobileLocked ? `${INPUT} bg-ink-card/60 cursor-not-allowed text-text-sec` : INPUT}
              required
              readOnly={mobileLocked}
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
            />
          </Field>

          <Field label="Password" hint="Minimum 8 characters." required>
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

          {error && (
            <ErrorBanner>
              {error}{' '}
              {emailExists && (
                <Link href="/sign-in" className="font-semibold text-accent hover:text-accent-press underline">
                  Sign in instead
                </Link>
              )}
            </ErrorBanner>
          )}

          {/* Clerk Smart CAPTCHA renders here (bot protection on sign-up).
              Must exist in the DOM before the sign-up call runs. */}
          <div id="clerk-captcha" />

          <button type="submit" disabled={submitting || !signUp} className={PRIMARY_BTN}>
            {submitting ? 'Creating your account…' : 'Continue'}
            {!submitting && <Arrow />}
          </button>

          <p className="text-center text-[0.7rem] font-mono uppercase tracking-[0.14em] text-text-dim">
            No card · We never auto-send quotes without your review
          </p>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-text-sec">
        Already onboard?{' '}
        <Link href="/sign-in" className="text-accent hover:text-accent-press font-semibold">
          Sign in
        </Link>
      </p>
    </FunnelShell>
  )
}
