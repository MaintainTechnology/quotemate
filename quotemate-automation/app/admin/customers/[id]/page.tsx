'use client'

// /admin/customers/[id] — per-tenant detail + management console
// (specs/admin-customer-console.md R8–R18).
//
// Admin-gated. Shows the full tenant profile, billing block, provisioning
// ids (read-only), and the audit history. Management actions:
//   • Suspend / reactivate (typed confirm to suspend)
//   • Toggle billing_exempt (comp)
//   • Enable/disable trades
//   • Change / start a Stripe subscription (typed confirm; money path)
// Every mutation goes through a confirm step; suspend + subscription
// require typing the business name. On success the detail + audit reload.
//
// Maintain Technology design system.

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { KNOWN_TRADES, tradeLabel } from '@/lib/admin/trades'

type Customer = {
  id: string
  business_name: string | null
  owner_email: string | null
  owner_mobile: string | null
  state: string | null
  abn: string | null
  licence_type: string | null
  licence_number: string | null
  licence_expiry: string | null
  trade: string | null
  trades: string[]
  status: string | null
  twilio_sms_number: string | null
  twilio_voice_number: string | null
  vapi_assistant_id: string | null
  stripe_connect_account_id: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  subscription_plan: string | null
  subscription_interval: string | null
  subscription_current_period_end: string | null
  trial_ends_at: string | null
  subscription_cancel_at_period_end: boolean | null
  billing_exempt: boolean | null
  created_at: string | null
  activated_at: string | null
}

type AuditRow = {
  id: string
  admin_user_id: string
  action: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  created_at: string
}

type Pending = {
  title: string
  description: string
  confirmLabel: string
  requireTyped?: boolean
  run: () => Promise<void>
}

type AuthState = 'loading' | 'signed-out' | 'forbidden' | 'notfound' | 'ready'

