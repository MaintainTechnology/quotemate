'use client'

// /admin/tenants — Tenant health view (spec A6).
//
// One row per tenant with per-check green/red and an overall
// Ready / Incomplete verdict, plus a global provisioning-mode banner
// (live vs stub, spec A8) so the team can confirm live provisioning is
// configured BEFORE onboarding a batch. Repair a tenant with:
//   node --env-file=.env.local scripts/verify-tenant.mjs --tenant <id> --apply
//
// Design system: Maintain (dark command-centre, orange accent).

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'

type HealthCheck = {
  key: string
  label: string
  level: 'required' | 'info'
  ok: boolean
  detail?: string
}
type TenantHealth = {
  tenantId: string
  businessName: string | null
  status: string | null
  trades: string[]
  checks: HealthCheck[]
  ready: boolean
  requiredFailures: string[]
}
type TradeReadiness = { trade: string; ready: boolean; missing: string[] }
type HealthResponse = {
  ok: boolean
  error?: string
  provisioning?: {
    twilio_mode: 'stub' | 'real'
    vapi_mode: 'stub' | 'real'
    live: boolean
    missing_for_activation: string[]
  }
  tradeReadiness?: TradeReadiness[]
  counts?: { total: number; ready: number; incomplete: number }
  tenants?: TenantHealth[]
}

