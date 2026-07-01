// Customer-facing public roofing quote page.
// Reached via the SMS link "Full breakdown + your roof image: {url}".
// Token-gated against roofing_measurements.public_token (unguessable);
// the service-role client is used because this is a public sharing
// surface — only the columns rendered below are exposed.
//
// CONFIRM GATE: prices are hidden until the customer confirms over SMS
// (roofing_measurements.confirmed_at is set). Before that the page is a
// price-free "which building is yours?" picker — the satellite + the
// measured outlines + per-structure metrics, no dollar figures. After
// confirmation it shows the full priced breakdown, narrowed to the
// structure(s) they picked (confirmed_structure, or the ?s= link from a
// follow-up like "give me 2 and 3"), plus an AI "after re-roof" preview
// rendered from the satellite aerial.
//
// This mirrors the dashboard /dashboard/roofing/measure result: the
// Geoscape roof outline on satellite (RoofMap, free Esri tiles), the
// Google satellite "second eye", and a full per-structure pricing
// breakdown (metrics, every tier with its scope, effective rate +
// loadings) plus the combined total. Read-only — no editing.
//
// Maintain Technology brand: dark navy, vibrant orange, all-caps display.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type {
  MultiRoofQuote,
  RoofMaterial,
  RoofMetrics,
  RoofStructurePrice,
} from '@/lib/roofing/types'
import { partitionRoofQuote, resolveEffectiveIndices } from '@/lib/roofing/selection'
import { structureStaticMapPath } from '@/lib/roofing/structure-images'
import { edgeStat } from '@/lib/roofing/geometry-edges'
import { buildingAttributeChips, propertyContextChips } from '@/lib/roofing/attributes-display'
import { indicativeCombinedTiers } from '@/lib/sms/roofing-compose'
import { RoofMap, type RoofMapBuilding } from '@/app/dashboard/roofing/_components/RoofMap'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type Row = {
  address: string | null
  state: string | null
  provider: string | null
  routing: string | null
  combined_area_m2: number | null
  quote: MultiRoofQuote | null
  public_token: string
  confirmed_at: string | null
  confirmed_structure: number | null
  included_indices: number[] | null
}

function money(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
  return n.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const MATERIAL_LABEL: Record<RoofMaterial, string> = {
  colorbond_corrugated: 'Colorbond Corrugated',
  colorbond_trimdek: 'Colorbond Trimdek',
  colorbond_spandek: 'Colorbond Spandek',
  colorbond_kliplok: 'Colorbond Klip-Lok 700',
  concrete_tile: 'Concrete tile',
  terracotta_tile: 'Terracotta tile',
  cement_sheet: 'Cement sheet',
  unknown: 'To confirm on site',
}

/** Geoscape premium building attributes on the customer quote — material,
 *  heights, solar, tree. Renders nothing when the attributes are absent. */
function RoofBuildingData({ metrics }: { metrics: RoofMetrics }) {
  const chips = buildingAttributeChips(metrics)
  if (chips.length === 0) return null
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {chips.map(([label, value]) => (
        <span key={label} className="inline-flex items-baseline gap-1.5 border border-ink-line bg-ink-deep px-3 py-1.5 font-mono text-[0.72rem]">
          <span className="uppercase tracking-[0.12em] text-text-dim">{label}</span>
          <span className="font-semibold text-text-pri">{value}</span>
        </span>
      ))}
    </div>
  )
}

/** PropRadar property context on the customer quote — dwelling type, age,
 *  areas. Renders nothing when PropRadar didn't cover the address. */
