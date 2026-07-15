import Image from 'next/image'
import {
  buildRoofCandidateOverlay,
  ROOF_CANDIDATE_PRESENTATION,
  type RoofCandidateSummary,
} from '@/lib/roofing/roof-candidate-overlay'
import type { RoofStructurePrice } from '@/lib/roofing/types'

type Props = {
  publicToken: string
  address: string | null
  structureIndex: number
  structure: RoofStructurePrice
}

function formatMetres(value: number): string {
  return `${value.toLocaleString('en-AU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} m`
}

function countCopy(summary: RoofCandidateSummary): string {
  const displayed = summary.reportedCount ?? summary.locatedCount
  return `${displayed} ${displayed === 1 ? 'run' : 'runs'}`
}

export function RoofTopologyResultSection({
  publicToken,
  address,
  structureIndex,
  structure,
}: Props) {
  const overlay = buildRoofCandidateOverlay({
    polygon: structure.metrics?.polygon_geojson ?? null,
    form: structure.metrics?.form ?? 'unknown',
    hips: structure.metrics?.hips ?? null,
    valleys: structure.metrics?.valleys ?? null,
    ridgeLm: structure.metrics?.ridge_lm ?? null,
    roofSegmentCount: structure.metrics?.roof_segment_count ?? null,
    pitchDegrees: structure.metrics?.pitch_degrees ?? null,
    hipEstimateLm: structure.price?.edge_works?.hips_lm ?? null,
    valleyEstimateLm: structure.price?.edge_works?.valleys_lm ?? null,
  })
  const imageUrl =
    `/api/roofing/q/${encodeURIComponent(publicToken)}/static-map?fit=1&sel=${structureIndex}`

  return (
    <section className="mt-8" aria-labelledby="roof-topology-result-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent">
            Roof evidence · footprint candidate
          </div>
          <h2
            id="roof-topology-result-title"
            className="mt-2 text-2xl font-extrabold uppercase tracking-[-0.03em] text-text-pri sm:text-3xl"
          >
            Processed roof <span className="text-accent">candidate overlay</span>
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="border border-ink-line bg-ink-card px-3 py-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.13em] text-text-sec">
            Actual property aerial
          </span>
          <span className="border border-warning bg-ink-card px-3 py-2 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.13em] text-warning-bright">
            Review required
          </span>
        </div>
      </div>

      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-text-sec">
        {overlay
          ? `${structure.label} is shown over the property aerial with a restrained numbered-zone overlay. Edge totals remain listed below, while provisional R/H/V/E paths are intentionally kept off the image to keep it readable.`
          : `${structure.label} is shown as a property aerial reference. This saved result has no usable footprint, so a numbered-zone overlay has not been generated.`}
      </p>

      <figure className="mt-5 overflow-hidden border border-ink-line bg-ink-card">
        <div
          className="relative aspect-[4/3] w-full overflow-hidden bg-[#0A1628]"
          data-testid="roof-topology-candidate-image"
        >
          <Image
            src={imageUrl}
            alt={`Satellite view of ${structure.label.toLowerCase()} at ${address ?? 'the measured property'}`}
            fill
            priority
            unoptimized
            sizes="(max-width: 768px) 100vw, 1100px"
            className="object-cover"
          />
          {overlay ? (
            <Image
              src={overlay.imageSrc}
              alt=""
              aria-hidden="true"
              fill
              unoptimized
              sizes="(max-width: 768px) 100vw, 1100px"
              className="pointer-events-none object-fill"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0A1628]/70 p-6 text-center">
              <div className="max-w-md border border-ink-line bg-ink-deep/95 p-5">
                <div className="font-mono text-xs font-semibold uppercase tracking-[0.15em] text-warning-bright">
                  Candidate overlay unavailable
                </div>
                <p className="mt-2 text-sm leading-relaxed text-text-sec">
                  This saved result has no usable building footprint. The aerial remains a
                  property reference only; no roof zones have been placed.
                </p>
              </div>
            </div>
          )}
        </div>

        <figcaption className="border-t border-ink-line px-5 py-4">
          <div className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-text-pri">
            {overlay
              ? `${overlay.facetCount} numbered visual zones · ${structure.label}`
              : `Property reference · ${structure.label}`}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-sec">
            {overlay
              ? overlay.facetCountSource === 'solar_segment_count'
                ? overlay.reportedFacetCount !== null && overlay.reportedFacetCount > overlay.facetCount
                  ? `${overlay.facetCount} of ${overlay.reportedFacetCount} saved segment-count zones are displayed to keep the image legible. Their positions are illustrative because the API does not supply facet polygons.`
                  : 'The saved Google Solar segment count sets the number of coloured zones; their positions are illustrative because the API does not supply facet polygons.'
                : 'Coloured zones are an illustrative split of the saved footprint, not detected roof planes.'
              : 'No coloured zones are shown because this result has no usable saved footprint.'}
            {overlay
              ? ' The zone overlay is visual evidence only and does not change pricing or the editable measurement values below.'
              : ''}
          </p>
        </figcaption>
      </figure>

      {overlay ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Roof edge candidate totals">
            {overlay.summaries.map((summary) => {
              const presentation = ROOF_CANDIDATE_PRESENTATION[summary.kind]
              const countMismatch =
                summary.reportedCount !== null && summary.reportedCount !== summary.locatedCount
              return (
                <article
                  key={summary.kind}
                  className="border border-ink-line bg-ink-card p-3"
                  style={{ borderTopColor: summary.color, borderTopWidth: '1px' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className="font-mono text-[0.7rem] font-bold uppercase tracking-[0.15em]"
                      style={{ color: summary.color }}
                    >
                      {presentation.prefix} · {summary.label}
                    </div>
                    <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-text-dim">
                      Candidate
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-xl font-bold tabular-nums text-text-pri">
                    {countCopy(summary)}
                  </div>
                  <div className="mt-1 font-mono text-[0.7rem] tabular-nums text-text-sec">
                    {formatMetres(summary.guidePlanLengthM)} provisional plan length
                  </div>
                  {summary.existingEstimateLm !== null ? (
                    <div className="mt-1 font-mono text-[0.68rem] tabular-nums text-text-dim">
                      {summary.kind === 'ridge'
                        ? 'Current result ridge + hip total'
                        : 'Current result estimate'}{' '}
                      · {formatMetres(summary.existingEstimateLm)}
                    </div>
                  ) : null}
                  {countMismatch ? (
                    <p className="mt-2 text-[0.68rem] leading-relaxed text-warning-bright">
                      {summary.reportedCount} reported; the footprint supports only{' '}
                      {summary.locatedCount} provisional runs. Confirm during review or on site.
                    </p>
                  ) : null}
                  {summary.kind === 'eave' ? (
                    <p className="mt-2 text-[0.68rem] leading-relaxed text-text-dim">
                      Roof-boundary candidates only · not a gutter measurement.
                    </p>
                  ) : null}
                </article>
              )
            })}
        </div>
      ) : null}

      <div className="mt-4 border-l-4 border-warning bg-ink-card px-5 py-4">
        <div className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.15em] text-warning-bright">
          Candidate evidence · not exact topology
        </div>
        <p className="mt-1 text-xs leading-relaxed text-text-sec">
          A 2D Geoscape footprint cannot prove the exact internal ridge, hip, or valley
          locations. The numbered zones visualise the saved footprint and segment count only;
          all edge totals remain provisional and review-required. A commercially approved
          DSM/LiDAR analysis can later replace this visual fallback in the same panel.
        </p>
      </div>
    </section>
  )
}
