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
import { useAuth, useSignIn, useSignUp } from '@clerk/nextjs'
import { normaliseAuMobile } from '@/lib/onboard/schema'
import { classifySignUpFailure, decideDuplicateEmail } from '@/lib/onboard/resume-decision'
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
  const { signIn } = useSignIn()
  const { getToken } = useAuth()

  const [businessName, setBusinessName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Where the duplicate-email banner should send them: the Clerk sign-in page
  // (password didn't prove ownership) or the dashboard (account already set up).
  const [duplicateAction, setDuplicateAction] = useState<null | 'signin' | 'dashboard'>(null)

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
   *  session and hand off to /onboard.
   *
   *  Returns true when it HANDLED the outcome and the caller must stop — either
   *  it navigated, or it surfaced a terminal error. False means "not complete
   *  yet, carry on" (i.e. the caller should run email verification). */
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
      // Session conflict: Clerk created the user but could NOT make it the active
      // session because another is already live (SignUpFutureResource
      // .existingSession). Finalising anyway would hand /onboard the NEW user id
      // while the browser stays authenticated as the OLD one — activate would
      // stamp a tenant that its own session can't then resolve, i.e. an orphan
      // reachable only after a manual sign-out. Stop and say so instead.
      if (signUp.existingSession) {
        setDuplicateAction('dashboard')
        setError(
          'Your account was created, but this device is still signed in to another account. Open your dashboard, or sign out and sign back in to finish setting up.',
        )
        setSubmitting(false)
        return true
      }
      const uid = signUp.createdUserId
      await signUp.finalize()
      goToOnboard(uid, mobileE164)
      return true
    }
    return false
  }

  /**
   * Duplicate email — the Clerk port of /signup's `resumeAbandonedSignup`
   * (app/api/auth/signup/route.ts:66-100).
   *
   * An account with NO tenant row is an abandoned wizard run, not a real
   * account, and a hard stop would lock the tradie out of their own email. So:
   * prove ownership with the password they just typed, THEN ask whether a tenant
   * exists, then continue in this same submit. Keeping that order is what stops
   * this becoming an email-enumeration oracle — exactly the property /signup has.
   *
   * The tenant question is answered by GET /api/tenant/me, which already resolves
   * dual-auth and 404s for authed-but-no-tenant (the signal
   * app/dashboard/page.tsx:715 relies on). No new endpoint.
   */
  async function handleDuplicateEmail(cleanEmail: string, mobileE164: string) {
    let signInFailed = true
    let tenantStatus: number | null = null

    try {
      if (signIn) {
        const { error: signInErr } = await signIn.password({
          identifier: cleanEmail,
          password,
        })
        // Anything short of 'complete' (wrong password, 2FA required, …) is a
        // failure here: we can't mint a token, so we can't answer the tenant
        // question, so we must not resume.
        if (!signInErr && signIn.status === 'complete') {
          await signIn.finalize()
          signInFailed = false
          const token = await getToken().catch(() => null)
          if (token) {
            const res = await fetch('/api/tenant/me', {
              headers: { Authorization: `Bearer ${token}` },
            })
            tenantStatus = res.status
          }
        }
      }
    } catch {
      // Network/SDK throw. If it fired BEFORE sign-in completed, signInFailed is
      // still true and we fail closed to 'needs_signin'. If it fired after (e.g.
      // the /api/tenant/me fetch itself threw), signInFailed is already false but
      // tenantStatus is not 404, so decideDuplicateEmail routes to
      // 'existing_account' — never 'resume'. Safe on both sides of the await.
    }

    switch (decideDuplicateEmail({ signInFailed, tenantStatus })) {
      case 'resume':
        // Abandoned run. Same submit, no trip through /sign-in. clerk_user_id is
        // left empty on purpose — /onboard stamps it from the live Clerk session
        // (app/onboard/page.tsx:260-264), which is now authenticated.
        goToOnboard(null, mobileE164)
        return
      case 'existing_account':
        // Covers BOTH "a tenant already exists" and "we couldn't get a clean
        // answer" — so the copy must be true either way. It is: the password
        // authenticated, so they are signed in, and the dashboard self-routes to
        // /onboard if no tenant turns up (app/dashboard/page.tsx:714-717).
        setDuplicateAction('dashboard')
        setError("You're signed in now — open your dashboard to pick up where you left off.")
        setSubmitting(false)
        return
      case 'needs_signin':
        setDuplicateAction('signin')
        setError('An account with that email already exists. Sign in instead.')
        setSubmitting(false)
        return
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!signUp) return
    setError(null)
    setDuplicateAction(null)
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
        // Classified from Clerk's own resource signals first, error text second.
        switch (
          classifySignUpFailure({
            existingSession: !!signUp.existingSession,
            isTransferable: signUp.isTransferable,
            error: createErr,
          })
        ) {
          case 'already_signed_in':
            // A duplicate-email attempt that authenticated leaves a live session,
            // so a resubmit with a DIFFERENT email lands here. Without this the
            // tradie gets a raw Clerk string and no way forward.
            setDuplicateAction('dashboard')
            setError("You're already signed in on this device.")
            setSubmitting(false)
            return
          case 'identifier_taken':
            await handleDuplicateEmail(cleanEmail, mobileE164)
            return
          case 'other':
            setError(clerkErr(createErr).message)
            setSubmitting(false)
            return
        }
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
            <button type="submit" disabled={submitting} aria-busy={submitting} className={PRIMARY_BTN}>
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
              {duplicateAction === 'signin' && (
                <Link href="/sign-in" className="font-semibold text-accent hover:text-accent-press underline">
                  Sign in instead
                </Link>
              )}
              {duplicateAction === 'dashboard' && (
                <Link href="/dashboard" className="font-semibold text-accent hover:text-accent-press underline">
                  Open your dashboard
                </Link>
              )}
            </ErrorBanner>
          )}

          {/* Clerk Smart CAPTCHA renders here (bot protection on sign-up).
              Must exist in the DOM before the sign-up call runs. */}
          <div id="clerk-captcha" />

          <button type="submit" disabled={submitting || !signUp} aria-busy={submitting} className={PRIMARY_BTN}>
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
