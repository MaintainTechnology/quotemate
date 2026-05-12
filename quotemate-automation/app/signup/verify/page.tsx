// /signup/verify — Step 1b of the web-initiated onboarding funnel.
//
// Reached from /signup AFTER the tradie entered their mobile and we
// fired `supabase.auth.signUp({ phone, email, password })`. Supabase
// auto-sent a 6-digit OTP via Twilio. This page collects that code
// and calls verifyOtp to confirm the phone + sign the user in, then
// forwards to the wizard with the same carry-over payload the SMS
// path uses.
//
// SMS-initiated signups SKIP this page entirely — their mobile was
// already verified by physical possession of the device that sent
// the inbound SMS, so /signup routes them straight to /onboard.

'use client'

import { Suspense, useState, useEffect, useRef, type FormEvent, type KeyboardEvent, type ClipboardEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { AuthShell, ErrorBanner, Arrow } from '../page'

// Next.js 16 disallows prerendering pages whose default export reads
// useSearchParams() without a Suspense boundary. Inner component owns
// the URL-reading logic; this wrapper provides the boundary.
export default function VerifyOtpPage() {
  return (
    <Suspense fallback={null}>
      <VerifyOtpInner />
    </Suspense>
  )
}

const RESEND_COOLDOWN_SEC = 60

function VerifyOtpInner() {
  const router = useRouter()
  const params = useSearchParams()

  // Carry-over identity payload from /signup — must be forwarded
  // unmodified to the wizard so it can pre-populate the tradie's row.
  const phone = params.get('phone') ?? ''
  const businessName = params.get('business_name') ?? ''
  const ownerFirstName = params.get('owner_first_name') ?? ''
  const ownerEmail = params.get('owner_email') ?? ''

  // 6-digit code split across 6 inputs for that "credit-card-style"
  // entry feel. Tradies on mobile see the OS auto-fill suggestion from
  // the inbound SMS and the whole code lands in one tap.
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', ''])
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resend cooldown — prevents accidental double-fire of the OTP SMS
  // (each one costs ~$0.075 in AU and burns a Twilio credit).
  const [resending, setResending] = useState(false)
  const [resendOk, setResendOk] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN_SEC)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secondsLeft])

  // Auto-focus the first input on mount so the tradie can start typing
  // immediately. The Web OTP API on Chrome/Android will also auto-fill
  // all 6 inputs when the SMS lands in the same session.
  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  // No phone in URL means someone deep-linked here without going through
  // /signup — bounce them back so the OTP can be re-fired with full context.
  if (!phone) {
    return (
      <AuthShell
        step="01 / 04"
        title={<>Verify your <span className="text-accent">mobile</span></>}
        subtitle="Looks like you landed here without starting the signup. Head back to the start."
      >
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-sm uppercase tracking-wider"
        >
          Back to signup
          <Arrow />
        </Link>
      </AuthShell>
    )
  }

  function setDigit(idx: number, value: string) {
    // Strip non-digits; if a longer string was pasted, distribute across boxes.
    const cleaned = value.replace(/\D/g, '')
    if (cleaned.length > 1) {
      // Spread the pasted/typed string across inputs starting at idx.
      const next = [...digits]
      for (let i = 0; i < cleaned.length && idx + i < 6; i++) {
        next[idx + i] = cleaned[i]
      }
      setDigits(next)
      const advanceTo = Math.min(idx + cleaned.length, 5)
      inputRefs.current[advanceTo]?.focus()
      return
    }
    const next = [...digits]
    next[idx] = cleaned
    setDigits(next)
    // Auto-advance to next box when a digit was typed.
    if (cleaned && idx < 5) {
      inputRefs.current[idx + 1]?.focus()
    }
  }

  function handleKey(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    // Backspace on an empty box should jump to the previous one,
    // mirroring iOS/Android OTP entry behaviour.
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      e.preventDefault()
      const next = [...digits]
      next[idx - 1] = ''
      setDigits(next)
      inputRefs.current[idx - 1]?.focus()
    }
    if (e.key === 'ArrowLeft' && idx > 0) {
      inputRefs.current[idx - 1]?.focus()
    }
    if (e.key === 'ArrowRight' && idx < 5) {
      inputRefs.current[idx + 1]?.focus()
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    // Let setDigit handle any 6-digit (or near-6-digit) pasted string.
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '')
    if (pasted.length >= 1) {
      e.preventDefault()
      setDigit(0, pasted)
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const token = digits.join('')
    if (token.length !== 6) {
      setError('Enter the full 6-digit code we sent you')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const supabase = getBrowserSupabase()
      const { data, error: verifyErr } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms',
      })
      if (verifyErr) throw verifyErr
      if (!data.session) {
        throw new Error('Code accepted but no session was returned — try signing in directly.')
      }

      // Verified + signed in. Push to the wizard with the same carry-over
      // payload /auth/callback would have produced if email confirmation
      // had been in play. Mobile is now stamped as `owner_mobile` so the
      // wizard locks the field (we just verified it).
      const next = new URLSearchParams({
        business_name: businessName,
        owner_first_name: ownerFirstName,
        owner_email: ownerEmail,
        owner_user_id: data.user?.id ?? '',
        owner_mobile: phone,
      })
      router.push(`/onboard?${next.toString()}`)
    } catch (err: any) {
      setError(
        err?.message?.includes('expired')
          ? 'That code expired. Tap "Resend code" for a new one.'
          : err?.message?.toLowerCase().includes('invalid') ||
            err?.message?.toLowerCase().includes('token')
            ? "That code doesn't match. Double-check and try again."
            : err?.message ?? 'Verification failed',
      )
      setSubmitting(false)
    }
  }

  async function handleResend() {
    if (resending || secondsLeft > 0) return
    setError(null)
    setResending(true)
    setResendOk(false)
    try {
      const supabase = getBrowserSupabase()
      // signInWithOtp re-fires the SMS for an existing user. shouldCreateUser=false
      // because the user already exists from the signUp on /signup.
      const { error: resendErr } = await supabase.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: false },
      })
      if (resendErr) throw resendErr
      setResendOk(true)
      setSecondsLeft(RESEND_COOLDOWN_SEC)
    } catch (err: any) {
      setError(err?.message ?? 'Resend failed')
    } finally {
      setResending(false)
    }
  }

  // Friendly redaction so the tradie sees their own mobile but the
  // page isn't trivially screen-shotted with a full number on display.
  const maskedPhone = phone.replace(/(\+61)(\d{3})(\d{3})(\d{3})/, '$1 $2 $3 $4')

  return (
    <AuthShell
      step="01b / 04"
      title={
        <>
          Verify your <span className="text-accent">mobile</span>
        </>
      }
      subtitle={`We just sent a 6-digit code to ${maskedPhone}. Type it below to finish creating your account.`}
      footer={
        <>
          Wrong number?{' '}
          <Link href="/signup" className="text-accent hover:text-accent-press font-semibold">
            Start over
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <div className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-pri font-semibold mb-3">
            Enter code
          </div>
          <div className="grid grid-cols-6 gap-2">
            {digits.map((digit, idx) => (
              <input
                key={idx}
                ref={(el) => {
                  inputRefs.current[idx] = el
                }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                maxLength={6 /* allow paste of full code into any box */}
                value={digit}
                onChange={(e) => setDigit(idx, e.target.value)}
                onKeyDown={(e) => handleKey(idx, e)}
                onPaste={handlePaste}
                disabled={submitting}
                className="aspect-square w-full bg-ink-deep border border-ink-line text-text-pri text-center font-mono text-2xl font-bold focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft transition-colors disabled:opacity-50"
                aria-label={`Digit ${idx + 1} of 6`}
              />
            ))}
          </div>
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}
        {resendOk && secondsLeft > 0 && (
          <div className="border border-accent/40 bg-accent/5 px-4 py-3 -mx-2">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-accent font-bold">
              Sent
            </div>
            <div className="mt-1 text-sm text-text-pri">
              New code on its way to {maskedPhone}.
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || digits.join('').length !== 6}
          className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
        >
          {submitting ? 'Verifying…' : 'Verify + continue'}
          {!submitting && <Arrow />}
        </button>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || secondsLeft > 0}
            className="text-sm font-semibold text-text-sec hover:text-text-pri disabled:cursor-not-allowed disabled:opacity-50 underline-offset-2 hover:underline transition-colors"
          >
            {resending
              ? 'Resending…'
              : secondsLeft > 0
                ? `Resend code in ${secondsLeft}s`
                : 'Resend code'}
          </button>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim text-center">
            Code expires in 5 minutes · Check signal if it doesn&rsquo;t arrive
          </p>
        </div>
      </form>
    </AuthShell>
  )
}
