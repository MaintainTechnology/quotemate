// Import orchestration (spec R3–R7). Runs post-ack inside the import route's
// next/server after(): parse → map columns (csv) / extract text (pdf) →
// categorise each row → persist. Never throws into the route; on any failure
// the batch is flipped to status='failed' with a human-readable error.

import { MAX_HISTORICAL_ROWS, parseHistoricalCsv } from './parse-csv'
import { extractPdfText, extractTotalFromText } from './parse-pdf'
import { mapColumns } from './column-map'
import { categorizeQuote } from './categorize'
import { splitGst } from './gst'
import { contentHash } from './content-hash'
import {
  insertHistoricalQuotes,
  registerFileDocument,
  updateBatch,
  uploadHistoricalPdf,
  type InsertHistoricalQuote,
} from './repo'
import { addDocumentToTenantStore, ensureTenantStore } from '@/lib/filestore/tenant-store'
import type { GstBasis } from './types'

function parsePrice(raw: string | undefined | null): number | null {
  if (raw == null) return null
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function detectGstBasis(raw: string | undefined | null): GstBasis {
  const s = (raw ?? '').toLowerCase()
  if (/ex\s*gst|excl|plus\s*gst|\+\s*gst|\bex\b/.test(s)) return 'ex'
  if (/inc\s*gst|incl|gst\s*inc|\binc\b/.test(s)) return 'inc'
  return 'unknown'
}

/** Parse a date cell. Handles AU dd/mm/yyyy first, then anything Date.parse groks. */
export function parseQuoteDate(raw: string | undefined | null): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  const au = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/)
  if (au) {
    const d = au[1]
    const m = au[2]
    let y = au[3]
    if (y.length === 2) y = `20${y}`
    const iso = `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    if (!Number.isNaN(Date.parse(iso))) return iso
  }
  const t = Date.parse(s)
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  return null
}

function buildHistoricalKbText(args: {
  filename: string
  jobType: string
  priceInc: number | null
  priceEx: number | null
  quotedAt: string | null
  description: string
}): string {
  // PII-minimized: job/scope/price only — no customer contact details.
  const lines = [
    `# Historical quote — ${args.jobType}`,
    `Source: ${args.filename}`,
    args.quotedAt ? `Quoted: ${args.quotedAt}` : '',
    args.priceInc != null ? `Price (inc GST): $${args.priceInc.toFixed(2)}` : '',
    args.priceEx != null ? `Price (ex GST): $${args.priceEx.toFixed(2)}` : '',
    '',
    'Scope:',
    args.description.slice(0, 1200),
  ]
  return lines.filter((l) => l !== '').join('\n')
}

export type RunImportArgs = {
  tenantId: string
  batchId: string
  sourceKind: 'csv' | 'pdf'
  filename: string
  bytes: Uint8Array
  tenantTradeHint?: string | null
  gstRegistered?: boolean
}

