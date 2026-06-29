// Change-password card for the dashboard Account tab.
//
// Self-contained: it reads its own Supabase session (no props threaded
// through AccountTab) and POSTs to /api/tenant/password, which verifies the
// current password before applying the new one. Visual chrome mirrors the
// dashboard's in-file <Card> (accent tick header + bordered panel) and
// reuses the shared auth-form primitives so it looks native to the tab.

'use client'

import { useState, type FormEvent } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { checkPassword } from '@/lib/auth/password'
import { INPUT, Field, ErrorBanner } from '../../signup/page'

export function ChangePasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setDone(false)

    if (next !== confirm) {
      setError('New passwords do not match.')
      return
    }
    const strength = checkPassword(next)
    if (!strength.ok) {
      setError(strength.error)
      return
    }
    if (next === current) {
      setError('New password must be different from your current password.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = getBrowserSupabase()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setError('Your session has expired. Sign in again to change your password.')
        return
      }

      const res = await fetch('/api/tenant/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) {
        setError(body.error ?? `Could not change password (HTTP ${res.status}).`)
        return
      }

      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-ink-card border border-ink-line">
      <div className="border-b border-ink-line bg-ink-deep/35 px-4 sm:px-6 py-4 sm:py-5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="h-4 w-1 shrink-0 bg-accent" />
          <h2 className="font-extrabold uppercase text-base tracking-[-0.01em] text-text-pri">
            Change password
          </h2>
        </div>
        <p className="text-text-sec text-sm mt-2 pl-3.5">
          Update the password you use to sign in to QuoteMax.
        </p>
      </div>
      <div className="px-4 sm:px-6 py-5 sm:py-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Current password">
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={INPUT}
              required
              autoComplete="current-password"
            />
          </Field>
          <div className="grid md:grid-cols-2 gap-5">
            <Field label="New password" hint="Minimum 8 characters.">
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
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
          </div>

          {error && <ErrorBanner>{error}</ErrorBanner>}

          <div className="flex items-center justify-between pt-2">
            {done ? (
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-emerald-400">
                ✓ Password updated
              </span>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-press text-white font-semibold px-6 py-3 text-sm uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent-soft focus:ring-offset-2 focus:ring-offset-ink-deep"
            >
              {submitting ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
