'use client'

// Dashboard-only, synthetic evidence preview. It intentionally renders no
// property imagery or map tiles: those require a source-specific display policy
// and a real analysis record. The SVG exists to demonstrate the review UI and
// line semantics without implying that fixture geometry belongs to the property.

import { useState } from 'react'
import {
  buildTopologyEvidenceView,
  type TopologyEvidenceDisplayCandidate,
} from '@/lib/roofing/topology-evidence-view'
import {
  getTopologyEvidenceFixture,
  type TopologyEvidenceKind,
} from '@/lib/roofing/topology-evidence-fixtures'
import type {
  TopologyPreviewGate,
  TopologyPreviewStructure,
} from '@/lib/roofing/topology-preview'

type Props = {
  structures: TopologyPreviewStructure[]
  gate: TopologyPreviewGate
  disclaimer: string
}

// A deliberately fixed benchmark. Do not select a fixture from a saved roof
// form, footprint, address, or source date: synthetic metres must never look
// like this property's measured topology.
function requiredSyntheticPreviewFixture() {
  const fixture = getTopologyEvidenceFixture('synthetic-l-valley-01')
  if (!fixture) {
    throw new Error('Required synthetic topology preview fixture is missing.')
  }
  return fixture
}

const SYNTHETIC_PREVIEW_FIXTURE = requiredSyntheticPreviewFixture()

const GATE_COPY: Record<TopologyPreviewGate, { label: string; detail: string; tone: string }> = {
  feature_disabled: {
    label: 'Live analysis is locked',
    detail: 'The source-analysis flag is off. This screen is a synthetic UI preview only.',
    tone: 'border-ink-line',
  },
  source_setup_required: {
    label: 'Source storage requires setup',
    detail: 'Topology approval storage is not available yet. Apply migration 172 and record the source terms before a live run.',
    tone: 'border-warning-bright/40',
  },
  source_approval_required: {
    label: 'Written source approval required',
    detail: 'A Maps key or enabled API is not a topology approval. Record an active, derivative-geometry approval before a live run.',
    tone: 'border-warning-bright/40',
  },
  source_approval_expired: {
    label: 'Source approval has expired',
    detail: 'Renew or replace the source approval before generating any candidate evidence.',
    tone: 'border-danger-bright/40',
  },
  source_approval_recorded: {
    label: 'Source approval record found',
    detail: 'No source has been selected or called here. A future live action must validate a specific approval, retention terms, and the selected dwelling before it can run.',
    tone: 'border-ink-line',
  },
}

