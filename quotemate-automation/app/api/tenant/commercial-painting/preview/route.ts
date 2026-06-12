// POST /api/tenant/commercial-painting/preview — Gemini "after repaint"
// preview for a paint run (spec §6). Source image = the run's site_photo
// upload (image file, or page 1 of an image-only PDF rasterised to PNG).
// Stateless like the residential preview routes: returns data URLs
// inline; failure is non-blocking — the quote works without a preview.
//
// Body:
//   { paintRunId, colour? }                      → initial render
//   { paintRunId, refine: { image, instruction } } → conversational edit
//     (image is the data URL returned by a previous call)

import { tenantFromBearer, estimatorSupabase } from '@/lib/estimation/auth'
import { downloadPaintDoc } from '@/lib/commercial-painting/storage'
import {
  buildCommercialRepaintPrompt,
  buildCommercialRefinePrompt,
} from '@/lib/commercial-painting/preview-prompt'
import { geminiProvider } from '@/lib/ig-engine/providers/gemini'
import { rasterizePage, cropToPng } from '@/lib/estimation/refine'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type ImageBytes = { base64: string; mime: string }

function fromDataUrl(url: string): ImageBytes | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(url)
  return m ? { mime: m[1], base64: m[2] } : null
}

function toDataUrl(img: ImageBytes): string {
  return `data:${img.mime};base64,${img.base64}`
}

export async function POST(req: Request) {
  const tenant = await tenantFromBearer(req)
  if (!tenant) return Response.json({ ok: false, error: 'unauthorised' }, { status: 401 })
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ ok: false, error: 'preview_unavailable' }, { status: 503 })
  }

  let body: {
    paintRunId?: string
    colour?: string
    refine?: { image?: string; instruction?: string }
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const paintRunId = body.paintRunId?.trim()
  if (!paintRunId) return Response.json({ ok: false, error: 'missing_paintRunId' }, { status: 400 })

  const { data: run } = await estimatorSupabase
    .from('paint_runs')
    .select('id')
    .eq('id', paintRunId)
    .eq('tenant_id', tenant.id)
    .maybeSingle()
  if (!run) return Response.json({ ok: false, error: 'run_not_found' }, { status: 404 })

  try {
    // ── Refinement pass: edit the previously returned preview. ──────
    if (body.refine?.image) {
      const source = fromDataUrl(body.refine.image)
      if (!source) return Response.json({ ok: false, error: 'invalid_refine_image' }, { status: 400 })
      const prompt = buildCommercialRefinePrompt(body.refine.instruction)
      const out = await geminiProvider.renderImage({
        system: prompt.system,
        user: prompt.user,
        sourceImage: source,
        aspectRatio: '4:3',
      })
      return Response.json({ ok: true, after: toDataUrl(out) })
    }

    // ── Initial render from the run's site photo. ────────────────────
    const { data: photo } = await estimatorSupabase
      .from('plan_uploads')
      .select('id, pdf_path, filename')
      .eq('paint_run_id', paintRunId)
      .eq('tenant_id', tenant.id)
      .eq('doc_type', 'site_photo')
      .limit(1)
      .maybeSingle()
    if (!photo?.pdf_path) {
      return Response.json({ ok: false, error: 'no_site_photo' }, { status: 422 })
    }

    const bytes = await downloadPaintDoc(photo.pdf_path as string)
    let source: ImageBytes
    if (/\.pdf$/i.test(photo.pdf_path as string)) {
      // Image-only PDF (the IGA 2.pdf case): rasterise page 1.
      const raster = await rasterizePage(bytes, 1, 1600)
      const png = await cropToPng(raster, { x: 0, y: 0, w: raster.widthPx, h: raster.heightPx })
      source = { base64: png.toString('base64'), mime: 'image/png' }
    } else {
      const mime = /\.png$/i.test(photo.pdf_path as string)
        ? 'image/png'
        : /\.webp$/i.test(photo.pdf_path as string)
          ? 'image/webp'
          : 'image/jpeg'
      source = { base64: bytes.toString('base64'), mime }
    }

    const prompt = buildCommercialRepaintPrompt({ colour: body.colour })
    const out = await geminiProvider.renderImage({
      system: prompt.system,
      user: prompt.user,
      sourceImage: source,
      aspectRatio: '4:3',
    })
    return Response.json({ ok: true, before: toDataUrl(source), after: toDataUrl(out) })
  } catch (e) {
    return Response.json(
      { ok: false, error: 'preview_failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
