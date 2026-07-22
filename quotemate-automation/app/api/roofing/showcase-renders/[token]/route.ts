// ════════════════════════════════════════════════════════════════════
// POST /api/roofing/showcase-renders/[token] — TRADIE-side warm-up of the
// per-material studio renders behind the customer showcase.
//
// Token = roofing_measurements.measure_token — the tradie capability token,
// the same trust model as /api/roofing/model3d/[token]. It is deliberately NOT
// the customer's public_token: this route spends money (up to 14 image-edit
// calls), so it must never be reachable from the thank-you page. The customer
// read path (/api/q/roof/[token]/showcase) is strictly read-only and signs
// whatever this has already produced.
//
// Idempotent: an existing render is skipped, so re-running after a partial or
// failed run only fills the gaps. Safe to call again after adding a material.
//
// Run it after the 3D model is generated — it needs the two synth studio
// renders that pipeline produces as its source images.
// ════════════════════════════════════════════════════════════════════

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateShowcaseRenders } from '@/lib/roofing/showcase-render'
import { SHOWCASE_MATERIALS } from '@/lib/roofing/showcase'
import type { RoofMaterial } from '@/lib/roofing/types'
import { pipelineLog } from '@/lib/log/pipeline'

// Up to 14 provider calls; each can take several seconds.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** The primary structure's declared material — mirrors roof-after.ts. */
function quotedMaterial(quote: unknown): RoofMaterial | null {
  const structures = (quote as { structures?: unknown } | null)?.structures
  if (!Array.isArray(structures) || structures.length === 0) return null
  const s = structures.find((x) => (x as { role?: string })?.role === 'primary') ?? structures[0]
  const m = (s as { inputs?: { material?: unknown } })?.inputs?.material
  return typeof m === 'string' ? (m as RoofMaterial) : null
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const log = pipelineLog('dispatch')
  const { token } = await ctx.params
  if (!token || token.length < 8) {
    return Response.json({ ok: false, error: 'bad_token' }, { status: 400 })
  }

  const { data: row } = await db()
    .from('roofing_measurements')
    .select('id, address, quote')
    .eq('measure_token', token)
    .maybeSingle()
  if (!row) return Response.json({ ok: false, error: 'not_found' }, { status: 404 })

  const address = (row.address as string | null) ?? null
  if (!address) {
    // The source renders are cached by address; without one there is nothing
    // to read and nowhere to write.
    return Response.json({ ok: false, error: 'no_address' }, { status: 409 })
  }

  // Optional narrowing: {"materials":["colorbond_trimdek"]} warms just those.
  let materials: readonly RoofMaterial[] | undefined
  try {
    const body = (await req.json()) as { materials?: unknown }
    if (Array.isArray(body?.materials)) {
      const picked = body.materials.filter(
        (m): m is RoofMaterial => typeof m === 'string' && (SHOWCASE_MATERIALS as readonly string[]).includes(m),
      )
      if (picked.length) materials = picked
    }
  } catch {
    // No body is fine — warm the full set.
  }

  // Fast-ack, heavy work deferred: this can run for minutes and the tradie's
  // browser must not hold the connection open for it.
  after(async () => {
    try {
      const result = await generateShowcaseRenders({
        address,
        quotedMaterial: quotedMaterial(row.quote),
        materials,
      })
      log.ok('showcase renders warmed', {
        id: row.id,
        generated: result.generated,
        skipped: result.skipped,
        failed: result.failed,
      })
    } catch (e: unknown) {
      log.err(
        'showcase render warm-up threw (customer page falls back to the base renders)',
        e instanceof Error ? e.message : String(e),
        { id: row.id },
      )
    }
  })

  return Response.json({ ok: true, status: 'started' })
}
