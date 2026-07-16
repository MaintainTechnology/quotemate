// /m/[token] — tradie-facing Measurement Results page (migration 140).
//
// Keyed by roofing_measurements.measure_token (a SECOND unguessable token,
// distinct from the customer-facing public_token). One record, two views:
// this page shows the RAW measured structures for the tradie to review and
// narrow; /q/roof/[public_token] is the customer's priced quote.
//
// Anyone with the link can open it (same trust model as the customer quote
// page — the unguessable token is the capability). The service-role client
// is used because this is a public sharing surface; only the columns
// rendered below are exposed.
//
// The tradie can include/exclude each structure here — that selection is the
// authoritative source of truth the customer quote + PDF narrow to.
//
// Presentation: the same Command Centre sheet language as the customer quote
// surface (app/q/_chrome — `.qm-quote` scoped dark palette, QuoteSheet +
// Letterhead), at a wider sheet width for the tradie's desktop review. The
// interactive review (MeasurementReview) inherits the scoped tokens.

import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { CSSProperties } from 'react'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import {
  defaultStructureIndices,
  primaryStructureIndices,
  sanitizeIndices,
  structureCount,
} from '@/lib/roofing/selection'
import { buildSaveAsQuoteRequest } from '@/lib/roofing/save-as-quote-helpers'
import { loadTenantIdentity, contactDisplayName } from '@/lib/quote/tenant-identity'
import { QuoteSheet, Letterhead } from '../../q/_chrome/parts'
import { QuoteMaxMark } from '../../q/_chrome/icons'
import { MeasurementReview } from './MeasurementReview'
import { RoofLayoutSection } from './RoofLayoutSection'
import { Roof3DModelSection } from './Roof3DModelSection'
import type { LayoutPlan } from '@/lib/roofing/layout-plan'
import type { LayoutOverlayStructure } from '@/lib/roofing/layout-overlay-svg'
import { edgeLengthM, polygonBBox, polygonCentroid } from '@/lib/roofing/map-utils'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Row = {
  address: string | null
  postcode: string | null
  state: string | null
  provider: string | null
  routing: string | null
  quote: MultiRoofQuote | null
  measure_token: string
  public_token: string
  included_indices: number[] | null
  tenant_id: string | null
}