export function TopologyEvidencePanel({ structures, gate, disclaimer }: Props) {
  const [selectedStructureIndex, setSelectedStructureIndex] = useState<number | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [visibleKind, setVisibleKind] = useState<TopologyEvidenceKind | null>(null)
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null)

  const selectedStructure = structures.find((structure) => structure.structureIndex === selectedStructureIndex) ?? null
  const canConfirm = selectedStructure !== null && selectedStructure.hasBuildingId
  const fullView = confirmed
    ? buildTopologyEvidenceView(SYNTHETIC_PREVIEW_FIXTURE)
    : null
  const view = fullView && visibleKind
    ? buildTopologyEvidenceView(SYNTHETIC_PREVIEW_FIXTURE, { visibleKinds: [visibleKind] })
    : fullView
  const activeCandidate = fullView?.candidates.find((candidate) => candidate.id === activeCandidateId) ?? null
  const gateCopy = GATE_COPY[gate]

  function chooseStructure(structureIndex: number) {
    setSelectedStructureIndex(structureIndex)
    setConfirmed(false)
    setVisibleKind(null)
    setActiveCandidateId(null)
  }

  function toggleKind(kind: TopologyEvidenceKind) {
    setVisibleKind((current) => current === kind ? null : kind)
    setActiveCandidateId(null)
  }

  return (
    <section className="mt-10 border border-ink-line bg-ink-card p-6 sm:p-8" aria-labelledby="topology-evidence-title">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className=" text-xs font-semibold uppercase tracking-[0.08em] text-accent">
            Roof topology evidence · synthetic benchmark
          </div>
          <h2 id="topology-evidence-title" className="mt-2 font-extrabold uppercase tracking-[-0.03em] text-2xl text-text-pri sm:text-3xl">
            Review <span className="text-accent">candidate runs</span>
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-sec">{disclaimer}</p>
        </div>
        <span className="border border-ink-line bg-ink-deep px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-dim">
          Dashboard only
        </span>
      </div>

      <div className={`mt-6 border bg-ink-deep px-5 py-4 ${gateCopy.tone}`} role="status">
        <div className=" text-xs font-semibold uppercase tracking-[0.08em] text-text-pri">{gateCopy.label}</div>
        <p className="mt-1 text-sm leading-relaxed text-text-sec">{gateCopy.detail}</p>
      </div>

      <fieldset className="mt-8 border border-ink-line bg-ink-deep p-5" aria-describedby="dwelling-selection-help">
        <legend className="px-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">
          01 · Select main dwelling
        </legend>
        <p id="dwelling-selection-help" className="text-sm leading-relaxed text-text-sec">
          Confirm the building deliberately for a future live analysis. The benchmark below is a neutral test scenario; it is not matched to this address, roof form, footprint, or imagery.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {structures.map((structure) => {
            const isSelected = structure.structureIndex === selectedStructureIndex
            const unavailable = !structure.hasBuildingId
            return (
              <label
                key={structure.structureIndex}
                className={`border p-4 transition-colors ${
                  unavailable
                    ? 'cursor-not-allowed border-ink-line bg-ink-card/50 opacity-60'
                    : isSelected
                      ? 'cursor-pointer border-accent bg-ink-card'
                      : 'cursor-pointer border-ink-line bg-ink-card hover:border-accent/60'
                }`}
              >
                <input
                  type="radio"
                  name="topology-main-dwelling"
                  value={structure.structureIndex}
                  checked={isSelected}
                  disabled={unavailable}
                  onChange={() => chooseStructure(structure.structureIndex)}
                  className="sr-only"
                />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className=" text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-dim">
                      {structure.role === 'primary' ? 'Primary pricing structure' : 'Secondary structure'} · {String(structure.structureIndex).padStart(2, '0')}
                    </div>
                    <div className="mt-1 font-semibold text-text-pri">{structure.label}</div>
                  </div>
                  {isSelected && <span className="font-mono text-xs font-bold text-accent">SELECTED</span>}
                </div>
                <div className="mt-3 font-mono text-xs text-text-sec">Saved measurement structure · selection only</div>
                {unavailable && <p className="mt-2 text-xs text-warning">No durable building reference — re-measure before source analysis.</p>}
              </label>
            )
          })}
        </div>
        <label className={`mt-5 flex items-start gap-3 text-sm ${canConfirm ? 'cursor-pointer text-text-sec' : 'cursor-not-allowed text-text-dim'}`}>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!canConfirm}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span>
            I confirm this is the main dwelling for a future topology analysis. This only opens a neutral synthetic benchmark now and does not change the quote.
          </span>
        </label>
      </fieldset>

      {!view && (
        <div className="mt-6 border border-dashed border-ink-line bg-ink-deep px-6 py-12 text-center">
          <div className=" text-xs font-semibold uppercase tracking-[0.08em] text-text-dim">Awaiting dwelling confirmation</div>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-text-sec">
            Choose and confirm the main dwelling to open the neutral synthetic benchmark. It will not use satellite imagery, property geometry, or call a provider.
          </p>
        </div>
      )}

      {view && (
        <>
          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
            <figure className="overflow-hidden border border-ink-line bg-ink-deep">
              <TopologyEvidenceSvg
                view={view}
                activeCandidateId={activeCandidateId}
              />
              <figcaption className="border-t border-ink-line bg-ink-card px-5 py-4">
                <div className=" text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-dim">
                  Facet assignment evidence
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-sec">
                  Neutral test scenario: derived facet reconstruction shown only to demonstrate review controls. It is never property imagery, property geometry, or this address&apos;s edge measurement.
                </p>
              </figcaption>
            </figure>

            <aside className="border border-ink-line bg-ink-deep p-5" aria-live="polite">
              <div className=" text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-dim">Selected evidence</div>
              {activeCandidate ? <CandidateDetail candidate={activeCandidate} /> : (
                <div className="mt-4 text-sm leading-relaxed text-text-sec">
                  <p>Select a synthetic candidate frame below to inspect its length, confidence, and evidence reasons.</p>
                  <p className="mt-4 border-l-2 border-warning pl-3 text-xs text-text-dim">All fixture candidates remain review-required.</p>
                </div>
              )}
              {view.excludedStructures.length > 0 && (
                <div className="mt-6 border-t border-ink-line pt-5">
                  <div className=" text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-dim">Excluded from this preview</div>
                  <p className="mt-2 text-sm text-text-sec">{view.excludedStructures.join(', ')}</p>
                </div>
              )}
            </aside>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {view.summaries.filter((summary) => summary.kind !== 'unknown').map((summary) => {
              const selected = visibleKind === summary.kind
              return (
                <button
                  key={summary.kind}
                  type="button"
                  onClick={() => toggleKind(summary.kind)}
                  aria-pressed={selected}
                  className={`border bg-ink-deep p-4 text-left transition-colors ${selected ? 'border-text-pri' : 'border-ink-line hover:border-text-dim'}`}
                  style={{ borderLeftColor: summary.color, borderLeftWidth: '4px' }}
                >
                  <div className=" text-[0.68rem] font-semibold uppercase tracking-[0.08em]" style={{ color: summary.color }}>
                    {summary.label}s
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-3">
                    <span className="font-mono text-3xl font-bold tabular-nums text-text-pri">{summary.count}</span>
                    <span className="font-mono text-xs text-text-dim">{formatMetres(summary.planLengthM)} plan</span>
                  </div>
                  <p className="mt-2 text-xs text-text-sec">
                    Candidate only · {formatMetres(summary.planLengthM)} · review required
                  </p>
                  {summary.kind === 'eave' && <p className="mt-2 text-[0.68rem] text-text-dim">Not a gutter quote</p>}
                </button>
              )
            })}
          </div>

          <div className="mt-5 border border-ink-line bg-ink-deep p-4" aria-label="Synthetic candidate evidence frames">
            <div className=" text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-dim">Synthetic candidate frames</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {view.candidates.map((candidate) => {
                const selected = activeCandidateId === candidate.id
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setActiveCandidateId(candidate.id)
                      setVisibleKind(candidate.kind)
                    }}
                    className={`border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${selected ? 'border-text-pri bg-ink-card' : 'border-ink-line hover:border-text-dim'}`}
                    style={{ borderLeftColor: candidate.color, borderLeftWidth: '4px' }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-bold" style={{ color: candidate.color }}>{candidate.tag}</span>
                      <span className=" text-[0.65rem] uppercase tracking-[0.08em] text-text-dim">Candidate</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-text-pri">{candidate.kind} · {formatMetres(candidate.planLengthM)}</div>
                    <div className="mt-1 text-xs text-text-sec">{candidate.confidence}% confidence · review required</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2" aria-label="Topology candidate legend">
            {view.legend.map((item) => (
              <span key={item.kind} className="border border-ink-line bg-ink-deep px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-sec">
                <span aria-hidden="true" className="mr-2 inline-block h-2.5 w-2.5" style={{ backgroundColor: item.color }} />
                {item.tagPrefix} · {item.label} · review required
              </span>
            ))}
          </div>

          <p className="mt-4 border-l-2 border-success-bright pl-3 text-xs leading-relaxed text-text-sec">{view.eaveNotice}</p>
        </>
      )}
    </section>
  )
}

