// Best-effort archive+ingest of a quote on a customer PDF download
// (specs/files-tab.md R2–R5).
//
// The customer-facing PDF routes (/api/q/[token]/pdf and the roof/solar/paint
// variants) lazy-serve a document but historically never landed it in the
// tradie's Files tab. This helper closes that gap: called inside next/server
// `after()` once the PDF response is already on the wire, it rebuilds the
// (full-doc path + PII-minimized kbText) from the source row via
// loadAndBuildKbDoc and ingests through the ONE shared archiveAndIngestQuote
// path — inheriting all of its guarantees:
//   • flag-gated (no-op unless TENANT_FILESTORE_ENABLED === 'true'),
//   • orphan-safe (tenant_id null → no-op),
//   • idempotent (upsert on (tenant_id, display_name); unchanged hash skipped),
//   • never throws.
//
// It is therefore safe to call unconditionally from the success path of a PDF
// route — it must never delay or break the download.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadAndBuildKbDoc, type SourceRef } from './source-doc'
import { archiveAndIngestQuote } from './ingest-quote'

let _client: SupabaseClient | null = null
function serviceClient(): SupabaseClient {
  if (_client) return _client
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  return _client
}

/**
 * Archive a quote document identified by its source ref. Cheaply no-ops when
 * the file-store flag is off, and swallows every error — it runs post-response
 * and must never affect the PDF download.
 */
export async function archiveQuoteOnDownload(ref: SourceRef): Promise<void> {
  if (process.env.TENANT_FILESTORE_ENABLED !== 'true') return
  try {
    const built = await loadAndBuildKbDoc(serviceClient(), ref)
    if (!built) return
    await archiveAndIngestQuote({
      tenantId: built.tenantId,
      sourceKind: ref.sourceKind,
      sourceId: ref.sourceId,
      trade: built.trade,
      fullDocPath: built.fullDocPath,
      kbText: built.kbText,
      contentHash: built.contentHash,
    })
  } catch (e) {
    console.error(
      '[filestore/archive-on-download] non-fatal',
      e instanceof Error ? e.message : e,
    )
  }
}
