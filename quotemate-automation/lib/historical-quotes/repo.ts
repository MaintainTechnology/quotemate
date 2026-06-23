// DB + storage access for Historical Quotes. Service-role client (RLS bypassed);
// EVERY query filters by the authenticated tenant_id — the routes pass it in.
// Module-level createClient so route tests can mock @supabase/supabase-js.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AnalyticsInputRow, BatchStatus, Confidence, ImportSourceKind } from './types'
import { sortForReview } from './review-order'

const PDF_BUCKET = 'quote-pdfs'

const supabase: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

// ── Import batches ──────────────────────────────────────────────────
export async function createImportBatch(args: {
  tenantId: string
  sourceKind: ImportSourceKind
  filename: string | null
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('tenant_historical_import_batches')
    .insert({
      tenant_id: args.tenantId,
      source_kind: args.sourceKind,
      filename: args.filename,
      status: 'parsing',
    })
    .select('id')
    .single()
  if (error || !data) return null
  return (data as { id: string }).id
}

export async function updateBatch(
  tenantId: string,
  batchId: string,
  patch: Partial<{
    status: BatchStatus
    column_mapping: unknown
    row_count: number
    error: string | null
  }>,
): Promise<void> {
  await supabase
    .from('tenant_historical_import_batches')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', batchId)
}

export async function getBatch(tenantId: string, batchId: string) {
  const { data } = await supabase
    .from('tenant_historical_import_batches')
    .select('id, source_kind, filename, status, column_mapping, row_count, error, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('id', batchId)
    .maybeSingle()
  return data ?? null
}

const ROW_COLUMNS =
  'id, source_kind, trade, job_type, job_type_confidence, raw_description, quoted_at, price_ex_gst, price_inc_gst, gst_basis, status, file_document_id, created_at'

export async function getBatchRows(tenantId: string, batchId: string) {
  const { data } = await supabase
    .from('tenant_historical_quotes')
    .select(ROW_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })
  // Surface low-confidence / 'other' rows first so the tradie fixes the weakest
  // matches before confirming (spec edge case).
  return sortForReview(
    (data ?? []) as Array<{
      job_type_confidence?: string | null
      job_type?: string | null
      created_at?: string | null
    }>,
  )
}

// ── Insert imported rows ────────────────────────────────────────────
export type InsertHistoricalQuote = {
  tenant_id: string
  batch_id: string
  source_kind: ImportSourceKind
  trade: string | null
  job_type: string | null
  job_type_confidence: Confidence | null
  raw_description: string | null
  quoted_at: string | null
  price_ex_gst: number | null
  price_inc_gst: number | null
  gst_basis: 'inc' | 'ex' | 'unknown'
  file_document_id: string | null
  content_hash: string | null
  raw_row: Record<string, unknown> | null
}

/** Insert rows, ignoring re-imported duplicates via the (tenant_id, content_hash)
 *  unique index. Returns the number of NEWLY inserted rows. */
export async function insertHistoricalQuotes(rows: InsertHistoricalQuote[]): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await supabase
    .from('tenant_historical_quotes')
    .upsert(rows, { onConflict: 'tenant_id,content_hash', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

// ── Browse / analytics ──────────────────────────────────────────────
export type BrowseFilters = {
  job_type?: string | null
  trade?: string | null
  from?: string | null
  to?: string | null
  q?: string | null
}

export async function listConfirmed(tenantId: string, filters: BrowseFilters) {
  let query = supabase
    .from('tenant_historical_quotes')
    .select(ROW_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
  if (filters.job_type) query = query.eq('job_type', filters.job_type)
  if (filters.trade) query = query.eq('trade', filters.trade)
  if (filters.from) query = query.gte('quoted_at', filters.from)
  if (filters.to) query = query.lte('quoted_at', filters.to)
  if (filters.q) query = query.ilike('raw_description', `%${filters.q}%`)
  const { data } = await query.order('quoted_at', { ascending: false, nullsFirst: false })
  return data ?? []
}

/** Confirmed rows in the minimal shape the analytics aggregator needs. */
export async function getAnalyticsRows(
  tenantId: string,
  jobType?: string | null,
): Promise<AnalyticsInputRow[]> {
  let query = supabase
    .from('tenant_historical_quotes')
    .select('job_type, trade, price_inc_gst, price_ex_gst, quoted_at, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
  if (jobType) query = query.eq('job_type', jobType)
  const { data } = await query
  return (data ?? []) as AnalyticsInputRow[]
}

// ── Review ──────────────────────────────────────────────────────────
export async function applyReview(
  tenantId: string,
  updates: Array<{ id: string; job_type?: string | null; status: 'confirmed' | 'rejected' }>,
): Promise<number> {
  let n = 0
  for (const u of updates) {
    const patch: Record<string, unknown> = { status: u.status }
    if (u.job_type !== undefined) patch.job_type = u.job_type
    const { error } = await supabase
      .from('tenant_historical_quotes')
      .update(patch)
      .eq('tenant_id', tenantId)
      .eq('id', u.id)
    if (!error) n++
  }
  return n
}

// ── Calibration targets ─────────────────────────────────────────────
/** lower(name) → existing default_unit_price_ex_gst for this tenant. */
export async function getExistingCustomAssemblyPrices(
  tenantId: string,
  trade?: string | null,
): Promise<Map<string, number>> {
  let query = supabase
    .from('tenant_custom_assemblies')
    .select('name, default_unit_price_ex_gst, trade')
    .eq('tenant_id', tenantId)
  if (trade) query = query.eq('trade', trade)
  const { data } = await query
  const map = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ name: string; default_unit_price_ex_gst: number }>) {
    if (r.name) map.set(r.name.toLowerCase(), Number(r.default_unit_price_ex_gst))
  }
  return map
}

/** Upsert calibrated rows into tenant_custom_assemblies, keyed on
 *  (tenant_id, trade, lower(name)). Returns rows written. Each written row is
 *  enabled=true + always_inspection=false so the estimator's lookup_assembly
 *  picks it up. */
export async function upsertCustomAssemblies(
  rows: Array<{
    tenant_id: string
    trade: string
    name: string
    default_unit_price_ex_gst: number
    description?: string | null
  }>,
): Promise<number> {
  let n = 0
  for (const row of rows) {
    const { data: existing } = await supabase
      .from('tenant_custom_assemblies')
      .select('id')
      .eq('tenant_id', row.tenant_id)
      .eq('trade', row.trade)
      .ilike('name', row.name)
      .maybeSingle()
    if (existing && (existing as { id: string }).id) {
      const { error } = await supabase
        .from('tenant_custom_assemblies')
        .update({ default_unit_price_ex_gst: row.default_unit_price_ex_gst, enabled: true })
        .eq('id', (existing as { id: string }).id)
      if (!error) n++
    } else {
      const { error } = await supabase.from('tenant_custom_assemblies').insert({
        tenant_id: row.tenant_id,
        trade: row.trade,
        name: row.name,
        description: row.description ?? 'Calibrated from historical quotes',
        default_unit_price_ex_gst: row.default_unit_price_ex_gst,
        default_labour_hours: 0,
        always_inspection: false,
        enabled: true,
      })
      if (!error) n++
    }
  }
  return n
}

// ── PDF storage + file-document registration ────────────────────────
export async function uploadHistoricalPdf(args: {
  tenantId: string
  batchId: string
  filename: string
  bytes: Uint8Array
}): Promise<string | null> {
  const safe = args.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'quote.pdf'
  const path = `historical/${args.tenantId}/${args.batchId}/${safe}`
  const { error } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(path, args.bytes, { contentType: 'application/pdf', upsert: true })
  if (error) return null
  return path
}

/** Register a browsable tenant_file_documents row for an imported PDF
 *  (source_kind='historical_quote'). Upserts on (tenant_id, display_name). */
export async function registerFileDocument(args: {
  tenantId: string
  sourceId: string
  trade: string | null
  displayName: string
  storagePath: string
  bytes: number
  state?: 'pending' | 'active'
  kbDocumentId?: string | null
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('tenant_file_documents')
    .upsert(
      {
        tenant_id: args.tenantId,
        source_kind: 'historical_quote',
        source_id: args.sourceId,
        trade: args.trade,
        display_name: args.displayName,
        storage_path: args.storagePath,
        kb_document_id: args.kbDocumentId ?? null,
        state: args.state ?? 'pending',
        bytes: args.bytes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,display_name' },
    )
    .select('id')
    .single()
  if (error || !data) return null
  return (data as { id: string }).id
}
