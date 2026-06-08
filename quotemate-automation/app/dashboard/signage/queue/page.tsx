'use client'

// /dashboard/signage/queue — the HQ review queue + per-studio fleet view.
//
// The AI has triaged; this is where a human decides. Each flagged
// assessment opens to its per-rule verdicts, the submitted photos, and
// approve / needs-changes / escalate actions. Maintain design system.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from '../_components/BrandTabs'

type QueueItem = {
  id: string
  studio_name: string
  region: string | null
  status: string
  overall: string | null
  counts: { compliant: number; fix: number; review: number } | null
  hq_decision: string | null
  created_at: string
}
type FleetRow = {
  studio_id: string
  studio_name: string
  region: string | null
  latest_overall: string | null
  latest_status: string | null
  assessment_id: string | null
}
type Rollup = { studios: number; assessed: number; pass: number; fix_needed: number; needs_review: number; awaiting: number }

type ProvStage = 'agreed' | 'conflict' | 'db_only' | 'kb_only' | null
type Verdict = {
  rule_key: string
  status: 'compliant' | 'non_compliant' | 'cannot_determine'
  confidence: string
  evidence: string
  red_flags: string[]
  rule_text: string
  rule_group: string
  applicability: string
  source_citation: string | null
  // Two-stage provenance (null when Step 2 didn't run).
  stage: ProvStage
  kb_status: 'compliant' | 'non_compliant' | 'cannot_determine' | 'absent' | null
  kb_note: string | null
  kb_citation: string | null
}
type Advisory = { shot: string; description: string; citation: string | null; store: string }
type Detail = {
  assessment: {
    id: string
    status: string
    overall: string | null
    counts: { compliant: number; fix: number; review: number } | null
    hq_decision: string | null
    hq_note: string | null
    studio_name: string
    region: string | null
    kb_degraded: boolean
    kb_stores: string[]
  }
  verdicts: Verdict[]
  advisory: Advisory[]
  photos: Array<{ shot_slot: string; url: string | null }>
}

