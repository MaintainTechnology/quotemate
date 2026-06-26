// /auth/reset-password — the landing page for the recovery link Supabase
// emails from /forgot-password.
//
// This is a DEDICATED page, deliberately NOT /auth/callback: the callback
// hard-routes to /onboard or / once a session exists, which would strand a
// password reset. Here we establish the recovery session ourselves
// (mirroring the callback's code/OTP exchange), then show a new-password
// form and call auth.updateUser({ password }).
//
// Recovery links arrive in the same three shapes the callback handles:
//   (A) PKCE         → ?code=...            → exchangeCodeForSession
//   (B) OTP hash     → ?token_hash=&type=recovery → verifyOtp
//   (C) hash frag    → #access_token=...    → detectSessionInUrl (implicit)
//
// useSearchParams forces a CSR bailout, so the inner component is wrapped in
// <Suspense> (Next 16 requirement — see /signin for the same pattern).

'use client'

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { checkPassword } from '@/lib/auth/password'
import { AuthShell, Field, INPUT, ErrorBanner, Arrow } from '../../signup/page'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetSkeleton />}>
      <ResetPasswordInner />
    </Suspense>
  )
}

type Phase = 'exchanging' | 'ready' | 'invalid' | 'saving' | 'done'

function ResetPasswordInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [phase, setPhase] = useState<Phase>('exchanging')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  // ─── Establish the recovery session from the link ──────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = getBrowserSupabase()
      try {
        const code = params.get('code')
        if (code) {
          const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code)
          if (exchErr) throw exchErr
        }

        const tokenHash = params.get('token_hash')
        const otpType = params.get('type')
        if (!code && tokenHash) {
          const { error: otpErr } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: (otpType ?? 'recovery') as
              | 'recovery'
              | 'email'
              | 'signup'
              | 'invite'
              | 'email_change',
          })
          if (otpErr) throw otpErr
        }

        // Hash-fragment flow: detectSessionInUrl handles it during client
        // init — give it a beat to settle before we read the session.
        if (!code && !tokenHash) {
          await new Promise((r) => setTimeout(r, 150))
        }

        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (!data.session) {
          setPhase('invalid')
          return
        }
        setPhase('ready')
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : null)
        setPhase('invalid')
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    const strength = checkPassword(password)
    if (!strength.ok) {
      setError(strength.error)
      return
    }
    setPhase('saving')
    try {
      const supabase = getBrowserSupabase()
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw updErr
      setPhase('done')
      setTimeout(() => router.replace('/dashboard'), 1600)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update your password.')
      setPhase('ready')
    }
  }

  if (phase === 'exchanging') {
    return (
      <AuthShell
        title={
          <>
            Verifying your <span className="text-accent">link</span>
          </>
        }
        subtitle="One moment while we confirm your reset link."
      >
        <ResetSkeleton />
      </AuthShell>
    )
  }

  if (phase === 'invalid') {
    return (
      <AuthShell
        title={
          <>
            That link <span className="text-accent">expired</span>
          </>
        }
        subtitle="Reset links are single-use and time out quickly. Request a fresh one and we'll send another."
        footer={
          <>
            Back to{' '}
            <Link href="/signin" className="text-accent hover:text-accent-press font-semibold">
              Sign in
            </Link>
          </>
        }
      >
        <div className="space-y-5">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <Link
            href="/forgot-password"
            className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-4 text-sm uppercase tracking-wider transition-colors focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
          >
            Request a new link
            <Arrow />
          </Link>
        </div>
      </AuthShell>
    )
  }

  if (phase === 'done') {
    return (
      <AuthShell
        title={
          <>
            Password <span className="text-accent">updated</span>
          </>
        }
        subtitle="You're all set. Taking you to your dashboard…"
      >
        <div className="border border-accent/40 bg-accent/5 px-4 py-3 text-sm text-text-pri">
          Your password has been changed. If the redirect doesn&rsquo;t happen,{' '}
          <Link href="/dashboard" className="text-accent hover:text-accent-press font-semibold">
            go to your dashboard
          </Link>
          .
        </div>
      </AuthShell>
    )
  }

  // 'ready' | 'saving'
  return (
    <AuthShell
      title={
        <>
          Set a new <span className="text-accent">password</span>
        </>
      }
      subtitle="Choose a strong password you don't use anywhere else."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="New password" hint="Minimum 8 characters.">
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
        <Field label="Confirm new password">
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={INPUT}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <button
          type="submit"
          disabled={phase === 'saving'}
          className="w-full inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-4 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
        >
          {phase === 'saving' ? 'Saving…' : 'Update password'}
          {phase !== 'saving' && <Arrow />}
        </button>
      </form>
    </AuthShell>
  )
}

function ResetSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-[3.25rem] border border-ink-line bg-ink-deep/40" />
      <div className="h-[3.25rem] border border-ink-line bg-ink-deep/40" />
      <div className="h-[3.25rem] bg-accent/40" />
    </div>
  )
}