export async function runHistoricalImport(args: RunImportArgs): Promise<void> {
  try {
    if (args.sourceKind === 'csv') await runCsvImport(args)
    else await runPdfImport(args)
  } catch (e) {
    await updateBatch(args.tenantId, args.batchId, {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

async function runCsvImport(args: RunImportArgs): Promise<void> {
  const { tenantId, batchId } = args
  const gstRegistered = args.gstRegistered ?? true
  const text = new TextDecoder().decode(args.bytes)
  const parsed = parseHistoricalCsv(text)
  if (parsed.error) {
    await updateBatch(tenantId, batchId, { status: 'failed', error: parsed.error })
    return
  }
  if (parsed.records.length === 0) {
    await updateBatch(tenantId, batchId, { status: 'failed', error: 'no rows found' })
    return
  }
  // No silent truncation: reject an over-cap file outright rather than importing
  // a partial subset (spec edge case).
  if (parsed.truncated) {
    await updateBatch(tenantId, batchId, {
      status: 'failed',
      error: `file exceeds the ${MAX_HISTORICAL_ROWS}-row import limit — split it into smaller files`,
    })
    return
  }

  await updateBatch(tenantId, batchId, { status: 'categorizing', row_count: parsed.records.length })
  const mapping = await mapColumns(parsed.header, parsed.records)
  await updateBatch(tenantId, batchId, { column_mapping: mapping })

  const rows: InsertHistoricalQuote[] = []
  for (const rec of parsed.records) {
    const desc = mapping.description ? (rec[mapping.description] ?? null) : null
    const priceRaw = mapping.price ? rec[mapping.price] : null
    const price = parsePrice(priceRaw)
    // GST basis: prefer an explicit basis column; else sniff the price cell text.
    const basis = mapping.gst_basis ? detectGstBasis(rec[mapping.gst_basis]) : detectGstBasis(priceRaw)
    const quotedAt = mapping.date ? parseQuoteDate(rec[mapping.date]) : null
    const cat = await categorizeQuote({ description: desc, tradeHint: args.tenantTradeHint })
    const split = splitGst(price, basis, gstRegistered)
    rows.push({
      tenant_id: tenantId,
      batch_id: batchId,
      source_kind: 'csv',
      trade: cat.trade ?? args.tenantTradeHint ?? null,
      job_type: cat.job_type,
      job_type_confidence: cat.confidence,
      raw_description: desc,
      quoted_at: quotedAt,
      price_ex_gst: split?.ex ?? null,
      price_inc_gst: split?.inc ?? null,
      gst_basis: basis,
      file_document_id: null,
      content_hash: contentHash([tenantId, desc, priceRaw, quotedAt]),
      raw_row: rec,
    })
  }

  await insertHistoricalQuotes(rows)
  await updateBatch(tenantId, batchId, { status: 'awaiting_review' })
}

async function runPdfImport(args: RunImportArgs): Promise<void> {
  const { tenantId, batchId, filename } = args
  const gstRegistered = args.gstRegistered ?? true
  const text = await extractPdfText(args.bytes)
  if (!text || text.length < 20) {
    await updateBatch(tenantId, batchId, {
      status: 'failed',
      error: 'no extractable text — image-only PDFs are not supported (export a text PDF or CSV)',
    })
    return
  }

  await updateBatch(tenantId, batchId, { status: 'categorizing', row_count: 1 })
  const cat = await categorizeQuote({ description: text.slice(0, 4000), tradeHint: args.tenantTradeHint })
  const price = extractTotalFromText(text)
  const basis = detectGstBasis(text)
  const split = splitGst(price, basis, gstRegistered)

  // Store the raw PDF + register a browsable file-document row; best-effort KB.
  const storagePath = await uploadHistoricalPdf({ tenantId, batchId, filename, bytes: args.bytes })
  let fileDocId: string | null = null
  if (storagePath) {
    const displayName = `Historical quote — ${filename}`
    let kbDocumentId: string | null = null
    let state: 'pending' | 'active' = 'pending'
    try {
      const storeId = await ensureTenantStore(tenantId, null)
      if (storeId) {
        const md = buildHistoricalKbText({
          filename,
          jobType: cat.job_type,
          priceInc: split?.inc ?? null,
          priceEx: split?.ex ?? null,
          quotedAt: null,
          description: text,
        })
        const res = await addDocumentToTenantStore({
          tenantId,
          storeId,
          fileBytes: new TextEncoder().encode(md),
          displayName,
          mimeType: 'text/markdown',
        })
        if (res?.kbDocumentId) {
          kbDocumentId = res.kbDocumentId
          state = 'active'
        }
      }
    } catch {
      // KB unavailable — the doc is still stored + browsable; reconcile can retry.
    }
    fileDocId = await registerFileDocument({
      tenantId,
      sourceId: batchId,
      trade: cat.trade,
      displayName,
      storagePath,
      bytes: args.bytes.byteLength,
      state,
      kbDocumentId,
    })
  }

  await insertHistoricalQuotes([
    {
      tenant_id: tenantId,
      batch_id: batchId,
      source_kind: 'pdf',
      trade: cat.trade ?? args.tenantTradeHint ?? null,
      job_type: cat.job_type,
      job_type_confidence: cat.confidence,
      raw_description: text.slice(0, 2000),
      quoted_at: null,
      price_ex_gst: split?.ex ?? null,
      price_inc_gst: split?.inc ?? null,
      gst_basis: basis,
      file_document_id: fileDocId,
      content_hash: contentHash([tenantId, filename, String(args.bytes.byteLength)]),
      raw_row: null,
    },
  ])
  await updateBatch(tenantId, batchId, { status: 'awaiting_review' })
}
