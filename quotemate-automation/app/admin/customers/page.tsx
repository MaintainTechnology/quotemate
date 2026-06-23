'use client'

// /admin/customers — cross-tenant customer list for the admin customer
// console (specs/admin-customer-console.md R4–R7).
//
// Admin-gated: fetches /api/admin/customers with the Supabase access token;
// a 403 renders the "not an admin" state and never shows tenant data.
// Search + status/trade/plan filters compose in-memory (tenant count is
// small). Each row links to the per-tenant detail page.
//
// Maintain Technology design system — dark navy command-centre, orange
// accent, mono uppercase labels. See .claude/skills/maintain-design-system.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { KNOWN_TRADES, tradeLabel } from '@/lib/admin/trades'

type Customer = {
  id: string
  business_name: string | null
  trade: string | null
  trades: string[]
  status: string | null
  subscription_plan: string | null
  subscription_status: string | null
  subscription_interval: string | null
  billing_exempt: boolean
  created_at: string | null
}

type AuthState = 'loading' | 'signed-out' | 'forbidden' | 'ready'

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [err, setErr] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [tradeFilter, setTradeFilter] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')

  const load = useCallback(async (token: string) => {
    setErr(null)
    try {
      const res = await fetch('/api/admin/customers', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.status === 403) {
        setAuthState('forbidden')
        return
      }
      const json = (await res.json()) as { ok: boolean; customers?: Customer[]; error?: string }
      if (!res.ok || !json.ok) {
        setErr(json.error || `HTTP ${res.status}`)
        setAuthState('ready')
        return
      }
      setCustomers(json.customers ?? [])
      setAuthState('ready')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setAuthState('ready')
    }
  }, [])

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token
      if (!t) {
        setAuthState('signed-out')
        return
      }
      void load(t)
    })
  }, [load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return customers.filter((c) => {
      if (needle && !(c.business_name ?? '').toLowerCase().includes(needle)) return false
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (tradeFilter !== 'all' && !c.trades.includes(tradeFilter)) return false
      if (planFilter === 'none' && c.subscription_plan) return false
      if (planFilter !== 'all' && planFilter !== 'none' && c.subscription_plan !== planFilter)
        return false
      return true
    })
  }, [customers, q, statusFilter, tradeFilter, planFilter])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <TopographicBackdrop />

      <header className="relative z-10 mx-auto max-w-7xl px-6 pt-14 pb-8 sm:px-10 md:pt-20">
        <div className="flex items-center gap-3 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
          <Link href="/admin" className="hover:text-accent">
            QuoteMax / Admin
          </Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">Customers</span>
        </div>

        <div className="mt-8 grid gap-10 md:grid-cols-[1.5fr_1fr] md:items-end md:gap-16">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.5rem,5.5vw,4.75rem)]">
            <span className="text-accent">Customers</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-text-sec md:text-lg">
            Every tradie business on the platform — enabled trades, plan, and
            account status. Open a customer to manage their account.
          </p>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 sm:px-10">
        {authState === 'loading' && <Notice>Checking admin status…</Notice>}
        {authState === 'signed-out' && (
          <Notice tone="warn">Not signed in — sign in as an admin to view customers.</Notice>
        )}
        {authState === 'forbidden' && (
          <Notice tone="warn">
            Your account is not an admin. This page is restricted to QuoteMax staff.
          </Notice>
        )}
        {authState === 'ready' && err && <Notice tone="warn">Error: {err}</Notice>}

        {authState === 'ready' && !err && (
          <>
            {/* Filters */}
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search business name…"
                className="border border-ink-line bg-ink-card px-4 py-3 text-sm text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none"
              />
              <FilterSelect value={statusFilter} onChange={setStatusFilter} label="Status">
                <option value="all">All statuses</option>
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </FilterSelect>
              <FilterSelect value={tradeFilter} onChange={setTradeFilter} label="Trade">
                <option value="all">All trades</option>
                {KNOWN_TRADES.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.label}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect value={planFilter} onChange={setPlanFilter} label="Plan">
                <option value="all">All plans</option>
                <option value="none">No plan</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="crew">Crew</option>
              </FilterSelect>
            </div>

            <div className="mb-4 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
              {filtered.length} of {customers.length} customer{customers.length === 1 ? '' : 's'}
            </div>

            {filtered.length === 0 ? (
              <div className="border border-ink-line bg-ink-card px-6 py-16 text-center text-text-sec">
                {customers.length === 0
                  ? 'No customers on the platform yet.'
                  : 'No customers match your search and filters.'}
              </div>
            ) : (
              <div className="overflow-x-auto border border-ink-line bg-ink-card">
                <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink-line font-mono text-[0.7rem] uppercase tracking-[0.16em] text-text-dim">
                      <Th>Business</Th>
                      <Th>Trades</Th>
                      <Th>Status</Th>
                      <Th>Plan</Th>
                      <Th>Created</Th>
                      <Th>{''}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-ink-line/60 transition-colors hover:bg-ink-deep/40"
                      >
                        <td className="px-4 py-4 font-semibold text-text-pri">
                          {c.business_name || <span className="text-text-dim">(unnamed)</span>}
                        </td>
                        <td className="px-4 py-4">
                          {c.trades.length === 0 ? (
                            <span className="text-text-dim">— no trades</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {c.trades.map((t) => (
                                <span
                                  key={t}
                                  className="border border-ink-line px-2 py-0.5 text-xs text-text-sec"
                                >
                                  {tradeLabel(t)}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-4 py-4">
                          <PlanCell
                            plan={c.subscription_plan}
                            subStatus={c.subscription_status}
                            exempt={c.billing_exempt}
                          />
                        </td>
                        <td className="px-4 py-4 text-text-sec">{formatDate(c.created_at)}</td>
                        <td className="px-4 py-4 text-right">
                          <Link
                            href={`/admin/customers/${c.id}`}
                            className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-accent hover:underline"
                          >
                            Manage →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-semibold">{children}</th>
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
      className={`inline-block border px-2 py-0.5 font-mono text-[0.7rem] uppercase tracking-[0.12em] ${tone}`}
    >
      {status ?? 'unknown'}
    </span>
  )
}

function PlanCell({
  plan,
  subStatus,
  exempt,
}: {
  plan: string | null
  subStatus: string | null
  exempt: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-semibold text-text-pri">{plan ? capitalize(plan) : 'None'}</span>
      {subStatus && (
        <span className="font-mono text-[0.68rem] uppercase tracking-[0.1em] text-text-dim">
          {subStatus}
        </span>
      )}
      {exempt && (
        <span className="inline-block w-fit border border-teal-glow px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-teal-glow">
          Comped
        </span>
      )}
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-ink-line bg-ink-card px-4 py-3 text-sm text-text-pri focus:border-accent focus:outline-none"
      >
        {children}
      </select>
    </label>
  )
}

function Notice({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'warn'
}) {
  const cls =
    tone === 'warn'
      ? 'border-accent text-text-pri'
      : 'border-ink-line text-text-sec'
  return (
    <div className={`border ${cls} bg-ink-card px-6 py-5 text-sm`}>{children}</div>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function TopographicBackdrop() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12]"
      viewBox="0 0 1920 1080"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="topo-fade-cust" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#14B8A6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#14B8A6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="url(#topo-fade-cust)" strokeWidth="1" fill="none">
        <path d="M0,820 Q220,700 460,760 T940,720 T1420,760 T1920,700" />
        <path d="M0,700 Q220,580 460,640 T940,600 T1420,640 T1920,580" />
        <path d="M0,580 Q220,460 460,520 T940,480 T1420,520 T1920,460" />
        <path d="M0,460 Q220,340 460,400 T940,360 T1420,400 T1920,340" />
      </g>
    </svg>
  )
}