export default async function MeasurementResultsPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const { data, error } = await supabase
    .from('roofing_measurements')
    .select('address, postcode, state, provider, routing, quote, measure_token, public_token, included_indices, tenant_id')
    .eq('measure_token', token)
    .maybeSingle()

  if (error || !data) notFound()
  const row = data as Row
  const quote = row.quote
  const count = structureCount(quote)
  if (!quote || count === 0) notFound()

  // quote_share_token (migration 168) read in a SEPARATE, best-effort query so
  // this page never breaks if it loads before the migration applies (same
  // pattern as /p's released_at read). A linked token means this measurement
  // was already promoted to an editable quotes row — the review UI links
  // straight to the dashboard editor instead of re-promoting.
  let quoteShareToken: string | null = null
  {
    const { data: link, error: linkErr } = await supabase
      .from('roofing_measurements')
      .select('quote_share_token')
      .eq('measure_token', token)
      .maybeSingle()
    if (!linkErr && link) quoteShareToken = (link.quote_share_token as string | null) ?? null
  }

  // Tradie letterhead identity — best-effort, degrades to a generic name when
  // the row predates tenant stamping.
  const identity = await loadTenantIdentity(supabase, row.tenant_id)

  // Promotion payload (spec R6d/e) — flattened server-side by the SAME pure
  // helper the save-as-quote tests validate, so the client only POSTs it.
  // Null when the row can't produce a valid request (no usable address), and
  // skipped entirely once promoted (the review UI links straight to the
  // dashboard editor — no point shipping an unused body in the RSC payload).
  const saveAsQuoteBody = quoteShareToken
    ? null
    : buildSaveAsQuoteRequest({
        address: row.address,
        postcode: row.postcode,
        state: row.state,
        quote,
        included_indices: row.included_indices,
      })

  // A persisted selection wins; an untouched (NULL/empty) record falls back to
  // the roof-only default (main dwelling) — never "all structures". We pass the
  // persisted-ness + the primary index down so the review UI can word its
  // "saved selection" notice honestly and compute the secondaries' contribution.
  const sanitized = sanitizeIndices(row.included_indices, count)
  const selectionWasPersisted =
    Array.isArray(row.included_indices) && row.included_indices.length > 0
  const included = sanitized.length > 0 ? sanitized : defaultStructureIndices(quote)
  const primaryIndices = primaryStructureIndices(quote)

  // AI layout plan (spec quote-visual-parity R6) — separate best-effort read
  // (migration 170 pattern, mirrors the quote_share_token read above).
  let layoutStatus: string | null = null
  let layoutPlan: LayoutPlan | null = null
  {
    const { data: lp, error: lpErr } = await supabase
      .from('roofing_measurements')
      .select('layout_status, layout_plan')
      .eq('measure_token', token)
      .maybeSingle()
    if (!lpErr && lp) {
      layoutStatus = (lp.layout_status as string | null) ?? null
      layoutPlan = (lp.layout_plan as LayoutPlan | null) ?? null
    }
  }

  // 3D model (migration 173) — separate best-effort read, same pattern as
  // layout_status above, so the page never breaks pre-migration.
  let model3dStatus: string | null = null
  {
    const { data: m3, error: m3Err } = await supabase
      .from('roofing_measurements')
      .select('model3d_status')
      .eq('measure_token', token)
      .maybeSingle()
    if (!m3Err && m3) model3dStatus = (m3.model3d_status as string | null) ?? null
  }

  // Capture target for the 3D model: primary structure centroid + an orbit
  // range sized from its footprint (same framing maths as the fly-around).
  const primaryPolygon =
    quote.structures.find((s) => s.role === 'primary')?.metrics?.polygon_geojson ??
    quote.structures[0]?.metrics?.polygon_geojson ??
    null
  const model3dCentroid = polygonCentroid(primaryPolygon)
  const model3dBBox = polygonBBox(primaryPolygon)
  const captureRangeM = model3dBBox
    ? Math.max(
        70,
        (edgeLengthM(
          [model3dBBox.west, model3dBBox.south],
          [model3dBBox.east, model3dBBox.north],
        ) /
          2 +
          4) *
          4,
      )
    : 90

  // Overlay inputs: per-structure geometry for the interactive map, plus
  // per-structure metric snapshots so the layout section recomputes framing,
  // zones AND material quantities client-side as the tradie toggles
  // structures in/out (the review broadcasts 'qm:roof-selection').
  const overlayStructures: LayoutOverlayStructure[] = quote.structures.map((s) => ({
    polygon: s.metrics?.polygon_geojson ?? null,
    form: s.metrics?.form ?? 'unknown',
  }))
  const structureMetrics = quote.structures.map((s) => ({
    role: s.role,
    inputs: { material: s.inputs?.material, pitch: s.inputs?.pitch },
    metrics: {
      sloped_area_m2: s.metrics?.sloped_area_m2 ?? null,
      ridge_lm: s.metrics?.ridge_lm ?? null,
      footprint_m2: s.metrics?.footprint_m2 ?? null,
      polygon_geojson: s.metrics?.polygon_geojson ?? null,
      hips: s.metrics?.hips ?? null,
      valleys: s.metrics?.valleys ?? null,
      pitch_degrees: s.metrics?.pitch_degrees ?? null,
    },
  }))

  return (
    <div
      className="qm-quote"
      data-qm-theme="dark"
      style={
        {
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--ink-deep)',
          color: 'var(--text-pri)',
          // Wider sheet than the customer quote — this is a desktop review
          // surface; the structure cards and stat grids earn the room.
          '--qm-sheet-w': '1200px',
        } as CSSProperties
      }
    >
      <div className="noise-overlay" aria-hidden="true" />

      {/* ── tradie top bar — mirrors the customer chrome at tradie intent ── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          height: 56,
          padding: '0 20px',
          borderBottom: '1px solid var(--ink-line)',
          background: 'var(--ink-deep)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <QuoteMaxMark size={24} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: 'var(--text-dim)',
              whiteSpace: 'nowrap',
            }}
          >
            Tradie · Measurement results
          </span>
        </div>
        {/* measure_token holders are tradies by construction — static link. */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 font-mono text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-text-dim transition-colors hover:text-text-pri"
        >
          ← Dashboard
        </Link>
      </header>

      <main style={{ position: 'relative', flex: 1, minHeight: 0, padding: '0 16px 40px' }}>
        <QuoteSheet label={`Roofing measurement · ${row.address ?? 'measured property'}`}>
          <Letterhead
            name={identity?.business_name ?? 'Your roofing team'}
            credential="Roofing · measurement review"
            logoUrl={identity?.logo_url ?? null}
            contactName={contactDisplayName(identity)}
            phone={(identity?.owner_mobile ?? '').trim() || null}
            email={(identity?.owner_email ?? '').trim() || null}
          />

          <div className="px-6 pb-10 sm:px-10">
            <div className="pt-8">
              <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-accent">
                QuoteMax · Roofing · Measurement
              </div>
              <h1 className="mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(1.9rem,4.2vw,3.2rem)]">
                Measurement <span className="qm-accentword">results</span>
              </h1>
              {row.address && <p className="mt-4 text-lg text-text-sec">{row.address}</p>}
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
                Every structure measured at this property
                {row.provider ? ` (via ${row.provider})` : ''}. Untick any structure
                you don&rsquo;t want in the job. Your selection is what the customer
                quote and the PDF are priced from.
              </p>
            </div>

            {/* Satellite / aerial view of the property (same source the customer
                quote page uses), keyed by the customer public_token. */}
            <div className="mt-8 overflow-hidden border border-ink-line bg-ink-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/roofing/q/${row.public_token}/static-map`}
                alt={`Satellite view of the roof at ${row.address ?? 'the property'}`}
                className="h-112 w-full object-cover sm:h-128"
              />
              <div className="border-t border-ink-line px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
                Google satellite view
              </div>
            </div>

            {/* AI work-strategy layout map — generate here; the customer page
                and PDF read the cached plan (spec quote-visual-parity R6). */}
            <RoofLayoutSection
              publicToken={row.public_token}
              structures={overlayStructures}
              includedIndices={included}
              structureMetrics={structureMetrics}
              initialStatus={layoutStatus}
              initialPlan={layoutPlan}
            />

            {/* Interactive 3D model (Track B — visual only; migration 173). */}
            <Roof3DModelSection
              measureToken={row.measure_token}
              center={
                model3dCentroid ? { lat: model3dCentroid[1], lng: model3dCentroid[0] } : null
              }
              captureRangeM={captureRangeM}
              initialStatus={model3dStatus}
            />

            <MeasurementReview
              measureToken={row.measure_token}
              publicToken={row.public_token}
              routing={row.routing}
              structures={quote.structures}
              solar={quote.solar ?? null}
              initialIncluded={included}
              primaryIndices={primaryIndices}
              selectionWasPersisted={selectionWasPersisted}
              quoteShareToken={quoteShareToken}
              saveAsQuoteBody={saveAsQuoteBody}
            />
          </div>
        </QuoteSheet>
      </main>

      <div className="bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMax · Roofing · Measurement
        </span>
      </div>
    </div>
  )
}
