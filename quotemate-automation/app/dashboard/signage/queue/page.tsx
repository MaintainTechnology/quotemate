'use client'

// /dashboard/signage/queue — the HQ review queue + per-studio fleet view.
//
// The AI has triaged; this is where a human decides. Each flagged
// assessment opens to its per-rule verdicts, the submitted photos, and
// approve / needs-changes / escalate actions. Maintain design system.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken } from '@/lib/auth/client-token'
import { BrandTabs, withBrand, brandFromUrl, syncBrandInUrl, type BrandTab } from '../_components/BrandTabs'
import {
  ComplianceBar,
  Crumbs,
  delay,
  EmptyState,
  FleetSnapshot,
  Lightbox,
  Notice,
  OverallChip,
  severityBorder,
  REVEAL,
  SignageNav,
  StateGlyph,
  TopoBackdrop,
} from '../_components/ui'
import { StatusPill, type Tone } from '../../_components/quote-ui'

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
  const [authState, setAuthState] = useState<'loading' | 'signed-out' | 'error' | 'ready'>('loading')
  const [rollup, setRollup] = useState<Rollup | null>(null)
  const [fleet, setFleet] = useState<FleetRow[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [brands, setBrands] = useState<BrandTab[]>([])
  const [brandSlug, setBrandSlug] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (accessToken: string, brandParam: string | null) => {
    try {
      const freshToken = (await getAuthToken()) ?? accessToken
      const brandSep = brandParam ? `&brand=${encodeURIComponent(brandParam)}` : ''
      const res = await fetch(`/api/signage/queue?status=hq_review${brandSep}`, {
        headers: { Authorization: `Bearer ${freshToken}` },
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
      } else {
        // Don't blank a working page on a failed background refresh.
        setAuthState((s) => (s === 'ready' ? s : 'error'))
      }
    } catch {
      setAuthState((s) => (s === 'ready' ? s : 'error'))
    }
  }, [])

  const openDetail = useCallback(
    async (assessmentId: string, accessToken: string) => {
      setSelected(assessmentId)
      // Keep the selection shareable + refresh-safe.
      const url = new URL(window.location.href)
      url.searchParams.set('a', assessmentId)
      window.history.replaceState(null, '', url.toString())
      // Below lg the detail panel sits under both lists — bring it on screen.
      if (window.matchMedia('(max-width: 1023px)').matches) {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      setDetailBusy(true)
      setDetail(null)
      try {
        const freshToken = (await getAuthToken()) ?? accessToken
        const res = await fetch(`/api/signage/assessment/${assessmentId}`, {
          headers: { Authorization: `Bearer ${freshToken}` },
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
    getAuthToken().then((t) => {
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
      // Drop the stale deep-link param — it points at the previous brand.
      const url = new URL(window.location.href)
      url.searchParams.delete('a')
      window.history.replaceState(null, '', url.toString())
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
        const freshToken = (await getAuthToken()) ?? token
        const res = await fetch(`/api/signage/assessment/${detail.assessment.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${freshToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ hq_decision: decision }),
        })
        const json = await res.json()
        if (json.ok) {
          await Promise.all([load(token, brandSlug), openDetail(detail.assessment.id, token)])
        }
      } finally {
        setDetailBusy(false)
      }
    },
    [token, detail, brandSlug, load, openDetail],
  )

  return (
    // overflow-x-clip (not -hidden) so the lg:sticky detail panel still sticks.
    <main className="relative min-h-screen overflow-x-clip bg-ink-deep text-text-pri">
      <TopoBackdrop />

      <section className="relative z-10 mx-auto max-w-6xl px-6 pt-14 sm:px-10 md:pt-16">
        <div className={REVEAL}>
          <Crumbs
            trail={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Signage', href: withBrand('/dashboard/signage', brandSlug) },
              { label: 'Queue' },
            ]}
          />
        </div>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <h1 className={`font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,4.5vw,3.25rem)] ${REVEAL}`} style={delay(60)}>
            Review <span className="text-accent">queue</span>
          </h1>
          {authState === 'ready' && brands.length > 1 && (
            <div className={REVEAL} style={delay(120)}>
              <BrandTabs brands={brands} selected={brandSlug} onSelect={switchBrand} />
            </div>
          )}
        </div>
        {authState === 'ready' && (
          <div className={`mt-8 ${REVEAL}`} style={delay(160)}>
            <SignageNav active="queue" brandSlug={brandSlug} />
          </div>
        )}
        {rollup && (
          <div className="mt-8">
            <FleetSnapshot rollup={rollup} />
          </div>
        )}
      </section>

      {authState === 'signed-out' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <p className="text-text-sec">Sign in to view the review queue.</p>
        </section>
      )}

      {authState === 'error' && (
        <section className="relative z-10 mx-auto mt-10 max-w-6xl px-6 pb-20 sm:px-10">
          <Notice tone="warn">Couldn&rsquo;t load the review queue — check your connection and refresh the page.</Notice>
        </section>
      )}

      {authState === 'ready' && (
        <section className="relative z-10 mx-auto mt-12 max-w-6xl px-6 pb-24 sm:px-10">
          <div className="grid items-start gap-8 lg:grid-cols-[1fr_1.4fr]">
            {/* Left: queue + fleet */}
            <div>
              <h2 className=" text-[0.8rem] font-semibold uppercase tracking-[0.08em] text-accent">Needs your attention</h2>
              <div className="mt-4 grid gap-3">
                {queue.length === 0 ? (
                  <EmptyState
                    title="Queue clear"
                    body="Every assessed studio is compliant or already resolved. New flags land here the moment the AI scores a submission."
                  />
                ) : (
                  queue.map((q, i) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => token && openDetail(q.id, token)}
                      aria-pressed={selected === q.id ? 'true' : 'false'}
                      className={`rounded-card w-full border bg-ink-card p-4 text-left transition-colors ${REVEAL} ${
                        selected === q.id ? 'border-accent' : 'border-ink-line hover:border-accent/50'
                      }`}
                      style={delay(Math.min(i, 8) * 40)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm text-text-pri">{q.studio_name}</span>
                        <OverallChip overall={q.overall} />
                      </div>
                      {q.counts && (
                        <>
                          <div className="mt-3">
                            <ComplianceBar size="sm" legend={false} pass={q.counts.compliant} fix={q.counts.fix} review={q.counts.review} />
                          </div>
                          <div className="mt-2 text-[0.7rem] uppercase tracking-[0.08em] text-text-dim" aria-hidden="true">
                            <span className="tabular-nums">{q.counts.compliant}</span> compliant · <span className="tabular-nums">{q.counts.fix}</span> to fix ·{' '}
                            <span className="tabular-nums">{q.counts.review}</span> review
                          </div>
                        </>
                      )}
                    </button>
                  ))
                )}
              </div>

              <h2 className="mt-12 text-[0.8rem] font-semibold uppercase tracking-[0.08em] text-accent">Fleet</h2>
              <div className="mt-4 grid gap-2">
                {fleet.map((f) => (
                  <button
                    key={f.studio_id}
                    type="button"
                    disabled={!f.assessment_id}
                    onClick={() => f.assessment_id && token && openDetail(f.assessment_id, token)}
                    aria-pressed={selected !== null && selected === f.assessment_id ? 'true' : 'false'}
                    className={`rounded-card flex items-center justify-between gap-3 border px-4 py-2.5 text-left transition-colors disabled:opacity-60 enabled:hover:border-accent/50 ${
                      selected !== null && selected === f.assessment_id
                        ? 'border-accent bg-ink-card'
                        : 'border-ink-line bg-ink-deep'
                    }`}
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
            {/* 68px offsets = the layout's h-11 dashboard bar + the original 24px gap. */}
            <div ref={detailRef} className="rounded-card scroll-mt-[68px] border border-ink-line bg-ink-card p-6 sm:p-7 lg:sticky lg:top-[68px]">
              {!detail && !detailBusy && (
                <EmptyState
                  title="No studio selected"
                  body="Select a studio on the left to see its per-rule verdicts, submitted photos, and HQ decision actions."
                />
              )}
              {detailBusy && !detail && (
                <p className="text-text-sec">
                  <span className="mr-2 inline-block h-2.5 w-2.5 bg-accent motion-safe:animate-[pulse-soft_1.6s_ease-in-out_infinite]" aria-hidden="true" />
                  Loading assessment…
                </p>
              )}
              {detail && <DetailPanel detail={detail} busy={detailBusy} onDecide={decide} onView={setLightbox} />}
            </div>
          </div>
        </section>
      )}

      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />}
    </main>
  )
}

function DetailPanel({
  detail,
  busy,
  onDecide,
  onView,
}: {
  detail: Detail
  busy: boolean
  onDecide: (d: 'approved' | 'needs_changes' | 'escalated') => void
  onView: (img: { src: string; alt: string }) => void
}) {
  const { assessment, verdicts, advisory, photos } = detail
  const groups = Array.from(new Set(verdicts.map((v) => v.rule_group)))
  return (
    <div className={REVEAL}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className=" text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-accent">
            {assessment.region ?? 'Studio'}
          </div>
          <h3 className="mt-1 font-extrabold uppercase tracking-[-0.02em] text-2xl text-text-pri">{assessment.studio_name}</h3>
        </div>
        <OverallChip overall={assessment.overall} />
      </div>

      {assessment.hq_decision && (
        <div className="mt-3">
          <StatusPill
            label={`HQ: ${assessment.hq_decision.replace('_', ' ')}`}
            tone={
              assessment.hq_decision === 'approved'
                ? 'success'
                : assessment.hq_decision === 'escalated'
                  ? 'danger'
                  : 'warn'
            }
            dot
          />
        </div>
      )}

      {assessment.kb_degraded && (
        <div className="rounded-card mt-3 border border-warning-bright/40 bg-ink-deep px-3 py-2 text-[0.7rem] uppercase tracking-[0.08em] text-warning-bright">
          ⚠ The second-stage brand-standards check did not complete for this assessment — verdicts are Step-1 (database) only.
        </div>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <div className="mt-6">
          <div className=" text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">Submitted photos</div>
          <div className="mt-2.5 flex flex-wrap gap-3">
            {photos.map((p, i) =>
              p.url ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onView({ src: p.url as string, alt: prettyGroup(p.shot_slot) })}
                  className="group block text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={prettyGroup(p.shot_slot)}
                    className="h-24 w-32 border border-ink-line object-cover transition-[border-color,opacity] group-hover:border-accent group-hover:opacity-90"
                  />
                  <span className="mt-1 block text-[0.64rem] uppercase tracking-[0.08em] text-text-dim group-hover:text-text-sec">
                    {p.shot_slot}
                  </span>
                </button>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* Verdicts grouped */}
      <div className="mt-7 grid gap-6">
        {groups.map((g) => (
          <div key={g}>
            <div className=" text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">{prettyGroup(g)}</div>
            <div className="mt-2 grid gap-2">
              {verdicts
                .filter((v) => v.rule_group === g)
                .sort((a, b) => rank(a.status) - rank(b.status))
                .map((v) => (
                  <div key={v.rule_key} className={`rounded-card border bg-ink-deep px-4 py-3 ${severityBorder(glyphState(v.status))}`}>
                    <div className="flex items-start gap-3">
                      <StateGlyph state={glyphState(v.status)} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-text-pri">{v.rule_text}</p>
                          <StageBadge stage={v.stage} />
                        </div>
                        {v.evidence && <p className="mt-1 text-xs leading-relaxed text-text-sec">{v.evidence}</p>}
                        {v.kb_note && (
                          <p className="mt-1 text-xs text-accent">
                            ◇ {v.kb_note}
                            {v.kb_citation && <span className="text-text-dim"> · {v.kb_citation}</span>}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-2 text-[0.62rem] uppercase tracking-[0.08em] text-text-dim">
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
        <div className="mt-7">
          <div className=" text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">Other observations</div>
          <div className="mt-2 grid gap-2">
            {advisory.map((a, i) => (
              <div key={i} className="rounded-card border border-ink-line bg-ink-deep px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="text-accent" aria-hidden="true">◇</span>
                  <div className="min-w-0">
                    <p className="text-sm text-text-pri">{a.description}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-[0.62rem] uppercase tracking-[0.08em] text-text-dim">
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
      <div className="mt-8 flex flex-wrap gap-3 border-t border-ink-line pt-6">
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onDecide('approved')}
          className="inline-flex items-center justify-center bg-teal-glow px-5 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-ink-deep transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onDecide('needs_changes')}
          className="inline-flex items-center justify-center bg-warning px-5 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Needs changes
        </button>
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => onDecide('escalated')}
          className="rounded-ctl inline-flex items-center justify-center border border-ink-line px-5 py-3 text-sm font-semibold uppercase tracking-[0.08em] text-text-pri transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Escalate
        </button>
      </div>
      <p className="mt-3 text-[0.68rem] uppercase tracking-[0.08em] text-text-dim">
        The AI flags; HQ decides. Approving does not auto-notify the studio.
      </p>
    </div>
  )
}

function glyphState(status: Verdict['status']): 'compliant' | 'fix' | 'review' {
  if (status === 'compliant') return 'compliant'
  if (status === 'non_compliant') return 'fix'
  return 'review'
}

// How the two stages combined for this rule (null when Step 2 didn't run).
function StageBadge({ stage }: { stage: ProvStage }) {
  if (!stage) return null
  const map: Record<Exclude<ProvStage, null>, { label: string; tone: Tone }> = {
    agreed: { label: 'DB + file store agree', tone: 'success' },
    conflict: { label: 'Stages disagree', tone: 'warn' },
    kb_only: { label: 'File-store flag', tone: 'accent' },
    db_only: { label: 'DB only', tone: 'dim' },
  }
  const { label, tone } = map[stage]
  return <StatusPill label={label} tone={tone} dot compact />
}

function rank(s: Verdict['status']): number {
  return s === 'non_compliant' ? 0 : s === 'cannot_determine' ? 1 : 2
}
function prettyGroup(g: string): string {
  return g.split(/[-_]/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
}