function RoofPropertyContextBlock({ quote }: { quote: MultiRoofQuote | null }) {
  const chips = quote?.property_context ? propertyContextChips(quote.property_context) : []
  if (chips.length === 0) return null
  return (
    <div className="mt-8 border border-ink-line bg-ink-card px-6 py-5">
      <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
        Property details
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map(([label, value]) => (
          <span key={label} className="inline-flex items-baseline gap-1.5 border border-ink-line bg-ink-deep px-3 py-1.5 font-mono text-[0.72rem]">
            <span className="uppercase tracking-[0.12em] text-text-dim">{label}</span>
            <span className="font-semibold text-text-pri">{value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function formLabel(form: RoofMetrics['form']): string {
  switch (form) {
    case 'gable': return 'Gable'
    case 'hip': return 'Hip'
    case 'skillion': return 'Skillion'
    case 'gable_hip': return 'Gable + hip'
    case 'complex': return 'Complex'
    default: return 'To confirm'
  }
}

const TIER_NAME: Record<'good' | 'better' | 'best', string> = {
  good: 'Patch / repair',
  better: 'Re-roof',
  best: 'Upgrade',
}

/** Parse a `?s=2,3` query value into validated 1-based indices (or null). */
function parseIndices(s: string | string[] | undefined, max: number): number[] | null {
  const raw = Array.isArray(s) ? s.join(',') : s
  if (!raw) return null
  const nums = raw
    .split(',')
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= max)
  const uniq = [...new Set(nums)].sort((a, b) => a - b)
  return uniq.length > 0 ? uniq : null
}

export default async function RoofingQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ s?: string | string[] }>
}) {
  const { token } = await params
  if (!token || token.length < 8) notFound()

  const { data, error } = await supabase
    .from('roofing_measurements')
    .select('address, state, provider, routing, combined_area_m2, quote, public_token, confirmed_at, confirmed_structure, included_indices')
    .eq('public_token', token)
    .maybeSingle()

  if (error || !data) notFound()
  const row = data as Row
  const fullQuote = row.quote
  const allStructures: RoofStructurePrice[] = Array.isArray(fullQuote?.structures) ? fullQuote!.structures : []

  // Confirm gate — prices show only after the customer confirms over SMS.
  const confirmed = row.confirmed_at != null

  // Which structures to show on the priced view. The tradie's persisted
  // selection (included_indices) is the source of truth; a ?s= link or the
  // single pick stamped at confirm time can only NARROW it further, never
  // widen past what the tradie included.
  const paramIndices = parseIndices((await searchParams).s, allStructures.length)
  const effectiveIndices = resolveEffectiveIndices(
    {
      included: row.included_indices,
      confirmedStructure: row.confirmed_structure,
      paramIndices,
    },
    fullQuote,
  )

  // On the priced view, the headline total covers only the INCLUDED quotable
  // structures (partition.narrowed) — but we still LIST every detected
  // structure, marking excluded ones "not included" and inspection-routed ones
  // "on inspection", neither priced into the total. The picker view always
  // shows every measured building so the customer can pick.
  const partition = confirmed && fullQuote ? partitionRoofQuote(fullQuote, effectiveIndices) : null
  const quote: MultiRoofQuote | null = partition ? partition.narrowed : fullQuote
  // Per-structure cards: every structure (with its state) on the priced view;
  // every measured building on the picker view.
  const structureCards: Array<{ structure: RoofStructurePrice; excluded: boolean }> = confirmed
    ? (partition?.rows ?? []).map((r) => ({ structure: r.structure, excluded: r.state === 'excluded' }))
    : allStructures.map((s) => ({ structure: s, excluded: false }))
  const structures: RoofStructurePrice[] = structureCards.map((c) => c.structure)

  // One satellite photo per structure shown (excluded ones omitted): every
  // measured building on the picker view, the included structures on the priced
  // view. structureCards are in detection order, so position i → the 1-based
  // index i+1 into the full quote that the static-map `?b=` param targets. Fixes
  // the page showing only the first structure's photo. (spec
  // roofing-pdf-multi-structure-images R4)
  const satelliteImages = structureCards
    .map(({ structure: s, excluded }, i) => ({ index1Based: i + 1, label: s.label, excluded }))
    .filter((c) => !c.excluded)

  const isInspection = row.routing === 'inspection_required' || quote?.routing?.decision === 'inspection_required'
  const flagged = new Set(quote?.inspection_structures ?? [])

  // Price visibility. The confirm gate (confirmed) is intentional and stays.
  // The BUG was ALSO gating on !isInspection, which blanked every on-site-
  // flagged roof into a $0 quote. Instead, once confirmed:
  //   • firm — at least one included structure is quotable → headline = the
  //     quotable total (partition.narrowed.combined); inspection-routed
  //     structures are listed "priced on site", never summed into the headline.
  //   • indicative — NO included structure is quotable (a whole-job on-site
  //     quote) → headline = an INDICATIVE sum over ALL included structures,
  //     labelled "subject to on-site confirmation", so the customer never sees
  //     a blank/$0 quote. A genuinely unpriceable roof (asbestos / unknown
  //     material → $0 tiers) has no indicative numbers and falls back to the
  //     price-free inspection notice rather than a $0 quote.
  // All numbers come verbatim from the stored per-structure engine output.
  const includedStructures: RoofStructurePrice[] = partition
    ? partition.rows.filter((r) => r.included).map((r) => r.structure)
    : structures
  const hasFirmPrice = partition ? partition.rows.some((r) => r.state === 'priced') : false
  const indicativeTotals =
    confirmed && !hasFirmPrice ? indicativeCombinedTiers(includedStructures) : null
  const hasIndicativeNumbers =
    !!indicativeTotals && indicativeTotals.tiers.some((t) => t.inc_gst > 0)
  const indicative = confirmed && !hasFirmPrice && hasIndicativeNumbers
  const showPrices = confirmed && (hasFirmPrice || indicative)
  // Headline total: the quotable-only narrow on a firm quote; the indicative
  // all-structure sum on a whole-job on-site quote.
  const combinedForDisplay = indicative ? indicativeTotals : quote?.combined

  const mapBuildings: RoofMapBuilding[] = structureCards.map(({ structure: s, excluded }, i) => ({
    id: s.buildingId ?? `s-${i}`,
    polygon: s.metrics?.polygon_geojson ?? null,
    role: s.role,
    included: !excluded,
  }))
  const primary = structures.find((s) => s.role === 'primary') ?? structures[0]
  const primaryStats = primary
    ? {
        sloped_area_m2: primary.metrics.sloped_area_m2,
        hips: primary.metrics.hips,
        valleys: primary.metrics.valleys,
        storeys: primary.metrics.storeys,
      }
    : null
  const primaryMaterialLabel = primary ? MATERIAL_LABEL[primary.inputs.material] : null

  // Existing-solar detach & reinstate — a deterministic add-on persisted at
  // save time (lib/roofing/solar.ts). Read off the FULL (job-level) quote, not
  // the narrowed view. When it applies on a re-roof it's a distinct line added
  // to ALL three tier totals; the electrician disclaimer shows whenever solar
  // is present on a priced quote.
  const solar = fullQuote?.solar ?? null
  const solarApplies = showPrices && solar?.allowance?.applies === true
  const solarIncGst = solarApplies ? solar?.allowance?.inc_gst ?? 0 : 0
  const solarExGst = solarApplies ? solar?.allowance?.ex_gst ?? 0 : 0
  const showElectricianNote =
    showPrices && solar?.detection?.has_solar === true && !!solar?.allowance

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-4xl px-6 pt-14 pb-10 sm:px-10">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          QuoteMax · Roofing
        </div>
        <h1 className="mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.5rem)]">
          Your roof <span className="text-accent">{confirmed ? 'quote' : 'measurement'}</span>
        </h1>
        {row.address && <p className="mt-4 text-lg text-text-sec">{row.address}</p>}

        {/* Pre-confirmation notice — explain why there's no price yet. */}
        {!confirmed && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card px-6 py-5">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              {structures.length > 1 ? 'Which building is yours?' : 'Is this your roof?'}
            </div>
            <p className="mt-2 text-base text-text-sec">
              {structures.length > 1
                ? "We found more than one building at this address. Reply to our text with YES for all of them, the building number for just one, or NO, and we'll send your full priced quote."
                : "Reply YES to our text and we'll send your full priced quote for this roof."}
            </p>
          </div>
        )}

        {/* Satellite views — Geoscape roof outline (Esri) + one Google
            satellite photo per shown structure, each centred on its building
            via static-map ?b=. */}
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <RoofMap
            polygon={null}
            form={primary?.metrics.form ?? 'unknown'}
            stats={primaryStats}
            buildings={mapBuildings}
            selectedId={mapBuildings[0]?.id ?? null}
          />
          {satelliteImages.map((img) => (
            <div key={img.index1Based} className="overflow-hidden border border-ink-line bg-ink-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={structureStaticMapPath(row.public_token, img.index1Based)}
                alt={`Satellite view of ${img.label} at ${row.address ?? 'the property'}`}
                className="h-112 w-full object-cover sm:h-128"
              />
              <div className="px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
                {satelliteImages.length > 1 ? `${img.label} · satellite view` : 'Google satellite view'}
              </div>
            </div>
          ))}
        </div>

        <RoofPropertyContextBlock quote={fullQuote} />

        {isInspection && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-warning bg-ink-card px-6 py-5">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-warning">
              On-site inspection needed
            </div>
            <p className="mt-2 text-base text-text-sec">
              {quote?.routing?.reason ??
                'This roof needs a quick inspection on site before we can give an accurate price.'}
            </p>
          </div>
        )}

        {/* Combined total — the quotable headline on a firm quote, or the
            indicative all-structure sum on a whole-job on-site quote. */}
        {showPrices && combinedForDisplay?.tiers && (
          <div className="mt-8 border border-ink-line border-l-4 border-l-accent bg-ink-card p-6 sm:p-8">
            <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
              {indicative ? 'Indicative estimate' : 'Combined estimate'}
              {quote?.structures?.length
                ? ` · ${quote.structures.length} structure${quote.structures.length === 1 ? '' : 's'}`
                : ''}
              {combinedForDisplay.area_m2 ? ` · ${Math.round(combinedForDisplay.area_m2)} m²` : ''}
            </div>
            {indicative && (
              <p className="mt-2 text-sm leading-relaxed text-text-sec">
                Subject to on-site confirmation. These prices are estimated from your satellite measurement;
                your roofer confirms the final price at a quick on-site visit. Reply to our text and we&apos;ll book a time.
              </p>
            )}
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {/* In indicative mode, hide any $0 tier (e.g. an asbestos roof has
                  no patch/re-roof price, only an upgrade price) so the customer
                  never sees a "$0" option. Firm quotes show all tiers. */}
              {combinedForDisplay.tiers
                .filter((t) => !indicative || t.inc_gst > 0)
                .map((t, i) => (
                <div key={i} className="border border-ink-line bg-ink-deep p-5">
                  <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                    {TIER_NAME[t.tier]}
                  </div>
                  <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-accent sm:text-4xl">
                    ${money(t.inc_gst + solarIncGst)}
                  </div>
                  <div className="mt-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-text-dim">
                    inc GST · ${money(t.ex_gst + solarExGst)} ex GST
                  </div>
                </div>
              ))}
            </div>
            {solarApplies && (
              <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-t border-ink-line pt-4">
                <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
                  Incl. solar panel detach and reinstate
                  {solar?.detection?.array_count
                    ? ` · ${solar.detection.array_count} array${solar.detection.array_count === 1 ? '' : 's'}`
                    : ''}
                </div>
                <div className="font-mono text-lg font-bold tabular-nums text-accent">
                  + ${money(solarIncGst)} inc GST
                </div>
              </div>
            )}
            {showElectricianNote && (
              <p className="mt-3 text-sm text-text-sec">{solar?.allowance?.electrician_note}</p>
            )}
          </div>
        )}

        {/* Per-structure breakdown — metrics always; prices only when confirmed. */}
        <div className="mt-10 space-y-6">
          <div className="font-mono text-[0.8rem] font-semibold uppercase tracking-[0.18em] text-accent">
            {showPrices ? 'Detailed breakdown' : 'Measured buildings'} · {structures.length} structure{structures.length === 1 ? '' : 's'}
          </div>
          {structureCards.map(({ structure: s, excluded }, i) => (
            <StructureBreakdown key={s.buildingId ?? i} structure={s} index={i} flagged={flagged.has(s.label)} showPrices={showPrices} indicative={indicative} excluded={excluded} />
          ))}
        </div>

        {/* AI "after re-roof" preview — generated FROM the satellite aerial.
            Shown LAST (after the price breakdown) so a slow first-load render
            can never hide the quote. Pre-warmed at confirm time, so it's
            usually cached by the time the customer opens this page. */}
        {showPrices && (
          <div className="mt-10 overflow-hidden border border-ink-line bg-ink-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/roofing/q/${row.public_token}/after-image`}
              alt={`AI preview of the property with a new ${primaryMaterialLabel ?? ''} roof`}
              className="h-112 w-full object-cover sm:h-144"
            />
            <div className="px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
              Preview · your roof in {primaryMaterialLabel ?? 'a new roof'} (AI generated from the satellite image)
            </div>
          </div>
        )}

        <p className="mt-8 text-sm text-text-dim">
          {showPrices
            ? 'Prices include GST and are indicative from a satellite measurement. A licensed roofer reviews every quote before any work is booked.'
            : 'Measurements are indicative from satellite imagery. Confirm your building over text and a licensed roofer reviews every quote before any work is booked.'}
        </p>
      </section>

      <div className="bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMax · Roofing
        </span>
      </div>
    </main>
  )
}