export default function SignageQueuePage() {
  const [token, setToken] = useState<string | null>(null)
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'ready'>('loading')
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [fleet, setFleet] = useState<FleetRow[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [brands, setBrands] = useState<BrandTab[]>([])
  const [brandSlug, setBrandSlug] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)

  const load = useCallback(async (accessToken: string, brandParam: string | null) => {
    const brandSep = brandParam ? `&brand=${encodeURIComponent(brandParam)}` : ''
    const res = await fetch(`/api/signage/queue?status=hq_review${brandSep}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (res.status === 401) {
      setAuthState('signed-out')
      return
    }
    const json = await res.json()
    if (json.ok) {
      setRollup(json.rollup)
      setFleet(json.fleet ?? [])
      setQueue(json.queue ?? [])
      setBrands(json.brands ?? [])
      setBrandSlug(json.selected ?? null)
      setAuthState('ready')
    }
  }, [])

  const openDetail = useCallback(
    async (assessmentId: string, accessToken: string) => {
      setSelected(assessmentId)
      setDetailBusy(true)
      setDetail(null)
      try {
        const res = await fetch(`/api/signage/assessment/${assessmentId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        const json = await res.json()
        if (json.ok) setDetail({ assessment: json.assessment, verdicts: json.verdicts, advisory: json.advisory ?? [], photos: json.photos })
      } finally {
        setDetailBusy(false)
      }
    },
    [],
  )

  useEffect(() => {
    const sb = getBrowserSupabase()
    sb.auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      if (!t) {
        setAuthState('signed-out')
        return
      }
      void load(t, brandFromUrl()).then(() => {
        const pre = new URLSearchParams(window.location.search).get('a')
        if (pre) void openDetail(pre, t)
      })
    })
  }, [load, openDetail])

  const switchBrand = useCallback(
    (slug: string) => {
      if (!token || slug === brandSlug) return
      syncBrandInUrl(slug)
      setBrandSlug(slug)
      setSelected(null)
      setDetail(null)
      void load(token, slug)
    },
    [token, brandSlug, load],
  )

  const decide = useCallback(
    async (decision: 'approved' | 'needs_changes' | 'escalated') => {
      if (!token || !detail) return
      setDetailBusy(true)
      try {
        const res = await fetch(`/api/signage/assessment/${detail.assessment.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hq_decision: decision }),
        })
        const json = await res.json()
        if (json.ok) {
          await load(token, brandSlug)
          await openDetail(detail.assessment.id, token)
        }
      } finally {
        setDetailBusy(false)
      }
    },
    [token, detail, brandSlug, load, openDetail],
  )

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-14 pb-6 sm:px-10 md:pt-16">
        <Breadcrumb brandSlug={brandSlug} />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <h1 className="font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.5rem)]">
            Review <span className="text-accent">queue</span>
          </h1>
          <Link href={withBrand('/dashboard/signage', brandSlug)} className="font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-sec hover:text-accent">
            ← Back to sweeps
          </Link>
        </div>
        {authState === 'ready' && brands.length > 1 && (
          <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
        )}
        {rollup && (
          <div className="mt-7 grid grid-cols-2 gap-4 md:grid-cols-6">
            <Stat label="Studios" value={rollup.studios} />
            <Stat label="Assessed" value={rollup.assessed} />
            <Stat label="Compliant" value={rollup.pass} tone="good" />
            <Stat label="To fix" value={rollup.fix_needed} tone="warn" />
            <Stat label="Needs review" value={rollup.needs_review} tone="accent" />
            <Stat label="Awaiting" value={rollup.awaiting} />
          </div>
        )}
      </section>

      {authState === 'signed-out' && (
        <section className="relative z-10 mx-auto max-w-7xl px-6 pb-20 sm:px-10">
          <p className="text-text-sec">Sign in to view the review queue.</p>
        </section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto max-w-7xl px-6 pb-24 sm:px-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
            {/* Left: queue + fleet */}
            <div>
              <h2 className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">Needs your attention</h2>
              <div className="mt-4 grid gap-3">
                {queue.length === 0 && <p className="text-text-sec">Nothing in the queue — every assessed studio is clear or resolved.</p>}
                {queue.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => token && openDetail(q.id, token)}
                    className={`w-full border bg-ink-card p-4 text-left transition-colors ${
                      selected === q.id ? 'border-accent' : 'border-ink-line hover:border-accent/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm text-text-pri">{q.studio_name}</span>
                      <OverallChip overall={q.overall} />
                    </div>
                    {q.counts && (
                      <div className="mt-2 font-mono text-[0.72rem] uppercase tracking-[0.12em] text-text-dim">
                        {q.counts.compliant} ok · {q.counts.fix} fix · {q.counts.review} review
                      </div>
                    )}
                  </button>
                ))}
              </div>

              <h2 className="mt-10 font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">Fleet</h2>
              <div className="mt-4 grid gap-2">
                {fleet.map((f) => (
                  <button
                    key={f.studio_id}
                    type="button"
                    disabled={!f.assessment_id}
                    onClick={() => f.assessment_id && token && openDetail(f.assessment_id, token)}
                    className="flex items-center justify-between gap-3 border border-ink-line bg-ink-deep px-4 py-2.5 text-left disabled:opacity-60 enabled:hover:border-accent/50"
                  >
                    <span className="font-mono text-sm text-text-pri">
                      {f.studio_name}
                      {f.region && <span className="text-text-dim"> · {f.region}</span>}
                    </span>
                    <OverallChip overall={f.latest_overall} compact />
                  </button>
                ))}
              </div>
            </div>

            {/* Right: detail */}
            <div className="border border-ink-line bg-ink-card p-6 sm:p-7">
              {!detail && !detailBusy && (
                <p className="text-text-sec">Select a studio to see its per-rule verdicts and photos.</p>
              )}
              {detailBusy && !detail && <p className="text-text-sec">Loading…</p>}
              {detail && <DetailPanel detail={detail} busy={detailBusy} onDecide={decide} />}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

function DetailPanel({
  detail,
  busy,
  onDecide,
}: {
  detail: Detail
  busy: boolean
  onDecide: (d: 'approved' | 'needs_changes' | 'escalated') => void
}) {
  const { assessment, verdicts, advisory, photos } = detail
  const groups = Array.from(new Set(verdicts.map((v) => v.rule_group)))
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {assessment.region ?? 'Studio'}
          </div>
          <h3 className="mt-1 font-extrabold uppercase tracking-[-0.02em] text-2xl text-text-pri">{assessment.studio_name}</h3>
        </div>
        <OverallChip overall={assessment.overall} />
      </div>

      {assessment.hq_decision && (
        <div className="mt-3 inline-block border border-ink-line border-l-4 border-l-teal-glow bg-ink-deep px-3 py-1.5 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-teal-glow">
          HQ: {assessment.hq_decision.replace('_', ' ')}
        </div>
      )}

      {assessment.kb_degraded && (
        <div className="mt-3 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-3 py-2 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-warning">
          ⚠ The second-stage brand-standards check did not complete for this assessment — verdicts are Step-1 (database) only.
        </div>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-3">
          {photos.map((p, i) =>
            p.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block">
                <img src={p.url} alt={p.shot_slot} className="h-24 w-32 border border-ink-line object-cover" />
                <span className="mt-1 block font-mono text-[0.64rem] uppercase tracking-[0.12em] text-text-dim">{p.shot_slot}</span>
              </a>
            ) : null,
          )}
        </div>
      )}

      {/* Verdicts grouped */}
      <div className="mt-6 grid gap-5">
        {groups.map((g) => (
          <div key={g}>
            <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{prettyGroup(g)}</div>
            <div className="mt-2 grid gap-2">
              {verdicts
                .filter((v) => v.rule_group === g)
                .sort((a, b) => rank(a.status) - rank(b.status))
                .map((v) => (
                  <div key={v.rule_key} className="border border-ink-line bg-ink-deep px-4 py-3">
                    <div className="flex items-start gap-3">
                      <VerdictIcon status={v.status} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-text-pri">{v.rule_text}</p>
                          <StageBadge stage={v.stage} />
                        </div>
                        {v.evidence && <p className="mt-1 text-xs text-text-sec">{v.evidence}</p>}
                        {v.kb_note && (
                          <p className="mt-1 text-xs text-accent">
                            ◇ {v.kb_note}
                            {v.kb_citation && <span className="text-text-dim"> · {v.kb_citation}</span>}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-2 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">
                          {v.source_citation && <span>{v.source_citation}</span>}
                          {v.applicability !== 'auto_vision' && <span>· auto-downgraded ({v.applicability.replace(/_/g, ' ')})</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Advisory — Step-2-only brand-standard observations */}
      {advisory.length > 0 && (
        <div className="mt-6">
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">Other observations</div>
          <div className="mt-2 grid gap-2">
            {advisory.map((a, i) => (
              <div key={i} className="border border-ink-line bg-ink-deep px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="text-accent" aria-label="advisory">◇</span>
                  <div className="min-w-0">
                    <p className="text-sm text-text-pri">{a.description}</p>
                    <div className="mt-1 flex flex-wrap gap-2 font-mono text-[0.62rem] uppercase tracking-[0.1em] text-text-dim">
                      <span>{a.shot}</span>
                      {a.citation && <span>· {a.citation}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decision */}
      <div className="mt-7 flex flex-wrap gap-3 border-t border-ink-line pt-6">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide('approved')}
          className="bg-teal-glow px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-ink-deep transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide('needs_changes')}
          className="bg-warning px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-ink-deep transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Needs changes
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide('escalated')}
          className="border border-ink-line px-5 py-3 font-mono text-sm font-semibold uppercase tracking-[0.14em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Escalate
        </button>
      </div>
      <p className="mt-3 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-text-dim">
        The AI flags; HQ decides. Approving does not auto-notify the studio.
      </p>
    </div>
  )
}

function VerdictIcon({ status }: { status: Verdict['status'] }) {
  if (status === 'compliant') return <span className="text-teal-glow" aria-label="compliant">✓</span>
  if (status === 'non_compliant') return <span className="text-warning" aria-label="non-compliant">✕</span>
  return <span className="text-accent" aria-label="needs review">◑</span>
}

// How the two stages combined for this rule (null when Step 2 didn't run).
function StageBadge({ stage }: { stage: ProvStage }) {
  if (!stage) return null
  const map: Record<Exclude<ProvStage, null>, { label: string; cls: string }> = {
    agreed: { label: 'DB + file store agree', cls: 'text-teal-glow border-teal-glow' },
    conflict: { label: 'Stages disagree', cls: 'text-warning border-warning' },
    kb_only: { label: 'File-store flag', cls: 'text-accent border-accent' },
    db_only: { label: 'DB only', cls: 'text-text-dim border-ink-line' },
  }
  const { label, cls } = map[stage]
  return (
    <span className={`border px-1.5 py-0.5 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.1em] ${cls}`}>
      {label}
    </span>
  )
}

function OverallChip({ overall, compact }: { overall: string | null; compact?: boolean }) {
  const { label, cls } =
    overall === 'pass'
      ? { label: 'Compliant', cls: 'text-teal-glow border-teal-glow' }
      : overall === 'fix_needed'
        ? { label: 'To fix', cls: 'text-warning border-warning' }
        : overall === 'needs_review'
          ? { label: 'Needs review', cls: 'text-accent border-accent' }
          : { label: 'Not assessed', cls: 'text-text-dim border-ink-line' }
  return (
    <span className={`border px-2.5 py-1 font-mono ${compact ? 'text-[0.62rem]' : 'text-[0.68rem]'} font-semibold uppercase tracking-[0.12em] ${cls}`}>
      {label}
    </span>
  )
}

function rank(s: Verdict['status']): number {
  return s === 'non_compliant' ? 0 : s === 'cannot_determine' ? 1 : 2
}
function prettyGroup(g: string): string {
  return g.split(/[-_]/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
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

function Breadcrumb({ brandSlug }: { brandSlug: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-text-dim">
      <Link href="/dashboard" className="transition-colors hover:text-text-pri">Dashboard</Link>
      <span className="text-ink-line">/</span>
      <Link href={withBrand('/dashboard/signage', brandSlug)} className="transition-colors hover:text-text-pri">Signage</Link>
      <span className="text-ink-line">/</span>
      <span className="text-text-pri">Queue</span>
    </div>
  )
}
