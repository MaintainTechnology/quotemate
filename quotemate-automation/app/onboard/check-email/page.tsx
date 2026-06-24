// /onboard/check-email — shown immediately after sign up when Supabase
// requires email confirmation. The user lands here, opens their inbox,
// clicks the verification link in Supabase's email → that link routes
// to /auth/callback which resumes the wizard.

'use client'

import { Suspense, useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BrandMark } from "@/app/_components/BrandMark"

// Next.js 16 disallows prerendering pages whose default export reads
// useSearchParams() without a Suspense boundary. Inner component owns
// the URL-reading logic; this wrapper provides the boundary.
export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailInner />
    </Suspense>
  )
}

function CheckEmailInner() {
  const params = useSearchParams()
  const email = params.get('email') ?? ''
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  // Simple resend rate limit (60s) so the tradie can't spam Supabase.
  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secondsLeft])

  async function handleResend() {
    if (!email || resending || secondsLeft > 0) return
    setError(null)
    setResending(true)
    try {
      const supabase = getBrowserSupabase()
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email,
      })
      if (resendErr) throw resendErr
      setResent(true)
      setSecondsLeft(60)
    } catch (e: any) {
      setError(e?.message ?? 'Resend failed')
    } finally {
      setResending(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="border-b border-ink-line">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandMark className="h-10 w-10" />
            <span className="font-extrabold uppercase tracking-tight text-text-pri">
              QuoteMax
            </span>
          </Link>
          <Link
            href="/signin"
            className="text-sm font-semibold uppercase tracking-wider text-text-sec hover:text-text-pri transition-colors"
          >
            Already verified? Sign in
          </Link>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl text-center">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-accent font-bold">
            Step 01 / 04 · Pending
          </span>
          <h1 className="mt-4 font-extrabold uppercase text-[clamp(2rem,5vw,3.25rem)] leading-[1] tracking-[-0.035em]">
            Check your <span className="text-accent">email</span>.
          </h1>
          <p className="mt-5 text-text-sec text-lg leading-relaxed">
            We sent a verification link to{' '}
            {email ? (
              <span className="font-mono text-text-pri">{email}</span>
            ) : (
              <span className="text-text-pri">the address you signed up with</span>
            )}
            . Click the link to finish your sign-in and continue the wizard.
          </p>

          <div className="mt-10 bg-ink-card border border-ink-line p-6 md:p-7 text-left">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
              Why this step?
            </span>
            <p className="mt-3 text-sm text-text-sec leading-relaxed">
              Customers will text and call <em>your</em> QuoteMax number — we
              need to be sure the email on file is yours so we can route quote
              notifications and password resets correctly.
            </p>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleResend}
              disabled={!email || resending || secondsLeft > 0}
              className="inline-flex items-center gap-2 bg-transparent border border-ink-line hover:bg-ink-card text-text-pri font-semibold px-6 py-3 text-sm uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {resending
                ? 'Resending…'
                : secondsLeft > 0
                ? `Resend in ${secondsLeft}s`
                : 'Resend verification email'}
            </button>
            {resent && secondsLeft > 0 && (
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-accent">
                Sent — check your inbox + spam
              </p>
            )}
            {error && (
              <p className="text-sm text-rose-300">{error}</p>
            )}
          </div>

          <p className="mt-12 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
            Verification typically arrives within a minute · Check spam if it doesn&rsquo;t
          </p>
        </div>
      </div>
    </main>
  )
}
