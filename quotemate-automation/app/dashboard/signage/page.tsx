'use client'

// /dashboard/signage — F45 HQ signage-compliance hub.
//
// HQ runs a "sweep" (request photos from a set of studios), gets back
// tokenised upload links, and sees each studio's latest compliance status.
// The AI triages; HQ decides in the review queue (linked below). Maintain
// Technology design system.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import type { ShotSlot } from '@/lib/signage/types'

type Studio = { id: string; name: string; region: string | null; status: string }
type SweepRequest = {
  id: string
  studio_name: string
  token: string
  link: string
  state: string
  overall: string | null
  assessment_id: string | null
  assessment_status: string | null
}
type Sweep = {
  id: string
  name: string
  created_at: string
  required_shots: string[]
  status: string
  requests: SweepRequest[]
}
type Rollup = {
  studios: number
  assessed: number
  pass: number
  fix_needed: number
  needs_review: number
  awaiting: number
}
type ShotDef = { slot: string; label: string; instruction: string }
type Brand = { name: string; location_noun: string; location_noun_plural: string; shots: ShotDef[] }

export default function SignageHubPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready' | 'no-org'>('loading')
  const [studios, setStudios] = useState<Studio[]>([])
  const [sweeps, setSweeps] = useState<Sweep[]>([])
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)

  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [shots, setShots] = useState<Set<ShotSlot>>(new Set<ShotSlot>())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (accessToken: string) => {
    const headers = { Authorization: `Bearer ${accessToken}` }
    const [sweepsRes, queueRes] = await Promise.all([
      fetch('/api/signage/sweeps', { headers }),
      fetch('/api/signage/queue?status=all', { headers }),
    ])
    // load() only runs once we already have a session token, so a 401/!ok
    // here is NOT "signed out" — it means this signed-in account has no
    // franchisor org yet. Show the no-org state (not the sign-in prompt).
    if (sweepsRes.status === 401) {
      setAuthState('no-org')
      return
    }
    const sweepsJson = await sweepsRes.json()
    if (!sweepsJson.ok) {
      setAuthState('no-org')
      return
    }
    setStudios(sweepsJson.studios ?? [])
    setSweeps(sweepsJson.sweeps ?? [])
    const b: Brand | null = sweepsJson.brand ?? null
    setBrand(b)
    // Default the sweep's shot selection to all of this brand's shots.
    if (b) setShots((prev) => (prev.size > 0 ? prev : new Set(b.shots.map((s) => s.slot))))
    const queueJson = await queueRes.json().catch(() => null)
    if (queueJson?.ok) setRollup(queueJson.rollup)
    setAuthState('ready')
  }, [])

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (!t) {
        setAuthState('signed-out')
        return
      }
      void load(t)
    })
  }, [load])

  const regions = useMemo(() => {
    const set = new Set<string>()
    for (const s of studios) if (s.region) set.add(s.region)
    return Array.from(set).sort()
  }, [studios])

  const targetCount = useMemo(
    () => (region ? studios.filter((s) => s.region === region).length : studios.length),
    [studios, region],
  )

  const toggleShot = (slot: ShotSlot) =>
    setShots((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) next.delete(slot)
      else next.add(slot)
      return next
    })

  const createSweep = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!token) return
      setBusy(true)
      setErr(null)
      try {
        const res = await fetch('/api/signage/sweeps', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            region: region || undefined,
            required_shots: Array.from(shots),
          }),
        })
        const json = await res.json()
        if (!json.ok) {
          setErr(json.error === 'no_matching_studios' ? 'No studios match that filter.' : json.error)
        } else {
          setName('')
          await load(token)
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [token, name, region, shots, load],
  )

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 pb-8 sm:px-10 md:pt-20">
        <Breadcrumb />
        <div className="mt-8 grid gap-8 md:grid-cols-[1.5fr_1fr] md:items-end md:gap-16">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.5rem,5.5vw,4.5rem)]">
            Signage <span className="text-accent">compliance</span>
          </h1>
          <p className="max-w-md text-base leading-relaxed text-text-sec md:text-lg">
            Request photos from your {brand?.location_noun_plural ?? 'locations'}, let the AI pre-check them against
            the {brand?.name ?? 'brand'} standards, and review the flagged ones. The AI triages — HQ decides.
          </p>
        </div>
        <AuthBadge state={authState} />
      </section>

      {authState === 'ready' && (
        <>
          {/* Fleet snapshot */}
          {rollup && (
            <section className="relative z-10 mx-auto max-w-6xl px-6 sm:px-10">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
                <Stat label="Studios" value={rollup.studios} />
                <Stat label="Assessed" value={rollup.assessed} />
                <Stat label="Compliant" value={rollup.pass} tone="good" />
                <Stat label="To fix" value={rollup.fix_needed} tone="warn" />
                <Stat label="Needs review" value={rollup.needs_review} tone="accent" />
                <Stat label="Awaiting" value={rollup.awaiting} />
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/dashboard/signage/queue"
                  className="inline-flex items-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press"
                >
                  Open review queue <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link
                  href="/dashboard/signage/audit"
                  className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
                >
                  Instant audit (upload PDF / photos) <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link
                  href="/dashboard/signage/studios"
                  className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
                >
                  Manage studios <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link
                  href="/dashboard/signage/shots"
                  className="inline-flex items-center gap-2 border border-ink-line px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent"
                >
                  Edit shots <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </section>
          )}

          {/* New sweep */}
          <section className="relative z-10 mx-auto mt-12 max-w-6xl px-6 sm:px-10">
            <SectionHeading eyebrow="New compliance sweep" title="Request photos from your studios" />
            <form onSubmit={createSweep} className="mt-6 grid gap-7 border border-ink-line bg-ink-card p-7 sm:p-9 md:grid-cols-2">
              <div>
                <Label>Sweep name</Label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="APAC Q3 storefront audit"
                  className={INPUT}
                />
              </div>
              <div>
                <Label>Region (optional — all studios if blank)</Label>
                <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)} className={INPUT}>
                  <option value="">All regions</option>
                  {regions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Photos to request</Label>
                <div className="flex flex-wrap gap-3">
                  {(brand?.shots ?? []).map((s) => (
                    <label
                      key={s.slot}
                      className={`inline-flex cursor-pointer items-center gap-2 border px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors ${
                        shots.has(s.slot) ? 'border-accent text-accent' : 'border-ink-line text-text-sec hover:border-accent/50'
                      }`}
                    >
                      <input type="checkbox" checked={shots.has(s.slot)} onChange={() => toggleShot(s.slot)} className="h-4 w-4 accent-accent" />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-5 pt-2">
                <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-dim">
                  Targets {targetCount} studio{targetCount === 1 ? '' : 's'} · {shots.size} shot{shots.size === 1 ? '' : 's'}
                </span>
                <button
                  type="submit"
                  disabled={busy || shots.size === 0 || targetCount === 0}
                  className="inline-flex items-center gap-2 bg-accent px-6 py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-accent-press disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? 'Creating…' : <>Create sweep <span aria-hidden="true">&rarr;</span></>}
                </button>
              </div>
              {err && <p className="md:col-span-2 text-warning">{err}</p>}
            </form>
          </section>

          {/* Sweeps list */}
          <section className="relative z-10 mx-auto mt-12 max-w-6xl px-6 pb-20 sm:px-10">
            <SectionHeading eyebrow="Sweeps" title={`${sweeps.length} sweep${sweeps.length === 1 ? '' : 's'}`} />
            {sweeps.length === 0 && (
              <p className="mt-6 text-text-sec">No sweeps yet. Create one above to send studios their upload links.</p>
            )}
            <div className="mt-6 grid gap-6">
              {sweeps.map((sw) => (
                <SweepCard key={sw.id} sweep={sw} token={token} onDeleted={() => token && load(token)} />
              ))}
            </div>
          </section>
        </>
      )}

      {authState === 'no-org' && (
        <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20 sm:px-10">
          <div className="border border-ink-line border-l-4 border-l-accent bg-ink-card p-7">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">No org yet</div>
            <p className="mt-2 text-text-sec">
              You&rsquo;re signed in, but no franchisor org is linked to your account. Seed one with{' '}
              <code className="text-text-pri">scripts/seed-signage-demo.mjs your@email</code> then reload.
            </p>
          </div>
        </section>
      )}

      <div className="relative z-10 bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMate · Signage compliance · pre-check, not HQ approval
        </span>
      </div>
    </main>
  )
}

