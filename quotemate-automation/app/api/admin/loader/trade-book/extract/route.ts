// POST /api/admin/loader/trade-book/extract — trade-book extraction
// (Phase E build, follow-on to the spike at public/docs/trade-book-pipeline-spike.html).
//
// Given a mt-filestore-kb store id (a tradie's pricing guide already
// uploaded + indexed via the mt-filestore-kb dashboard), runs the
// structured-extraction prompt and stages every extracted service as a
// row in import_staged_rows. Each row carries source_ref +
// source_document (migration 070) so the operator review UI can show
// citations and click through to the original PDF.
//
// Admin-only — uses the same resolveAdminUserId gate as the existing
// /api/admin/loader/upload route. No live table is touched here; that
// happens at /api/admin/loader/batch/[id]/approve (the existing commit
// path) once the operator has reviewed the staged rows.

import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { resolveAdminUserId } from '@/lib/admin-loader/route-auth'
import { createBatch } from '@/lib/admin-loader/store'
import {
  extractTradeBook,
  toAssemblyPayload,
} from '@/lib/admin-loader/trade-book-extract'
import { loadKbConfigFromEnv } from '@/lib/admin-loader/mt-filestore-kb'

export const dynamic = 'force-dynamic'
// Extraction can take ~30-90s depending on document length. Mirror the
// raised limit on other LLM routes.
export const maxDuration = 180

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RequestSchema = z.object({
  /** Idempotency key — same purpose as the CSV upload route's. Required
   *  so accidental double-submits don't create two batches against the
   *  same extraction run. */
  idempotencyKey: z.string().min(8).max(200),
  /** Store id (or full "fileSearchStores/..." resource name) for the
   *  indexed PDF in mt-filestore-kb. */
  storeId: z.string().min(1).max(200),
  /** Optional trade hint to bias the extraction prompt. */
  trade: z.string().min(2).max(40).optional(),
  /** Optional metadata filter passed to mt-filestore-kb to scope to one
   *  document when the store carries several. */
  metadataFilter: z.string().max(400).optional(),
  /** Optional model override (default: server default in mt-filestore-kb). */
  model: z.string().max(80).optional(),
  /** Optional human-readable label for source_document on staged rows
   *  (e.g. "Sparky pricing guide 2024"). Falls back to the storeId. */
  sourceDocument: z.string().max(200).optional(),
})

export async function POST(req: Request) {
  const adminId = await resolveAdminUserId(supabase, req)
  if (!adminId) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    )
  }

  // Load KB config at request time — throws a clear error when the env
  // vars are missing, which the operator UI can surface directly.
  let kbConfig
  try {
    kbConfig = loadKbConfigFromEnv()
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `mt-filestore-kb not configured: ${e?.message ?? String(e)}` },
      { status: 503 },
    )
  }

  // Run the extraction.
  let extract
  try {
    extract = await extractTradeBook({
      config: kbConfig,
      storeId: parsed.data.storeId,
      ...(parsed.data.trade ? { trade: parsed.data.trade } : {}),
      ...(parsed.data.metadataFilter ? { metadataFilter: parsed.data.metadataFilter } : {}),
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
    })
  } catch (e: any) {
    return Response.json(
      { ok: false, error: `extraction failed: ${e?.message ?? String(e)}` },
      { status: 502 },
    )
  }

  if (!extract.rows.length) {
    return Response.json(
      {
        ok: false,
        error: 'no rows extracted',
        parseErrors: extract.errors,
        rawAnswer: extract.kbResult.answer.slice(0, 2000),
      },
      { status: 422 },
    )
  }

  // Create the batch (idempotent on idempotencyKey).
  const batchResult = await createBatch(supabase, {
    idempotencyKey: parsed.data.idempotencyKey,
    adminUserId: adminId,
    source: 'trade-book-extract',
  })
  if (!batchResult.ok) {
    return Response.json({ ok: false, error: batchResult.error }, { status: 500 })
  }
  const batchId = batchResult.batchId

  if (batchResult.alreadyExists) {
    return Response.json(
      {
        ok: true,
        batchId,
        alreadyExists: true,
        note: 'idempotency key matched an existing batch — re-running extraction would duplicate rows. Returning the existing batchId without staging.',
      },
      { status: 200 },
    )
  }

  // Stage the extracted rows. Each service → import_staged_rows row
  // with target_table='shared_assemblies'. Each of its materials →
  // import_staged_rows row with target_table='shared_materials'.
  const stagedInserts: Array<Record<string, unknown>> = []
  const sourceDocument = parsed.data.sourceDocument ?? parsed.data.storeId

  for (const svc of extract.rows) {
    const payload = toAssemblyPayload(svc)
    const materials = (payload._materials as any[]) ?? []
    delete payload._materials

    stagedInserts.push({
      batch_id: batchId,
      target_table: 'shared_assemblies',
      row_class: 'NEW',
      payload,
      validation_status: 'passed',
      smoke_status: 'skipped', // the existing commit gate runs smoke separately
      source_ref: svc.source_citation,
      source_document: sourceDocument,
    })

    for (const m of materials) {
      stagedInserts.push({
        batch_id: batchId,
        target_table: 'shared_materials',
        row_class: 'NEW',
        payload: {
          trade: svc.trade,
          name: m.name,
          brand: m.brand ?? null,
          unit: m.unit ?? svc.default_unit ?? 'each',
          default_unit_price_ex_gst: m.unit_price_ex_gst,
        },
        validation_status: 'passed',
        smoke_status: 'skipped',
        source_ref: svc.source_citation,
        source_document: sourceDocument,
      })
    }
  }

  if (stagedInserts.length > 0) {
    const { error: insErr } = await supabase
      .from('import_staged_rows')
      .insert(stagedInserts)
    if (insErr) {
      return Response.json(
        { ok: false, error: `staging failed: ${insErr.message}` },
        { status: 500 },
      )
    }
  }

  return Response.json(
    {
      ok: true,
      batchId,
      alreadyExists: false,
      stagedServices: extract.rows.length,
      stagedMaterials: stagedInserts.length - extract.rows.length,
      parseErrors: extract.errors,
      modelUsed: extract.kbResult.modelUsed ?? null,
      sourceDocument,
    },
    { status: 200 },
  )
}