function StructureBreakdown({
  structure,
  index,
  flagged,
  showPrices,
  indicative = false,
  excluded = false,
}: {
  structure: RoofStructurePrice
  index: number
  flagged: boolean
  showPrices: boolean
  /** Whole-job on-site quote: show this structure's tiers as an indicative
   *  range rather than the "priced on site" note. */
  indicative?: boolean
  excluded?: boolean
}) {
  const m = structure.metrics
  const p = structure.price
  const edges = edgeStat(m, structure.inputs.pitch)
  const inspection = p.routing?.decision === 'inspection_required' || flagged
  return (
    <article className={`border border-ink-line bg-ink-card p-6 sm:p-7 ${excluded ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-accent">
            {structure.role === 'primary' ? 'Main dwelling' : 'Secondary structure'} · {String(index + 1).padStart(2, '0')}
            {excluded ? ' · Not included' : ''}
          </div>
          <h3 className="mt-1.5 font-extrabold uppercase tracking-[-0.02em] text-xl text-text-pri">{structure.label}</h3>
        </div>
        <span className="font-mono text-xs text-text-dim">{MATERIAL_LABEL[structure.inputs.material]}</span>
      </div>

      {/* Geoscape metrics */}
      <div className="mt-5 grid gap-4 sm:grid-cols-4">
        <MiniStat label="Sloped area" value={m.sloped_area_m2 != null ? `${Math.round(m.sloped_area_m2)} m²` : '-'} hint={m.footprint_m2 ? `Footprint ${Math.round(m.footprint_m2)} m²` : ''} />
        <MiniStat label="Roof form" value={formLabel(m.form)} hint={m.storeys != null ? `${m.storeys}-storey` : ''} />
        <MiniStat label="Hips · valleys" value={`${edges.hips ?? '?'} · ${edges.valleys ?? '?'}`} hint={`≈ ${Math.round(edges.hips_lm ?? 0)} · ${Math.round(edges.valleys_lm ?? 0)} m`} />
        {showPrices
          ? <MiniStat label="Rate" value={p.effective_rate_per_m2 ? `$${money(p.effective_rate_per_m2)}/m²` : '-'} hint={p.area_m2 ? `over ${Math.round(p.area_m2)} m²` : ''} />
          : <MiniStat label="Area" value={p.area_m2 ? `${Math.round(p.area_m2)} m²` : '-'} hint="sloped" />}
      </div>

      <RoofBuildingData metrics={m} />

      {excluded ? (
        <div className="mt-5 border border-ink-line border-l-4 border-l-text-dim bg-ink-deep px-4 py-3 text-sm text-text-sec">
          Not included in this quote — leave it out, or ask us to add it.
        </div>
      ) : !showPrices ? (
        inspection ? (
          <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3 text-sm text-text-sec">
            This structure needs a quick look on site before we can price it.
          </div>
        ) : null
      ) : inspection && !indicative ? (
        <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3 text-sm text-text-sec">
          Priced on site — {p.routing?.reason ?? 'this structure needs a quick look before we can price it.'}
        </div>
      ) : (
        <>
          {indicative && (
            <div className="mt-5 border border-ink-line border-l-4 border-l-warning bg-ink-deep px-4 py-3 text-sm text-text-sec">
              Indicative estimate — subject to on-site confirmation.
            </div>
          )}
          {/* Each tier with its scope of works. In indicative mode hide $0
              tiers (asbestos has only an upgrade price) so no "$0" is shown. */}
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {p.tiers
              .filter((t) => !indicative || t.inc_gst > 0)
              .map((t) => (
              <div key={t.tier} className="flex flex-col border border-ink-line bg-ink-deep p-5">
                <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">
                  {TIER_NAME[t.tier]}
                </div>
                <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-accent">${money(t.inc_gst)}</div>
                <div className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-text-dim">
                  inc GST · ${money(t.ex_gst)} ex
                </div>
                <p className="mt-3 text-sm leading-relaxed text-text-sec">{t.scope}</p>
              </div>
            ))}
          </div>

          {/* Loadings + call-out floor */}
          {(p.loadings_applied.length > 0 || p.call_out_minimum_applied) && (
            <div className="mt-5 space-y-1.5 text-sm text-text-sec">
              {p.loadings_applied.map((l) => (
                <p key={l.code}>+ {l.detail}</p>
              ))}
              {p.call_out_minimum_applied && <p>Minimum job charge applied (small structure).</p>}
            </div>
          )}
        </>
      )}
    </article>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-ink-line bg-ink-deep p-4">
      <div className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-text-dim">{label}</div>
      <div className="mt-2 font-mono text-lg font-bold tabular-nums text-text-pri">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-dim">{hint}</div>}
    </div>
  )
}
