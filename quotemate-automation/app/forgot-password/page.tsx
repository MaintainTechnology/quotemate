// /forgot-password — request a password reset email.
//
// Uses Supabase's native recovery flow: resetPasswordForEmail sends the
// project's "Reset Password" template with a link back to
// /auth/reset-password (must be on the Supabase Auth → URL Configuration
// allow-list for each environment). Supabase does NOT reveal whether an
// email exists, so we can surface real errors (e.g. rate limiting) without
// leaking account existence — but we still show a generic confirmation on
// success regardless.
//
// No useSearchParams here, so no Suspense boundary is required (unlike
// /signin and /auth/reset-password).

'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { AuthShell, Field, INPUT, ErrorBanner, Arrow } from '../signup/page'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const supabase = getBrowserSupabase()
      const redirectTo = `${window.location.origin}/auth/reset-password`
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo },
      )
      if (resetErr) throw resetErr
      setSent(true)
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not send the reset email — try again in a moment.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      title={
        <>
          Reset your <span className="text-accent">password</span>
        </>
      }
      subtitle="Enter the email you signed up with and we'll send you a secure link to set a new password."
      footer={
        <>
          Remembered it?{' '}
          <Link href="/signin" className="text-accent hover:text-accent-press font-semibold">
            Sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <div className="space-y-5">
          <div className="border border-accent/40 bg-accent/5 px-4 py-3">
            <div className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-accent font-bold">
              Check your inbox
            </div>
            <div className="mt-1 text-sm text-text-pri">
              If an account exists for{' '}
              <span className="font-mono">{email.trim().toLowerCase()}</span>, a
              reset link is on its way. The link expires shortly — use it soon.
            </div>
          </div>
          <p className="text-sm text-text-sec leading-relaxed">
            Didn&rsquo;t get it? Check spam, or{' '}
            <button
              type="button"
              onClick={() => {
                setSent(false)
                setError(null)
              }}
              className="text-accent hover:text-accent-press font-semibold underline-offset-2 hover:underline"
            >
              try a different email
            </button>
            .
          </p>
        </div>
      ) : (
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

          {error && <ErrorBanner>{error}</ErrorBanner>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
          >
            {submitting ? 'Sending link…' : 'Send reset link'}
            {!submitting && <Arrow />}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