function SweepCard({ sweep, token, onDeleted }: { sweep: Sweep; token: string | null; onDeleted: () => void }) {
  const submitted = sweep.requests.filter((r) => r.state === 'assessed' || r.state === 'submitted').length
  const [deleting, setDeleting] = useState(false)
  const onDelete = async () => {
    if (!token) return
    if (!window.confirm(`Delete the "${sweep.name}" sweep and all its photos + results? This cannot be undone.`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/signage/sweeps/${sweep.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) onDeleted()
    } finally {
      setDeleting(false)
    }
  }
  return (
    <article className="border border-ink-line bg-ink-card p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Sweep · {sweep.required_shots.length} shots
          </div>
          <h3 className="mt-1.5 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">{sweep.name}</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim">
            {submitted}/{sweep.requests.length} responded
          </span>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="border border-ink-line px-3 py-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-text-dim transition-colors hover:border-warning hover:text-warning disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
      <div className="mt-5 grid gap-3">
        {sweep.requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border border-ink-line bg-ink-deep px-4 py-3">
            <div className="flex items-center gap-3">
              <StatusChip state={r.state} overall={r.overall} />
              <span className="font-mono text-sm text-text-pri">{r.studio_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={r.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 border border-ink-line px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-text-sec transition-colors hover:border-accent hover:text-accent"
              >
                Open <span aria-hidden="true">&#8599;</span>
              </a>
              {r.assessment_id && (
                <Link
                  href={`/dashboard/signage/queue?a=${r.assessment_id}`}
                  className="bg-accent px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-white hover:bg-accent-press"
                >
                  Review
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

function StatusChip({ state, overall }: { state: string; overall: string | null }) {
  const { label, cls } =
    overall === 'pass'
      ? { label: 'Compliant', cls: 'text-teal-glow border-teal-glow' }
      : overall === 'fix_needed'
        ? { label: 'To fix', cls: 'text-warning border-warning' }
        : overall === 'needs_review'
          ? { label: 'Needs review', cls: 'text-accent border-accent' }
          : state === 'submitted'
            ? { label: 'Scoring…', cls: 'text-text-dim border-ink-line' }
            : { label: 'Awaiting', cls: 'text-text-dim border-ink-line' }
  return (
    <span className={`border px-2.5 py-1 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] ${cls}`}>
      {label}
    </span>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'warn' | 'accent' }) {
  const colour = tone === 'good' ? 'text-teal-glow' : tone === 'warn' ? 'text-warning' : tone === 'accent' ? 'text-accent' : 'text-text-pri'
  return (
    <div className="border border-ink-line bg-ink-card p-5">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className={`mt-2 font-mono text-3xl font-bold tabular-nums ${colour}`}>{value}</div>
    </div>
  )
}

function Breadcrumb() {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/dashboard" className="transition-colors hover:text-text-pri">Dashboard</Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Signage</span>
    </div>
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</div>
      <h2 className="mt-3 font-extrabold uppercase tracking-[-0.025em] text-[clamp(1.5rem,2.6vw,2.25rem)] leading-[1.1]">{title}</h2>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{children}</div>
}

function AuthBadge({ state }: { state: 'loading' | 'signed-out' | 'ready' | 'no-org' }) {
  const label =
    state === 'loading' ? 'Checking session…' :
    state === 'signed-out' ? 'Not signed in — sign in to manage signage' :
    state === 'no-org' ? 'Signed in — no franchisor org linked yet' :
    'Signed in — ready'
  const dot = state === 'ready' ? 'bg-teal-glow' : state === 'signed-out' || state === 'no-org' ? 'bg-accent' : 'bg-text-dim'
  return (
    <div className="mt-10 inline-flex items-center gap-3 border border-ink-line bg-ink-card px-5 py-3">
      <span className={`h-2.5 w-2.5 ${dot}`} aria-hidden="true" />
      <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec">{label}</span>
    </div>
  )
}

const INPUT =
  'w-full border border-ink-line bg-ink-deep px-4 py-3 font-mono text-base text-text-pri placeholder:text-text-dim focus:border-accent focus:outline-none'