export default function AdminTenantsPage() {
  const [state, setState] = useState<'loading' | 'signed-out' | 'forbidden' | 'ready' | 'error'>(
    'loading',
  )
  const [data, setData] = useState<HealthResponse | null>(null)
  const [errMsg, setErrMsg] = useState<string>('')

  async function load() {
    setState('loading')
    const sb = getBrowserSupabase()
    const {
      data: { session },
    } = await sb.auth.getSession()
    const token = session?.access_token
    if (!token) {
      setState('signed-out')
      return
    }
    try {
      const res = await fetch('/api/admin/tenant-health', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (res.status === 403) {
        setState('forbidden')
        return
      }
      const json = (await res.json()) as HealthResponse
      if (!json.ok) {
        setErrMsg(json.error ?? 'request failed')
        setState('error')
        return
      }
      setData(json)
      setState('ready')
    } catch (e: any) {
      setErrMsg(e?.message ?? 'network error')
      setState('error')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-7xl px-6 pt-16 pb-10 sm:px-10 md:pt-20">
        <div className="flex items-center gap-3 font-mono text-[0.75rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
          <Link href="/admin" className="hover:text-text-pri">
            QuoteMax / Admin
          </Link>
          <span className="text-ink-line">/</span>
          <span className="text-text-pri">Tenant health</span>
        </div>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.25rem,5vw,4rem)]">
            Tenant <span className="text-accent">health</span>
          </h1>
          <button
            type="button"
            onClick={() => void load()}
            className="border border-ink-line bg-ink-card px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:border-accent hover:text-text-pri"
          >
            Refresh
          </button>
        </div>

        {state === 'loading' && <Note>Checking tenant health…</Note>}
        {state === 'signed-out' && <Note tone="warn">Sign in as an admin to view tenant health.</Note>}
        {state === 'forbidden' && <Note tone="warn">Signed in, but not an admin (this endpoint returns 403).</Note>}
        {state === 'error' && <Note tone="warn">Failed to load: {errMsg}</Note>}

        {state === 'ready' && data && (
          <>
            <ProvisioningBanner provisioning={data.provisioning} />
            <TradeReadinessStrip readiness={data.tradeReadiness ?? []} />
            <CountsStrip counts={data.counts} />
            <div className="mt-8 space-y-4">
              {(data.tenants ?? []).map((t) => (
                <TenantCard key={t.tenantId} t={t} />
              ))}
              {(data.tenants ?? []).length === 0 && <Note>No tenants found.</Note>}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

function ProvisioningBanner({
  provisioning,
}: {
  provisioning: HealthResponse['provisioning']
}) {
  if (!provisioning) return null
  const live = provisioning.live
  return (
    <div
      className={`mt-8 border px-6 py-5 ${
        live ? 'border-teal-glow bg-ink-card' : 'border-accent bg-accent/10'
      }`}
    >
      <div className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
        {live ? (
          <span className="text-teal-glow">● Provisioning is LIVE — real Twilio + Vapi</span>
        ) : (
          <span className="text-accent">
            ▲ Provisioning is in STUB mode — onboarded tenants will NOT receive real calls/SMS
          </span>
        )}
      </div>
      <div className="mt-2 font-mono text-xs text-text-sec">
        Twilio: {provisioning.twilio_mode} · Vapi: {provisioning.vapi_mode}
        {provisioning.missing_for_activation.length > 0 && (
          <> · Missing: {provisioning.missing_for_activation.join(', ')}</>
        )}
      </div>
      {!live && (
        <div className="mt-2 text-sm text-text-sec">
          Set <code className="text-accent">TWILIO_PROVISIONING_ENABLED=true</code> and{' '}
          <code className="text-accent">VAPI_PROVISIONING_ENABLED=true</code> (plus their
          credentials) before onboarding real tradies.
        </div>
      )}
    </div>
  )
}

function TradeReadinessStrip({ readiness }: { readiness: TradeReadiness[] }) {
  if (readiness.length === 0) return null
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      {readiness.map((r) => (
        <div
          key={r.trade}
          title={r.ready ? 'Onboardable' : `Not ready: ${r.missing.join('; ')}`}
          className={`inline-flex items-center gap-2 border px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] ${
            r.ready ? 'border-teal-glow text-teal-glow' : 'border-ink-line text-text-dim'
          }`}
        >
          <Dot ok={r.ready} />
          {r.trade}
        </div>
      ))}
    </div>
  )
}

function CountsStrip({ counts }: { counts?: { total: number; ready: number; incomplete: number } }) {
  if (!counts) return null
  return (
    <div className="mt-6 flex gap-6 font-mono text-sm">
      <span className="text-text-sec">
        Total: <span className="text-text-pri">{counts.total}</span>
      </span>
      <span className="text-text-sec">
        Ready: <span className="text-teal-glow">{counts.ready}</span>
      </span>
      <span className="text-text-sec">
        Incomplete: <span className="text-accent">{counts.incomplete}</span>
      </span>
    </div>
  )
}

function TenantCard({ t }: { t: TenantHealth }) {
  return (
    <div className="border border-ink-line bg-ink-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-extrabold uppercase tracking-[-0.01em] text-lg">
            {t.businessName ?? '(no name)'}
          </div>
          <div className="mt-1 font-mono text-xs text-text-dim">
            {t.tenantId} · {t.trades.join(' + ') || 'no trades'} · status {t.status ?? 'null'}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-2 border px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] ${
            t.ready ? 'border-teal-glow text-teal-glow' : 'border-accent text-accent'
          }`}
        >
          <Dot ok={t.ready} />
          {t.ready ? 'Ready' : 'Incomplete'}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {t.checks.map((c) => (
          <div key={c.key} className="flex items-start gap-2 text-sm">
            <span className="pt-0.5">
              <Dot ok={c.ok} muted={c.level === 'info'} />
            </span>
            <span>
              <span className={c.ok ? 'text-text-sec' : 'text-text-pri'}>
                {c.label}
                {c.level === 'info' && <span className="text-text-dim"> (info)</span>}
              </span>
              {c.detail && <span className="block font-mono text-xs text-text-dim">{c.detail}</span>}
            </span>
          </div>
        ))}
      </div>

      {!t.ready && (
        <div className="mt-4 border-t border-ink-line pt-3 font-mono text-xs text-text-dim">
          Repair:{' '}
          <code className="text-text-sec">
            node --env-file=.env.local scripts/verify-tenant.mjs --tenant {t.tenantId} --apply
          </code>
        </div>
      )}
    </div>
  )
}

function Dot({ ok, muted = false }: { ok: boolean; muted?: boolean }) {
  const cls = ok ? (muted ? 'bg-text-dim' : 'bg-teal-glow') : 'bg-accent'
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} aria-hidden="true" />
}

function Note({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' }) {
  return (
    <div
      className={`mt-8 inline-flex items-center gap-3 border px-5 py-3 font-mono text-sm tracking-[0.04em] ${
        tone === 'warn' ? 'border-accent text-accent' : 'border-ink-line text-text-sec'
      }`}
    >
      {children}
    </div>
  )
}
