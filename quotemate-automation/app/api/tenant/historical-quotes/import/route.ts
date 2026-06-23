// POST /api/tenant/historical-quotes/import (spec R3) — accept one CSV or PDF of
// the tradie's quote history. Fast-acks with the batch id, then parses +
// categorises in next/server after(). Tenant-scoped via the shared bearer auth.

import { after } from 'next/server'
import { tenantFromBearer } from '@/lib/estimation/auth'
import { createImportBatch } from '@/lib/historical-quotes/repo'
import { runHistoricalImport } from '@/lib/historical-quotes/import-run'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BYTES = 10 * 1024 * 1024 // 10MB (spec edge case: reject over-cap uploads)

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'invalid_form' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'no_file' }, { status: 400 })

  const name = file.name || 'upload'
  const lower = name.toLowerCase()
  const isCsv = lower.endsWith('.csv') || file.type === 'text/csv'
  const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf'
  if (!isCsv && !isPdf) {
    return Response.json(
      { error: 'unsupported_type', detail: 'Upload a .csv or .pdf file' },
      { status: 400 },
    )
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  if (buf.byteLength === 0) return Response.json({ error: 'empty_file' }, { status: 400 })
  if (buf.byteLength > MAX_BYTES) {
    return Response.json({ error: 'file_too_large', detail: 'Max 10MB' }, { status: 413 })
  }

  const sourceKind = isCsv ? 'csv' : 'pdf'
  const batchId = await createImportBatch({ tenantId: tenant.id, sourceKind, filename: name })
  if (!batchId) return Response.json({ error: 'batch_create_failed' }, { status: 500 })

  after(async () => {
    await runHistoricalImport({
      tenantId: tenant.id,
      batchId,
      sourceKind,
      filename: name,
      bytes: buf,
      tenantTradeHint: tenant.trade,
    })
  })

  return Response.json({ batchId, status: 'parsing' })
}
