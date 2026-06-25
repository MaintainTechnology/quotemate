// Rebuild a document's (fullDocPath + PII-minimized kbText) from its source row.
//
// Shared by the BACKFILL (scripts/backfill-tenant-filestore.mjs) and the
// reconcile cron's failed-retry path. Given a (sourceKind, sourceId, trade), it
// loads the source row, EAGERLY renders the full PDF via the trade's `ensure*Pdf`
// (so lazy painting/roofing/solar rows get materialized first — spec R14), and
// builds the minimized markdown. Returns null when no full doc can be produced
// (Gotenberg down / inspection-routed), which keeps the lockstep invariant: no
// KB ingest without an archived full doc.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ensureQuotePdf,
  ensureRoofQuotePdf,
  ensureSolarQuotePdf,
  ensurePaintingPdf,
} from '@/lib/quote/pdf'
import { buildInvoiceKbText, buildQuoteKbText } from './minimize'
import { normalizeTradeForDoc } from './tenant-store-name'
import { partitionRoofQuote, resolveEffectiveIndices } from '@/lib/roofing/selection'
import type { MultiRoofQuote } from '@/lib/roofing/types'

export type SourceRef = {
  sourceKind: 'quote' | 'invoice'
  sourceId: string
  trade?: string | null
}

export type BuiltDoc = {
  tenantId: string | null
  trade: string | null
  fullDocPath: string | null
  kbText: string
  contentHash: string
} | null

export async function loadAndBuildKbDoc(
  supabase: Pick<SupabaseClient, 'from'>,
  ref: SourceRef,
): Promise<BuiltDoc> {
  try {
    if (ref.sourceKind === 'invoice') return await buildInvoice(supabase, ref.sourceId)

    const trade = (ref.trade ?? '').toLowerCase()
    if (trade === 'electrical' || trade === 'plumbing') {
      const { data: q } = await supabase
        .from('quotes')
        .select('*')
        .eq('id', ref.sourceId)
        .maybeSingle<Record<string, any>>()
      if (!q) return null
      const fullDocPath = await ensureQuotePdf(q.id)
      if (!fullDocPath) return null
      const { markdown, contentHash } = buildQuoteKbText({ quote: q, trade })
      return { tenantId: q.tenant_id ?? null, trade, fullDocPath, kbText: markdown, contentHash }
    }

    if (trade === 'roofing') {
      const { data: r } = await supabase
        .from('roofing_measurements')
        .select('tenant_id, public_token, quote, routing, included_indices, confirmed_structure')
        .eq('public_token', ref.sourceId)
        .maybeSingle<Record<string, any>>()
      if (!r) return null
      // Render the archived/KB PDF from the tradie's structure selection — the
      // SAME narrowing the customer download route uses — so this path can
      // never materialize a full-quote (over-counted) PDF or poison the cache.
      const fullQuote = (r.quote ?? null) as MultiRoofQuote | null
      const effective = resolveEffectiveIndices(
        {
          included: r.included_indices as number[] | null,
          confirmedStructure: r.confirmed_structure as number | null,
        },
        fullQuote,
      )
      const partition = fullQuote ? partitionRoofQuote(fullQuote, effective) : null
      const fullDocPath = await ensureRoofQuotePdf(
        r.public_token,
        partition ? { quote: partition.narrowed, displayRows: partition.rows } : {},
      )
      if (!fullDocPath) return null
      const { markdown, contentHash } = buildQuoteKbText({
        quote: { estimate: r.quote, routing_decision: r.routing },
        trade: 'roofing',
      })
      return { tenantId: r.tenant_id ?? null, trade: 'roofing', fullDocPath, kbText: markdown, contentHash }
    }

    if (trade === 'solar') {
      const { data: s } = await supabase
        .from('solar_estimates')
        .select('tenant_id, public_token, estimate, routing')
        .eq('public_token', ref.sourceId)
        .maybeSingle<Record<string, any>>()
      if (!s) return null
      const fullDocPath = await ensureSolarQuotePdf(s.public_token)
      if (!fullDocPath) return null
      const { markdown, contentHash } = buildQuoteKbText({
        quote: { estimate: s.estimate, routing_decision: s.routing },
        trade: 'solar',
      })
      return { tenantId: s.tenant_id ?? null, trade: 'solar', fullDocPath, kbText: markdown, contentHash }
    }

    if (normalizeTradeForDoc(trade) === 'painting') {
      const { data: p } = await supabase
        .from('painting_measurements')
        .select('tenant_id, public_token, estimate, routing')
        .eq('public_token', ref.sourceId)
        .maybeSingle<Record<string, any>>()
      if (!p) return null
      const fullDocPath = await ensurePaintingPdf(p.public_token)
      if (!fullDocPath) return null
      const { markdown, contentHash } = buildQuoteKbText({
        quote: { estimate: p.estimate, routing_decision: p.routing },
        trade: 'painting',
      })
      return { tenantId: p.tenant_id ?? null, trade: 'painting', fullDocPath, kbText: markdown, contentHash }
    }

    return null
  } catch (e) {
    console.error('[filestore/source-doc] loadAndBuildKbDoc failed (non-fatal):', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Invoice rebuild. The full raw image must already be archived (the calibration
 * route does this going forward). For historical rows without a retrievable
 * archive path, returns null fullDocPath → the helper no-ops (lockstep).
 */
async function buildInvoice(supabase: Pick<SupabaseClient, 'from'>, uploadId: string): Promise<BuiltDoc> {
  const { data: up } = await supabase
    .from('invoice_uploads')
    .select('*')
    .eq('id', uploadId)
    .maybeSingle<Record<string, any>>()
  if (!up) return null

  const { data: ext } = await supabase
    .from('invoice_extractions')
    .select('*')
    .eq('upload_id', uploadId)
    .maybeSingle<Record<string, any>>()
  const extraction = ext?.raw ?? ext ?? null
  if (!extraction) return null

  const { markdown, contentHash } = buildInvoiceKbText({ extraction })
  // Use a previously-archived path if the row carries one; otherwise leave null
  // so the ingest helper no-ops rather than ingesting without a full archive.
  const fullDocPath: string | null =
    up.storage_path ?? up.file_path ?? up.image_path ?? null
  return { tenantId: up.tenant_id ?? null, trade: null, fullDocPath, kbText: markdown, contentHash }
}
