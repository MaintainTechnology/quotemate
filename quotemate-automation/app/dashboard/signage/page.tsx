'use client'

// /dashboard/signage — the HQ signage-compliance hub (F45, Anytime Fitness, …).
//
// HQ runs a "sweep" (request photos from a set of studios), gets back
// tokenised upload links, and sees each studio's latest compliance status.
// The AI triages; HQ decides in the review queue (linked below). Maintain
// Technology design system.

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import type { ShotSlot } from '@/lib/signage/types'
import { distinctRegions, regionMatches } from '@/lib/signage/region'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from './_components/BrandTabs'
import {
  BTN_DANGER_SM,
  BTN_GHOST,
  BTN_GHOST_SM,
  BTN_PRIMARY,
  Chip,
  Crumbs,
  delay,
  EmptyState,
  FleetSnapshot,
  INPUT,
  Label,
  Notice,
  overallTone,
  REVEAL,
  SectionHeading,
  SignageNav,
  TopoBackdrop,
  type Tone,
} from './_components/ui'

type Studio = { id: string; name: string; region: string | null; state?: string | null; status: string }
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
type Brand = { slug: string; name: string; location_noun: string; location_noun_plural: string; shots: ShotDef[] }

export default function SignageHubPage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready' | 'no-org' | 'error'>('loading')
  const [studios, setStudios] = useState<Studio[]>([])
  const [sweeps, setSweeps] = useState<Sweep[]>([])
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [brands, setBrands] = useState<BrandTab[]>([])
  const [brandSlug, setBrandSlug] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [shots, setShots] = useState<Set<ShotSlot>>(new Set<ShotSlot>())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async (accessToken: string, brandParam: string | null) => {
    try {
      const headers = { Authorization: `Bearer ${accessToken}` }
      const q = brandParam ? `?brand=${encodeURIComponent(brandParam)}` : ''
      const queueSep = brandParam ? `&brand=${encodeURIComponent(brandParam)}` : ''
      const [sweepsRes, queueRes] = await Promise.all([
        fetch(`/api/signage/sweeps${q}`, { headers }),
        fetch(`/api/signage/queue?status=all${queueSep}`, { headers }),
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
      setBrands(sweepsJson.brands ?? [])
      setBrandSlug(sweepsJson.selected ?? null)
      const b: Brand | null = sweepsJson.brand ?? null
      setBrand(b)
      // Default the sweep's shot selection to all of this brand's shots.
      if (b) setShots((prev) => (prev.size > 0 ? prev : new Set(b.shots.map((s) => s.slot))))
      const queueJson = await queueRes.json().catch(() => null)
      if (queueJson?.ok) setRollup(queueJson.rollup)
      setAuthState('ready')
    } catch {
      // Network failure — say so instead of sticking on "Checking session…".
      setAuthState((s) => (s === 'ready' ? s : 'error'))
    }
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
      void load(t, brandFromUrl())
    })
  }, [load])

  // Switch brand tab: sync the URL, clear the per-brand sweep selection, reload.
  const switchBrand = useCallback(
    (slug: string) => {
      if (!token || slug === brandSlug) return
      syncBrandInUrl(slug)
      setBrandSlug(slug)
      setShots(new Set<ShotSlot>())
      setRegion('')
      void load(token, slug)
    },
    [token, brandSlug, load],
  )

  const regions = useMemo(() => distinctRegions(studios), [studios])

  const targetCount = useMemo(
    () => (region ? studios.filter((s) => regionMatches(s, region)).length : studios.length),
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
        const q = brandSlug ? `?brand=${encodeURIComponent(brandSlug)}` : ''
        const res = await fetch(`/api/signage/sweeps${q}`, {
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
          await load(token, brandSlug)
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [token, name, region, shots, brandSlug, load],
  )

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink-deep text-text-pri">
      <TopoBackdrop />

      {/* ── Header ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 sm:px-10 md:pt-20">
        <div className={REVEAL}>
          <Crumbs trail={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Signage' }]} />
        </div>
        <div className="mt-8 grid gap-8 md:grid-cols-[1.5fr_1fr] md:items-end md:gap-16">
          <h1
            className={`font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2.5rem,5.5vw,4.5rem)] ${REVEAL}`}
            style={delay(60)}
          >
            Signage <span className="text-accent">compliance</span>
          </h1>
          <p className={`max-w-md text-base leading-relaxed text-text-sec md:text-lg ${REVEAL}`} style={delay(120)}>
            Request photos from your {brand?.location_noun_plural ?? 'locations'}, let the AI pre-check them against
            the {brand?.name ?? 'brand'} standards, and review the flagged ones. The AI triages — HQ decides.
          </p>
        </div>
        <div className={`mt-10 flex flex-wrap items-center gap-x-6 gap-y-4 ${REVEAL}`} style={delay(180)}>
          <AuthBadge state={authState} />
          {authState === 'ready' && brands.length > 1 && (
            <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
          )}
        </div>
        {authState === 'ready' && (
          <div className={`mt-10 ${REVEAL}`} style={delay(220)}>
            <SignageNav active="overview" brandSlug={brandSlug} />
          </div>
        )}
      </section>

      {authState === 'ready' && (
        <>
          {/* ── Fleet snapshot ── */}
          {rollup && (
            <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 sm:px-10" aria-label="Fleet snapshot">
              <FleetSnapshot rollup={rollup} />
              <div className={`mt-6 flex flex-wrap gap-3 ${REVEAL}`} style={delay(340)}>
                <Link href={withBrand('/dashboard/signage/queue', brandSlug)} className={BTN_PRIMARY}>
                  Open review queue <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link href={withBrand('/dashboard/signage/audit', brandSlug)} className={BTN_GHOST}>
                  Instant audit <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </section>
          )}

          {/* ── New sweep ── */}
          <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6 sm:px-10">
            <SectionHeading
              eyebrow="01 · New compliance sweep"
              title="Request photos from your studios"
              hint={`Pick the shots, optionally narrow by region, and every targeted ${brand?.location_noun ?? 'location'} gets its own upload link.`}
            />
            <form onSubmit={createSweep} className="mt-7 grid gap-7 border border-ink-line bg-ink-card p-7 sm:p-9 md:grid-cols-2">
              <div>
                <Label htmlFor="sweep-name">Sweep name</Label>
                <input
                  id="sweep-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="APAC Q3 storefront audit"
                  className={INPUT}
                />
              </div>
              <div>
                <Label htmlFor="sweep-region">Region (optional — all studios if blank)</Label>
                <select id="sweep-region" value={region} onChange={(e) => setRegion(e.target.value)} className={INPUT}>
                  <option value="">All regions</option>
                  {regions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Photos to request</Label>
                <div className="flex flex-wrap gap-3">
                  {(brand?.shots ?? []).map((s) => {
                    const on = shots.has(s.slot)
                    return (
                      <label
                        key={s.slot}
                        className={`inline-flex cursor-pointer items-center gap-2 border px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.14em] transition-colors has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent ${
                          on
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-ink-line text-text-sec hover:border-accent/50 hover:text-text-pri'
                        }`}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggleShot(s.slot)} className="sr-only" />
                        <span aria-hidden="true">{on ? '✓' : '+'}</span>
                        {s.label}
                      </label>
                    )
                  })}
                </div>
              </div>
              <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-5 border-t border-ink-line pt-6">
                <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-dim">
                  Targets <span className="tabular-nums text-text-pri">{targetCount}</span> studio{targetCount === 1 ? '' : 's'} ·{' '}
                  <span className="tabular-nums text-text-pri">{shots.size}</span> shot{shots.size === 1 ? '' : 's'}
                </span>
                <button type="submit" disabled={busy || shots.size === 0 || targetCount === 0} className={BTN_PRIMARY}>
                  {busy ? 'Creating…' : <>Create sweep <span aria-hidden="true">&rarr;</span></>}
                </button>
              </div>
              {err && <p role="alert" className="md:col-span-2 text-sm text-warning-bright">{err}</p>}
            </form>
          </section>

          {/* ── Sweeps list ── */}
          <section className="relative z-10 mx-auto mt-16 max-w-6xl px-6 pb-20 sm:px-10">
            <SectionHeading eyebrow="02 · Sweeps" title={`${sweeps.length} sweep${sweeps.length === 1 ? '' : 's'}`} />
            {sweeps.length === 0 ? (
              <div className="mt-7">
                <EmptyState
                  title="No sweeps yet"
                  body="Create your first sweep above — every targeted studio gets a tokenised upload link, and the AI pre-checks whatever comes back."
                />
              </div>
            ) : (
              <div className="mt-7 grid gap-6">
                {sweeps.map((sw) => (
                  <SweepCard key={sw.id} sweep={sw} token={token} brandSlug={brandSlug} onDeleted={() => token && load(token, brandSlug)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {authState === 'error' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <Notice tone="warn">Couldn&rsquo;t load your signage data — check your connection and refresh the page.</Notice>
        </section>
      )}

      {authState === 'no-org' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <Notice tone="accent">
            <span className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">No org yet</span>
            <p className="mt-2">
              You&rsquo;re signed in, but no franchisor org is linked to your account. Seed one with{' '}
              <code className="text-text-pri">scripts/seed-signage-demo.mjs your@email</code> then reload.
            </p>
          </Notice>
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

function SweepCard({ sweep, token, brandSlug, onDeleted }: { sweep: Sweep; token: string | null; brandSlug: string | null; onDeleted: () => void }) {
  const submitted = sweep.requests.filter((r) => r.state === 'assessed' || r.state === 'submitted').length
  const pct = sweep.requests.length > 0 ? Math.round((submitted / sweep.requests.length) * 100) : 0
  const created = formatDate(sweep.created_at)
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
    <article className={`border border-ink-line bg-ink-card p-6 sm:p-7 ${REVEAL}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            Sweep · {sweep.required_shots.length} shot{sweep.required_shots.length === 1 ? '' : 's'}
            {created && <span className="text-text-dim"> · {created}</span>}
          </div>
          <h3 className="mt-1.5 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">{sweep.name}</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-text-dim">
            <span className="tabular-nums text-text-sec">{submitted}/{sweep.requests.length}</span> responded
          </span>
          <button type="button" onClick={onDelete} disabled={deleting} className={BTN_DANGER_SM}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Response progress */}
      <div
        role="img"
        aria-label={`${submitted} of ${sweep.requests.length} studios responded`}
        className="mt-4 h-1 w-full bg-ink-deep"
      >
        <div className="h-full bg-teal-glow transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-5 grid gap-2.5">
        {sweep.requests.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border border-ink-line bg-ink-deep px-4 py-3">
            <div className="flex items-center gap-3">
              <RequestChip state={r.state} overall={r.overall} />
              <span className="font-mono text-sm text-text-pri">{r.studio_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <a href={r.link} target="_blank" rel="noreferrer" className={BTN_GHOST_SM}>
                Open <span aria-hidden="true">&#8599;</span>
              </a>
              {r.assessment_id && (
                <Link
                  href={withBrand(`/dashboard/signage/queue?a=${r.assessment_id}`, brandSlug)}
                  className="inline-flex items-center justify-center bg-accent px-3 py-1.5 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-accent-press"
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

function RequestChip({ state, overall }: { state: string; overall: string | null }) {
  const { label, tone } =
    overall === 'pass' || overall === 'fix_needed' || overall === 'needs_review'
      ? overallTone(overall)
      : state === 'submitted'
        ? { label: 'Scoring…', tone: 'dim' as Tone }
        : { label: 'Awaiting', tone: 'dim' as Tone }
  return <Chip label={label} tone={tone} />
}

function formatDate(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function AuthBadge({ state }: { state: 'loading' | 'signed-out' | 'ready' | 'no-org' | 'error' }) {
  const label =
    state === 'loading' ? 'Checking session…' :
    state === 'signed-out' ? 'Not signed in — sign in to manage signage' :
    state === 'no-org' ? 'Signed in — no franchisor org linked yet' :
    state === 'error' ? 'Couldn’t load — refresh to retry' :
    'Signed in — ready'
  const dot =
    state === 'ready' ? 'bg-teal-glow motion-safe:animate-[pulse-soft_2.4s_ease-in-out_infinite]' :
    state === 'error' ? 'bg-warning-bright' :
    state === 'signed-out' || state === 'no-org' ? 'bg-accent' : 'bg-text-dim'
  return (
    <div className="inline-flex items-center gap-3 border border-ink-line bg-ink-card px-5 py-3">
      <span className={`h-2.5 w-2.5 ${dot}`} aria-hidden="true" />
      <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec">{label}</span>
    </div>
  )
}
