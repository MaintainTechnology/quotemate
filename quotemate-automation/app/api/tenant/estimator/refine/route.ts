// POST /api/tenant/estimator/refine — tiled high-DPI recount of dense items.
//
// The single-pass take-off is unstable on dense symbol grids (downlight
// fields, GPO clusters). This route re-counts SELECTED items on ONE sheet by
// rasterising that page at high DPI, tiling it, counting per tile and deduping
// the overlaps (lib/estimation/refine.ts). Returns counts WITH per-symbol pin
// locations for the plan-overlay viewer.
//
// multipart/form-data:
//   pdf     — the plan PDF (re-uploaded; raw bytes are not stored server-side)
//   page    — 1-based PDF page of the sheet to recount
//   targets — JSON array of { type, symbol?, hint? }

import { tenantFromBearer } from '@/lib/estimation/auth'
import { refineCounts, type RefineTarget } from '@/lib/estimation/refine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Rasterise + up to ~12 tile counts; comfortably under the extract route's cap.
export const maxDuration = 300

const MAX_PDF_BYTES = 32 * 1024 * 1024
const MAX_TARGETS = 12

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ ok: false, error: 'expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('pdf')
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'missing "pdf" file' }, { status: 400 })
  }
  if (file.size > MAX_PDF_BYTES) {
    return Response.json(
      { ok: false, error: `PDF too large (${(file.size / 1e6).toFixed(1)} MB; max 32 MB)` },
      { status: 413 },
    )
  }

  const page = Math.round(Number(form.get('page')))
  if (!Number.isFinite(page) || page < 1) {
    return Response.json({ ok: false, error: '"page" must be a positive 1-based page number' }, { status: 400 })
  }

  let targets: RefineTarget[]
  try {
    const raw = JSON.parse(String(form.get('targets') ?? '[]')) as unknown
    if (!Array.isArray(raw)) throw new Error('not an array')
    targets = raw
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => ({
        type: String(t.type ?? '').trim(),
        symbol: t.symbol != null ? String(t.symbol) : '',
        ...(t.hint != null && String(t.hint).trim() ? { hint: String(t.hint) } : {}),
      }))
      .filter((t) => t.type)
      .slice(0, MAX_TARGETS)
  } catch {
    return Response.json({ ok: false, error: '"targets" must be a JSON array of { type, symbol?, hint? }' }, { status: 400 })
  }
  if (targets.length === 0) {
    return Response.json({ ok: false, error: 'no valid targets to refine' }, { status: 400 })
  }

  const pdf = Buffer.from(await file.arrayBuffer())
  try {
    const result = await refineCounts({ pdf, page, targets })
    return Response.json({ ok: true, ...result })
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'refine failed' },
      { status: 502 },
    )
  }
}