function CandidateDetail({ candidate }: { candidate: TopologyEvidenceDisplayCandidate }) {
  return (
    <div className="mt-4">
      <div className=" text-xs font-bold uppercase tracking-[0.08em]" style={{ color: candidate.color }}>{candidate.tag} · {candidate.kind}</div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <DetailMetric label="Plan" value={formatMetres(candidate.planLengthM)} />
        <DetailMetric label="Surface" value={candidate.surfaceLengthM === null ? '—' : formatMetres(candidate.surfaceLengthM)} />
        <DetailMetric label="Confidence" value={`${candidate.confidence}%`} />
        <DetailMetric label="State" value="Candidate" />
      </div>
      <div className="mt-5">
        <div className=" text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-text-dim">Evidence reasons</div>
        <ul className="mt-2 space-y-1.5 text-sm text-text-sec">
          {candidate.reasons.map((reason) => <li key={reason}>· {reason}</li>)}
        </ul>
      </div>
    </div>
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink-line bg-ink-card p-3">
      <div className=" text-[0.62rem] uppercase tracking-[0.08em] text-text-dim">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-text-pri">{value}</div>
    </div>
  )
}

function TopologyEvidenceSvg({
  view,
  activeCandidateId,
}: {
  view: ReturnType<typeof buildTopologyEvidenceView>
  activeCandidateId: string | null
}) {
  const clipId = 'synthetic-topology-roof-clip'
  const roofPoints = view.roofOutline.map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <svg
      viewBox="0 0 100 100"
      className="block h-auto w-full"
      role="img"
      aria-label="Synthetic roof topology candidate overlay. Use the synthetic candidate frame buttons below the overlay to inspect a candidate."
    >
      <title>Synthetic roof topology candidate overlay</title>
      <desc>A neutral, non-property roof outline with numbered facet evidence and candidate ridge, hip, valley, eave, and unresolved lines.</desc>
      <defs>
        <clipPath id={`roof-clip-${clipId}`}><polygon points={roofPoints} /></clipPath>
      </defs>
      <rect width="100" height="100" fill="var(--ink-deep)" />
      <g clipPath={`url(#roof-clip-${clipId})`}>
        {/* Four synthetic roof bands — a categorical encoding, so they come
            off the shared viz ramp. These were the iOS system palette
            (#0A84FF, #FF9F0A, #14B8A6, #BF5AF2): four accents from another
            product's design system on a one-accent warm canvas. */}
        <rect x="6" y="8" width="25" height="84" fill="var(--viz-2)" opacity="0.28" />
        <rect x="31" y="8" width="24" height="84" fill="var(--viz-5)" opacity="0.24" />
        <rect x="55" y="8" width="20" height="84" fill="var(--viz-4)" opacity="0.27" />
        <rect x="75" y="8" width="20" height="84" fill="var(--viz-7)" opacity="0.22" />
      </g>
      <polygon points={roofPoints} fill="none" stroke="var(--text-sec)" strokeWidth="0.75" strokeDasharray="2 1.5" />
      <SyntheticFacetBadges />
      {view.candidates.map((candidate) => (
        <CandidateLine
          key={candidate.id}
          candidate={candidate}
          active={candidate.id === activeCandidateId}
        />
      ))}
      <text x="4" y="96" fill="var(--text-dim)" fontSize="2.6" fontFamily="ui-monospace, monospace" letterSpacing="0.4">SYNTHETIC · NOT PROPERTY IMAGERY</text>
    </svg>
  )
}

