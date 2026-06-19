'use client'

// Dashboard → Billing tab. Shows the tradie's current subscription (from
// /api/billing/status, mirrored off Stripe by the webhook) and lets them
// start a plan (→ /api/billing/checkout) or manage an existing one via the
// Stripe Customer Portal (→ /api/billing/portal). Plan data + AUD
// formatting are shared with the marketing pricing page.

import { useEffect, useState } from 'react'
import {
  PLANS,
  annualPerMonth,
  annualSaving,
  aud,
  hasFreeTrial,
  type Plan,
} from '@/app/_components/pricing-data'
import { readPlanIntent, clearPlanIntent } from '@/lib/billing/plan-intent'

type Status = {
  has_customer: boolean
  status: string | null
  plan: string | null
  interval: string | null
  current_period_end: string | null
  trial_ends_at: string | null
  cancel_at_period_end: boolean
  usage?: { quotesUsed: number; voiceMinutesUsed: number } | null
  limits?: { quotes: number; voice: boolean; voiceMinutes: number } | null
}

const ACTIVE_STATES = new Set(['trialing', 'active', 'past_due'])

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export function BillingTab({ accessToken }: { accessToken: string | null }) {
  // Default the toggle to the stashed plan-intent interval (set by the
  // /pricing CTA before signup), else annual.
  const [annual, setAnnual] = useState(() => readPlanIntent()?.interval !== 'month')
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Read the post-checkout redirect flag (?subscribed=1) once, at mount.
  const [justSubscribed] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('subscribed') === '1',
  )

  // Load subscription state on mount / when the token arrives. All setState
  // happens after an await, so the effect never sets state synchronously.
  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/billing/status', {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = (await res.json()) as Status
        if (cancelled) return
        setStatus(json)
        setLoading(false)
        // Plan-intent hand-off: a signed-out visitor picked a plan on
        // /pricing before signing up. Now that they're onboarded, auto-start
        // that plan's Checkout — once — unless they already have a sub.
        const active = !!json.status && ACTIVE_STATES.has(json.status)
        const intent = readPlanIntent()
        if (intent && !active) {
          clearPlanIntent()
          await doCheckout(intent.plan, intent.interval) // redirects to Stripe
        }
        return
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load billing status')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  async function doCheckout(planId: string, interval: 'month' | 'year') {
    if (!accessToken) return
    setBusy(planId)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ plan: planId, interval }),
      })
      const json = (await res.json()) as { url?: string; error?: string; detail?: string }
      if (json.url) {
        window.location.assign(json.url)
        return
      }
      setError(json.detail || json.error || 'Could not start checkout')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start checkout')
    } finally {
      setBusy(null)
    }
  }

  function startCheckout(plan: Plan) {
    void doCheckout(plan.id, annual ? 'year' : 'month')
  }

  async function openPortal() {
    if (!accessToken) return
    setBusy('portal')
    setError(null)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = (await res.json()) as { url?: string; error?: string; detail?: string }
      if (json.url) {
        window.location.assign(json.url)
        return
      }
      setError(json.detail || json.error || 'Could not open the billing portal')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the billing portal')
    } finally {
      setBusy(null)
    }
  }

  const hasActive = !!status && !!status.status && ACTIVE_STATES.has(status.status)
  const currentPlan = status?.plan ?? null

  return (
    <div className="max-w-4xl">
      <h2 className="font-extrabold uppercase tracking-tight text-text-pri text-2xl">
        Billing &amp; plan
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-sec">
        Your QuoteMate subscription. Starter Monthly comes with a 14-day free
        trial; every other plan starts right away. Switch plans or manage your
        card anytime — prices are AUD, ex-GST.
      </p>

      {justSubscribed && (
        <div className="mt-6 border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text-pri">
          You&rsquo;re all set — your subscription is active. It can take a few
          seconds to show below; refresh if needed.
        </div>
      )}

      {error && (
        <div className="mt-6 border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-text-pri">
          {error}
        </div>
      )}

      {/* Current subscription */}
      {loading ? (
        <div className="mt-8 text-sm text-text-dim">Loading…</div>
      ) : hasActive && status ? (
        <div className="mt-8 border border-ink-line bg-ink-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="font-extrabold uppercase tracking-tight text-text-pri text-xl">
                  {currentPlan
                    ? currentPlan[0].toUpperCase() + currentPlan.slice(1)
                    : 'Subscribed'}
                </span>
                <StatusPill status={status.status} />
              </div>
              <p className="mt-2 text-sm text-text-sec">
                {status.status === 'trialing' && status.trial_ends_at
                  ? `Free trial ends ${fmtDate(status.trial_ends_at)}.`
                  : status.cancel_at_period_end && status.current_period_end
                    ? `Cancels on ${fmtDate(status.current_period_end)}.`
                    : status.current_period_end
                      ? `Renews ${fmtDate(status.current_period_end)} (${status.interval === 'year' ? 'yearly' : 'monthly'}).`
                      : null}
              </p>
            </div>
            <button
              type="button"
              onClick={openPortal}
              disabled={busy === 'portal'}
              className="inline-flex items-center gap-2 bg-accent px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-white transition-colors hover:bg-accent-press disabled:opacity-50"
            >
              {busy === 'portal' ? 'Opening…' : 'Manage billing'}
            </button>
          </div>
          <p className="mt-4 text-xs text-text-dim">
            Change plan, update your card, view invoices, or cancel in the secure
            Stripe portal.
          </p>
        </div>
      ) : (
        <div className="mt-8 border border-ink-line bg-ink-card p-6">
          <p className="text-sm text-text-sec">
            You don&rsquo;t have an active subscription yet. Choose a plan below
            to get started — Starter Monthly includes a 14-day free trial.
          </p>
          {status?.has_customer && (
            <button
              type="button"
              onClick={openPortal}
              disabled={busy === 'portal'}
              className="mt-4 inline-flex items-center gap-2 border border-ink-line px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-pri transition-colors hover:border-text-dim disabled:opacity-50"
            >
              {busy === 'portal' ? 'Opening…' : 'View billing history'}
            </button>
          )}
        </div>
      )}

      {/* This month's usage (only when on a plan with known limits) */}
      {status?.usage && status?.limits && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <UsageBar
            label="AI quotes this month"
            used={status.usage.quotesUsed}
            limit={status.limits.quotes}
            unit=""
            note="Fair-use — you’re never cut off mid-job."
          />
          <UsageBar
            label="Voice minutes this month"
            used={status.usage.voiceMinutesUsed}
            limit={status.limits.voiceMinutes}
            unit=" min"
            disabled={!status.limits.voice}
          />
        </div>
      )}

      {/* Plan chooser */}
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <div
          className="inline-flex border border-ink-line bg-ink-card p-1"
          role="group"
          aria-label="Billing period"
        >
          <ToggleButton active={!annual} onClick={() => setAnnual(false)}>
            Monthly
          </ToggleButton>
          <ToggleButton active={annual} onClick={() => setAnnual(true)}>
            Annual
          </ToggleButton>
        </div>
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-accent">
          Save ~17% — 2 months free
        </span>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent =
            hasActive && currentPlan === plan.id && status?.interval === (annual ? 'year' : 'month')
          const perMonth = annual ? annualPerMonth(plan) : plan.monthly
          return (
            <div
              key={plan.id}
              className={`flex h-full flex-col border bg-ink-card p-6 ${
                plan.featured ? 'border-accent/50' : 'border-ink-line'
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold uppercase tracking-tight text-text-pri text-lg">
                  {plan.name}
                </h3>
                {plan.featured && (
                  <span className="bg-accent px-2 py-0.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.12em] text-white">
                    Popular
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-baseline gap-1.5">
                <span
                  className={`font-mono text-3xl font-bold tabular-nums ${
                    plan.featured ? 'text-accent' : 'text-text-pri'
                  }`}
                >
                  {aud(perMonth)}
                </span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-text-dim">
                  / mo
                </span>
              </div>
              <p className="mt-1.5 text-xs text-text-sec">
                {annual
                  ? `Billed ${aud(plan.annual)}/yr · save ${aud(annualSaving(plan))}`
                  : `Billed monthly · or ${aud(plan.annual)}/yr`}
              </p>

              <button
                type="button"
                onClick={() => startCheckout(plan)}
                disabled={busy === plan.id || isCurrent}
                className={`mt-5 inline-flex items-center justify-center px-5 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 ${
                  plan.featured
                    ? 'bg-accent text-white hover:bg-accent-press'
                    : 'border border-ink-line text-text-pri hover:border-text-dim'
                }`}
              >
                {isCurrent
                  ? 'Current plan'
                  : busy === plan.id
                    ? 'Starting…'
                    : hasActive
                      ? 'Switch plan'
                      : hasFreeTrial(plan.id, annual ? 'year' : 'month')
                        ? 'Start free trial'
                        : 'Subscribe'}
              </button>

              <ul className="mt-5 grid gap-2">
                {plan.highlights.map((h) => (
                  <li
                    key={h}
                    className="flex items-baseline gap-2 text-xs leading-relaxed text-text-sec"
                  >
                    <span className="font-mono text-accent" aria-hidden="true">
                      →
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <p className="mt-6 text-xs leading-relaxed text-text-dim">
        Switching plans is prorated automatically by Stripe. We never take a cut
        of your jobs — the only fixed customer price is the $99 site visit,
        credited back to the job.
      </p>
    </div>
  )
}

function UsageBar({
  label,
  used,
  limit,
  unit,
  disabled,
  note,
}: {
  label: string
  used: number
  limit: number
  unit: string
  disabled?: boolean
  note?: string
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const over = limit > 0 && used >= limit
  return (
    <div className="border border-ink-line bg-ink-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-text-dim">
          {label}
        </span>
        <span className="font-mono text-sm tabular-nums text-text-pri">
          {disabled ? '—' : `${used}${unit} / ${limit}${unit}`}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full bg-ink-line">
        <div
          className={`h-full ${over ? 'bg-danger' : 'bg-accent'}`}
          style={{ width: `${disabled ? 0 : pct}%` }}
        />
      </div>
      {disabled ? (
        <p className="mt-2 text-[0.7rem] text-text-dim">
          Voice isn&rsquo;t included on this plan.
        </p>
      ) : note ? (
        <p className="mt-2 text-[0.7rem] text-text-dim">{note}</p>
      ) : null}
    </div>
  )
}

function StatusPill({ status }: { status: string | null }) {
  const tone =
    status === 'active'
      ? 'border-success/50 text-success'
      : status === 'trialing'
        ? 'border-accent/50 text-accent'
        : status === 'past_due' || status === 'unpaid'
          ? 'border-danger/50 text-danger'
          : 'border-ink-line text-text-dim'
  const label =
    status === 'trialing'
      ? 'On trial'
      : status
        ? status[0].toUpperCase() + status.slice(1).replace(/_/g, ' ')
        : 'Inactive'
  return (
    <span
      className={`border px-2 py-0.5 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] ${tone}`}
    >
      {label}
    </span>
  )
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-5 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
        active ? 'bg-accent text-white' : 'bg-transparent text-text-sec hover:text-text-pri'
      }`}
    >
      {children}
    </button>
  )
}
