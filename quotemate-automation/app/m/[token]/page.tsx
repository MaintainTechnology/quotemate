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
// Maintain Technology brand: dark navy, vibrant orange, all-caps display.

import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import type { MultiRoofQuote } from '@/lib/roofing/types'
import { allStructureIndices, sanitizeIndices, structureCount } from '@/lib/roofing/selection'
import { MeasurementReview } from './MeasurementReview'

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
  quote: MultiRoofQuote | null
  measure_token: string
  public_token: string
  included_indices: number[] | null
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
    .select('address, state, provider, routing, quote, measure_token, public_token, included_indices')
    .eq('measure_token', token)
    .maybeSingle()

  if (error || !data) notFound()
  const row = data as Row
  const quote = row.quote
  const count = structureCount(quote)
  if (!quote || count === 0) notFound()

  const sanitized = sanitizeIndices(row.included_indices, count)
  const included = sanitized.length > 0 ? sanitized : allStructureIndices(count)

  return (
    <main className="min-h-screen bg-ink-deep text-text-pri">
      <section className="mx-auto max-w-5xl px-6 pt-14 pb-10 sm:px-10">
        <div className="font-mono text-[0.78rem] font-semibold uppercase tracking-[0.18em] text-accent">
          QuoteMax · Roofing · Measurement
        </div>
        <h1 className="mt-3 font-extrabold uppercase leading-[0.95] tracking-[-0.035em] text-[clamp(2rem,5vw,3.5rem)]">
          Measurement <span className="text-accent">results</span>
        </h1>
        {row.address && <p className="mt-4 text-lg text-text-sec">{row.address}</p>}
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-text-sec">
          Every structure measured at this property
          {row.provider ? ` (via ${row.provider})` : ''}. Untick any structure
          you don&rsquo;t want in the job — your selection is what the customer
          quote and the PDF are priced from.
        </p>

        {/* Satellite / aerial view of the property (same source the customer
            quote page uses), keyed by the customer public_token. */}
        <div className="mt-8 overflow-hidden border border-ink-line bg-ink-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/roofing/q/${row.public_token}/static-map`}
            alt={`Satellite view of the roof at ${row.address ?? 'the property'}`}
            className="h-112 w-full object-cover sm:h-128"
          />
          <div className="px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] text-text-dim">
            Google satellite view
          </div>
        </div>

        <MeasurementReview
          measureToken={row.measure_token}
          publicToken={row.public_token}
          routing={row.routing}
          structures={quote.structures}
          initialIncluded={included}
        />
      </section>

      <div className="bg-accent px-6 py-5 text-center text-white">
        <span className="font-mono text-sm font-semibold uppercase tracking-[0.16em]">
          QuoteMax · Roofing · Measurement
        </span>
      </div>
    </main>
  )
}