function SyntheticFacetBadges() {
  const badges: ReadonlyArray<readonly [number, number, string]> = [
    [24, 31, '00'],
    [45, 68, '01'],
    [66, 30, '02'],
    [78, 68, '03'],
  ]
  return (
    <g aria-hidden="true">
      {badges.map(([x, y, label]) => (
        <g key={label} transform={`translate(${x} ${y})`}>
          <rect x="-4.5" y="-3.5" width="9" height="7" rx="0.8" fill="var(--ink-deep)" stroke="#FFFFFF" strokeOpacity="0.8" strokeWidth="0.5" />
          <text textAnchor="middle" dominantBaseline="central" fill="#FFFFFF" fontSize="2.5" fontFamily="ui-monospace, monospace">{label}</text>
        </g>
      ))}
    </g>
  )
}

function CandidateLine({
  candidate,
  active,
}: {
  candidate: TopologyEvidenceDisplayCandidate
  active: boolean
}) {
  const points = candidate.geometry.coordinates.map(([x, y]) => `${x},${y}`).join(' ')
  const labelPoint = pointAtMiddle(candidate.geometry.coordinates)
  const outlineWidth = active ? 5.8 : 4.8
  const colorWidth = active ? 2.5 : 1.8
  const label = `${candidate.tag} · ${formatMetres(candidate.planLengthM)} · ${candidate.confidence}%`

  return (
    <g aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--ink-deep)" strokeWidth={outlineWidth} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke="#FFFFFF" strokeOpacity="0.9" strokeWidth={outlineWidth - 1.4} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={points} fill="none" stroke={candidate.color} strokeWidth={colorWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={candidate.dashArray} />
      <g transform={`translate(${labelPoint[0]} ${labelPoint[1] - 3.2})`}>
        <rect x="-10" y="-3" width="20" height="6" rx="0.8" fill="var(--ink-deep)" stroke={candidate.color} strokeWidth={active ? 0.85 : 0.55} />
        <text textAnchor="middle" dominantBaseline="central" fill="#FFFFFF" fontSize="2.05" fontFamily="ui-monospace, monospace">{label}</text>
      </g>
    </g>
  )
}

function pointAtMiddle(points: readonly (readonly [number, number])[]): readonly [number, number] {
  const midpoint = points[Math.floor((points.length - 1) / 2)]
  return [midpoint[0], midpoint[1]]
}

function formatMetres(value: number): string {
  return `${value.toFixed(1)} m`
}
