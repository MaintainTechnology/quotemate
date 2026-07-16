// /api/roofing/model3d/[token] — the property's interactive 3D model
// (Track B: visual only; never feeds measurements or pricing).
//
//   POST — body { captures: [front, left, back, right] } as JPEG data URLs
//          captured client-side from the Google Photorealistic 3D view.
//          CAS-claims model3d_status then fast-acks; enhancement (Gemini
//          nano-banana), Tripo upload and task creation run in after().
//   GET  — poll. Proxies the Tripo task state; on success downloads the GLB
//          (Tripo URLs expire in ~5 min) into storage and returns a signed
//          URL the three.js viewer loads directly.
//
// Keyed by measure_token (the tradie capability token), same trust model as
// PATCH /api/roofing/measurement/[token].

import { after } from 'next/server'
import { z } from 'zod'
import { claimModel3d, pollModel3d, startModel3d } from '@/lib/roofing/model3d'

export const dynamic = 'force-dynamic'
// Gemini enhancement × 4 + Tripo upload run past the response in after();
// needs more than Hobby's 10s (repo convention: Pro or Railway).
export const maxDuration = 300

const BodySchema = z.object({
  // 4 orbit captures, front/left/back/right. ~250 KB each as JPEG data URLs;
  // 8 MB cap guards the route against oversized canvases.
  captures: z.array(z.string().min(100).max(8_000_000)).length(4),
})

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }
  const state = await pollModel3d(token)
  if (!state) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })
  return Response.json({ ok: true, ...state })
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }
  if (!process.env.TRIPO_API_KEY?.trim()) {
    return Response.json(
      { ok: false, error: 'TRIPO_API_KEY is not configured — 3D model generation is disabled.' },
      { status: 422 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'invalid_request' }, { status: 400 })
  }

  const claimed = await claimModel3d(token)
  if (!claimed) {
    return Response.json(
      { ok: false, error: 'A 3D model is already being generated for this measurement.' },
      { status: 409 },
    )
  }

  const captures = parsed.data.captures
  after(() => startModel3d(token, captures))
  return Response.json({ ok: true, status: 'generating' })
}