export default function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Local edit drafts
  const [tradesDraft, setTradesDraft] = useState<string[]>([])
  const [plan, setPlan] = useState<'starter' | 'pro' | 'crew'>('starter')
  const [interval, setIntervalState] = useState<'month' | 'year'>('month')

  // Confirm modal
  const [pending, setPending] = useState<Pending | null>(null)
  const [typed, setTyped] = useState('')

  const getToken = useCallback(async (): Promise<string | null> => {
    const sb = getBrowserSupabase()
    const {
      data: { session },
    } = await sb.auth.getSession()
    return session?.access_token ?? null
  }, [])

  const load = useCallback(async () => {
    setErr(null)
    const token = await getToken()
    if (!token) {
      setAuthState('signed-out')
      return
    }
    try {
      const res = await fetch(`/api/admin/customers/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.status === 403) {
        setAuthState('forbidden')
        return
      }
      if (res.status === 404) {
        setAuthState('notfound')
        return
      }
      const json = (await res.json()) as {
        ok: boolean
        customer?: Customer
        audit?: AuditRow[]
        error?: string
      }
      if (!res.ok || !json.ok || !json.customer) {
        setErr(json.error || `HTTP ${res.status}`)
        setAuthState('ready')
        return
      }
      const c = json.customer
      setCustomer(c)
      setAudit(json.audit ?? [])
      setTradesDraft(Array.isArray(c.trades) ? c.trades : [])
      if (c.subscription_plan === 'pro' || c.subscription_plan === 'crew') setPlan(c.subscription_plan)
      else setPlan('starter')
      setIntervalState(c.subscription_interval === 'year' ? 'year' : 'month')
      setAuthState('ready')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setAuthState('ready')
    }
  }, [id, getToken])

  useEffect(() => {
    // Defer the initial fetch into a microtask (via getSession().then) so we
    // never call setState synchronously in the effect body — mirrors the
    // list page and satisfies react-hooks/set-state-in-effect. load() does
    // its own auth, so we just gate on a session existing first.
    void getBrowserSupabase()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (!session?.access_token) {
          setAuthState('signed-out')
          return
        }
        void load()
      })
  }, [load])

  // ── Mutation helpers ────────────────────────────────────────────────
  const runPatch = useCallback(
    async (body: Record<string, unknown>, successMsg: string) => {
      setBusy(true)
      setMsg(null)
      setErr(null)
      try {
        const token = await getToken()
        if (!token) {
          setErr('Not signed in')
          return
        }
        const res = await fetch(`/api/admin/customers/${id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = (await res.json()) as { ok: boolean; error?: string }
        if (!res.ok || !json.ok) {
          setErr(json.error || `HTTP ${res.status}`)
          return
        }
        setMsg(successMsg)
        await load()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [id, getToken, load],
  )

  const runSubscription = useCallback(async () => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const token = await getToken()
      if (!token) {
        setErr('Not signed in')
        return
      }
      const res = await fetch(`/api/admin/customers/${id}/subscription`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      })
      const json = (await res.json()) as { ok: boolean; action?: string; error?: string }
      if (!res.ok || !json.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        return
      }
      setMsg(
        json.action === 'start_subscription'
          ? 'Subscription started in Stripe — syncing back via webhook.'
          : 'Plan change submitted to Stripe — syncing back via webhook.',
      )
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [id, getToken, plan, interval, load])

  const tradesChanged = useMemo(() => {
    if (!customer) return false
    const a = [...tradesDraft].sort().join(',')
    const b = [...(customer.trades ?? [])].sort().join(',')
    return a !== b
  }, [tradesDraft, customer])

  const confirmPhrase = customer?.business_name || 'CONFIRM'

  const openConfirm = (p: Pending) => {
    setTyped('')
    setPending(p)
  }
  const closeConfirm = () => {
    setPending(null)
    setTyped('')
  }
  const confirmAndRun = async () => {
    if (!pending) return
    const run = pending.run
    closeConfirm()
    await run()
  }

  // ── Non-ready states ────────────────────────────────────────────────
  if (authState !== 'ready') {
    return (
      <main className="min-h-screen bg-ink-deep text-text-pri">
        <div className="mx-auto max-w-3xl px-6 pt-20 sm:px-10">
          <Breadcrumb id={id} name={null} />
          <div className="mt-10 border border-ink-line bg-ink-card px-6 py-8 text-text-sec">
            {authState === 'loading' && 'Loading customer…'}
            {authState === 'signed-out' && 'Not signed in — sign in as an admin.'}
            {authState === 'forbidden' &&
              'Your account is not an admin. This page is restricted to QuoteMax staff.'}
            {authState === 'notfound' && 'No customer found with that id.'}
          </div>
        </div>
      </main>
    )
  }

  if (!customer) {
    return (
      <main className="min-h-screen bg-ink-deep text-text-pri">
        <div className="mx-auto max-w-3xl px-6 pt-20 sm:px-10">
          <Breadcrumb id={id} name={null} />
          <div className="mt-10 border border-accent bg-ink-card px-6 py-8 text-text-sec">
            Error loading customer: {err}
          </div>
        </div>
      </main>
    )
  }

  const isSuspended = customer.status === 'suspended'
  const hasSubscription = !!customer.stripe_subscription_id

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <div className="mx-auto max-w-5xl px-6 pt-14 pb-24 sm:px-10 md:pt-20">
        <Breadcrumb id={id} name={customer.business_name} />

        <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.03em] text-[clamp(2rem,4.5vw,3.5rem)]">
            {customer.business_name || '(unnamed)'}
          </h1>
          <StatusBadge status={customer.status} />
        </div>

        {/* Banners */}
        {msg && (
          <div className="mt-6 border border-teal-glow bg-ink-card px-5 py-3 text-sm text-teal-glow">
            {msg}
          </div>
        )}
        {err && (
          <div className="mt-6 border border-accent bg-ink-card px-5 py-3 text-sm text-text-pri">
            {err}
          </div>
        )}

        {/* Profile + billing */}
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Panel title="Identity">
            <Field label="Owner email" value={customer.owner_email} />
            <Field label="Owner mobile" value={customer.owner_mobile} />
            <Field label="State" value={customer.state} />
            <Field label="ABN" value={customer.abn} />
            <Field label="Licence" value={joinLicence(customer)} />
            <Field label="Created" value={formatDate(customer.created_at)} />
            <Field label="Activated" value={formatDate(customer.activated_at)} />
          </Panel>

          <Panel title="Billing">
            <Field label="Plan" value={customer.subscription_plan ? capitalize(customer.subscription_plan) : 'None'} />
            <Field label="Interval" value={customer.subscription_interval} />
            <Field label="Subscription status" value={customer.subscription_status} />
            <Field label="Current period end" value={formatDate(customer.subscription_current_period_end)} />
            <Field label="Trial ends" value={formatDate(customer.trial_ends_at)} />
            <Field
              label="Cancels at period end"
              value={customer.subscription_cancel_at_period_end ? 'Yes' : 'No'}
            />
            <Field label="Billing exempt" value={customer.billing_exempt ? 'Yes (comped)' : 'No'} />
          </Panel>
        </div>

        <Panel title="Provisioning (read-only)" className="mt-6">
          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <Field label="Twilio SMS" value={customer.twilio_sms_number} mono />
            <Field label="Twilio voice" value={customer.twilio_voice_number} mono />
            <Field label="Vapi assistant" value={customer.vapi_assistant_id} mono />
            <Field label="Stripe customer" value={customer.stripe_customer_id} mono />
            <Field label="Stripe subscription" value={customer.stripe_subscription_id} mono />
            <Field label="Stripe Connect" value={customer.stripe_connect_account_id} mono />
          </div>
        </Panel>

        {/* ── Management ─────────────────────────────────────────────── */}
        <h2 className="mt-14 font-mono text-sm font-semibold uppercase tracking-[0.18em] text-accent">
          Manage account
        </h2>

        <div className="mt-5 grid gap-6 md:grid-cols-2">
          {/* Status */}
          <Panel title="Account status">
            <p className="mb-4 text-sm text-text-sec">
              {isSuspended
                ? 'This account is suspended. Reactivating restores it to active.'
                : 'Suspending blocks the account. Suspension requires confirmation.'}
            </p>
            {isSuspended ? (
              <ActionButton
                disabled={busy}
                onClick={() =>
                  openConfirm({
                    title: 'Reactivate account',
                    description: `Set ${customer.business_name || 'this tenant'} back to active?`,
                    confirmLabel: 'Reactivate',
                    run: () => runPatch({ action: 'set_status', status: 'active' }, 'Account reactivated.'),
                  })
                }
              >
                Reactivate account
              </ActionButton>
            ) : (
              <ActionButton
                danger
                disabled={busy}
                onClick={() =>
                  openConfirm({
                    title: 'Suspend account',
                    description: `Suspend ${customer.business_name || 'this tenant'}? Type the business name to confirm.`,
                    confirmLabel: 'Suspend',
                    requireTyped: true,
                    run: () => runPatch({ action: 'set_status', status: 'suspended' }, 'Account suspended.'),
                  })
                }
              >
                Suspend account
              </ActionButton>
            )}
          </Panel>

          {/* Billing exempt */}
          <Panel title="Billing comp">
            <p className="mb-4 text-sm text-text-sec">
              {customer.billing_exempt
                ? 'This tenant is comped — billing enforcement is bypassed.'
                : 'Comp this tenant to bypass billing enforcement (grandfather / pilot).'}
            </p>
            <ActionButton
              disabled={busy}
              onClick={() =>
                openConfirm({
                  title: customer.billing_exempt ? 'Remove comp' : 'Comp tenant',
                  description: customer.billing_exempt
                    ? 'Remove billing exemption from this tenant?'
                    : 'Mark this tenant billing-exempt (comped)?',
                  confirmLabel: customer.billing_exempt ? 'Remove comp' : 'Comp',
                  run: () =>
                    runPatch(
                      { action: 'set_billing_exempt', exempt: !customer.billing_exempt },
                      customer.billing_exempt ? 'Comp removed.' : 'Tenant comped.',
                    ),
                })
              }
            >
              {customer.billing_exempt ? 'Remove comp' : 'Mark comped'}
            </ActionButton>
          </Panel>

          {/* Trades */}
          <Panel title="Trades">
            <p className="mb-3 text-sm text-text-sec">
              Controls which trade tools show on this tenant&apos;s dashboard.
            </p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {KNOWN_TRADES.map((t) => {
                const on = tradesDraft.includes(t.slug)
                return (
                  <label
                    key={t.slug}
                    className={`flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm ${
                      on ? 'border-accent text-text-pri' : 'border-ink-line text-text-dim'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        setTradesDraft((prev) =>
                          e.target.checked
                            ? Array.from(new Set([...prev, t.slug]))
                            : prev.filter((s) => s !== t.slug),
                        )
                      }}
                      className="accent-accent"
                    />
                    {t.label}
                  </label>
                )
              })}
            </div>
            {tradesDraft.filter((t) => !KNOWN_TRADES.some((k) => k.slug === t)).length > 0 && (
              <div className="mb-4 text-xs text-text-dim">
                Other trades (preserved on save):{' '}
                {tradesDraft
                  .filter((t) => !KNOWN_TRADES.some((k) => k.slug === t))
                  .map((t) => tradeLabel(t))
                  .join(', ')}
              </div>
            )}
            <ActionButton
              disabled={busy || !tradesChanged}
              onClick={() =>
                openConfirm({
                  title: 'Update trades',
                  description: `Save the selected trades for ${customer.business_name || 'this tenant'}? This changes which tools appear on their dashboard.`,
                  confirmLabel: 'Save trades',
                  run: () => runPatch({ action: 'update_trades', trades: tradesDraft }, 'Trades updated.'),
                })
              }
            >
              {tradesChanged ? 'Save trades' : 'No changes'}
            </ActionButton>
          </Panel>

          {/* Subscription */}
          <Panel title="Subscription (Stripe)">
            <p className="mb-3 text-sm text-text-sec">
              {hasSubscription
                ? 'Change the plan/interval — applied in Stripe (prorated), then synced back.'
                : 'No subscription yet. Starting one creates a trialing subscription in Stripe.'}
            </p>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as 'starter' | 'pro' | 'crew')}
                className="border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri focus:border-accent focus:outline-none"
              >
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="crew">Crew</option>
              </select>
              <select
                value={interval}
                onChange={(e) => setIntervalState(e.target.value as 'month' | 'year')}
                className="border border-ink-line bg-ink-card px-3 py-2 text-sm text-text-pri focus:border-accent focus:outline-none"
              >
                <option value="month">Monthly</option>
                <option value="year">Annual</option>
              </select>
            </div>
            <ActionButton
              danger
              disabled={busy}
              onClick={() =>
                openConfirm({
                  title: hasSubscription ? 'Change plan' : 'Start subscription',
                  description: `${hasSubscription ? 'Change' : 'Start'} ${customer.business_name || 'this tenant'} on ${capitalize(plan)} (${interval === 'year' ? 'annual' : 'monthly'})? This calls Stripe. Type the business name to confirm.`,
                  confirmLabel: hasSubscription ? 'Change plan' : 'Start subscription',
                  requireTyped: true,
                  run: runSubscription,
                })
              }
            >
              {hasSubscription ? 'Change plan' : 'Start subscription'}
            </ActionButton>
          </Panel>
        </div>

        {/* ── Audit history ──────────────────────────────────────────── */}
        <h2 className="mt-14 font-mono text-sm font-semibold uppercase tracking-[0.18em] text-accent">
          Audit history
        </h2>
        <div className="mt-5 border border-ink-line bg-ink-card">
          {audit.length === 0 ? (
            <div className="px-6 py-8 text-sm text-text-dim">No admin actions recorded yet.</div>
          ) : (
            <ul className="divide-y divide-ink-line/60">
              {audit.map((a) => (
                <li key={a.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-semibold uppercase tracking-[0.12em] text-text-pri">
                      {a.action.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-xs text-text-dim">{formatDateTime(a.created_at)}</span>
                  </div>
                  <div className="mt-2 grid gap-1 font-mono text-xs text-text-sec sm:grid-cols-2">
                    <div>
                      <span className="text-text-dim">before:</span> {JSON.stringify(a.before)}
                    </div>
                    <div>
                      <span className="text-text-dim">after:</span> {JSON.stringify(a.after)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Confirm modal ────────────────────────────────────────────── */}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md border border-ink-line bg-ink-card p-7">
            <h3 className="font-extrabold uppercase tracking-[-0.01em] text-xl text-text-pri">
              {pending.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-text-sec">{pending.description}</p>
            {pending.requireTyped && (
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmPhrase}
                className="mt-4 w-full border border-ink-line bg-ink-deep px-4 py-3 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeConfirm}
                className="border border-ink-line px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-sec hover:border-text-dim"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmAndRun()}
                disabled={pending.requireTyped ? typed !== confirmPhrase : false}
                className="bg-accent px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function Breadcrumb({ id, name }: { id: string; name: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/admin" className="hover:text-accent">
        QuoteMax / Admin
      </Link>
      <span className="text-ink-line">/</span>
      <Link href="/admin/customers" className="hover:text-accent">
        Customers
      </Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">{name || id.slice(0, 8)}</span>
    </div>
  )
}

function Panel({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`border border-ink-line bg-ink-card p-6 ${className}`}>
      <h3 className="mb-4 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-dim">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-line/40 py-1.5 last:border-0">
      <span className="shrink-0 text-xs uppercase tracking-[0.1em] text-text-dim">{label}</span>
      <span className={`text-right text-sm text-text-pri ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {value ? value : <span className="text-text-dim">—</span>}
      </span>
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger = false,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full border px-5 py-3 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-accent text-accent hover:bg-accent hover:text-white'
          : 'border-ink-line text-text-pri hover:border-accent'
      }`}
    >
      {children}
    </button>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const tone =
    status === 'active'
      ? 'border-teal-glow text-teal-glow'
      : status === 'suspended'
        ? 'border-accent text-accent'
        : 'border-ink-line text-text-dim'
  return (
    <span
      className={`inline-block border px-3 py-1 font-mono text-xs uppercase tracking-[0.12em] ${tone}`}
    >
      {status ?? 'unknown'}
    </span>
  )
}

function joinLicence(c: Customer): string | null {
  const parts = [c.licence_type, c.licence_number].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-AU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
