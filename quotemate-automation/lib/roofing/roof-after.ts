// ════════════════════════════════════════════════════════════════════
// Roofing — AI "after re-roof" preview.
//
// Takes the SAME Google Maps satellite aerial we show on the quote page
// as the SOURCE image and asks the image-EDIT provider (Hugging Face
// FLUX.1-Kontext by default — see providers/edit-select.ts) to render the
// roof as a brand-new roof in the customer's chosen material — footprint,
// layout and surroundings unchanged. The result is cached on
// roofing_measurements.preview_image_path (intake-photos bucket) and
// served via the token-gated /api/roofing/q/[token]/after-image proxy.
//
// The prompt builder is PURE + unit-tested. generateRoofAfterImage does
// the I/O (fetch satellite → render → storage) and is best-effort: any
// failure is recorded as preview_status='failed' and the proxy falls back
// to the plain satellite, so the page always shows SOMETHING.
// ════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js'
import { buildStaticMapUrl } from '@/lib/roofing/google-maps'
import { NO_EDIT_PROVIDER, resolveEditImageProvider } from '@/lib/ig-engine/providers/edit-select'
import { buildRoofAfterPrompt } from '@/lib/roofing/roof-after-prompt'
import type { MultiRoofQuote, RoofMaterial } from '@/lib/roofing/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const BUCKET = 'intake-photos'

export type RoofAfterStatus = 'idle' | 'generating' | 'ready' | 'failed'

export { buildRoofAfterPrompt }

type Center = { lat: number; lng: number }

/** Primary structure's material, for the render phrase. */
function primaryMaterial(quote: MultiRoofQuote | null): RoofMaterial {
  const structs = Array.isArray(quote?.structures) ? quote!.structures : []
  const primary = structs.find((s) => s.role === 'primary') ?? structs[0]
  return primary?.inputs?.material ?? 'unknown'
}

/** Centre coordinate from the first polygon vertex (lng,lat → {lat,lng}). */
function centerFromQuote(quote: MultiRoofQuote | null): Center | null {
  const structs = Array.isArray(quote?.structures) ? quote!.structures : []
  for (const s of structs) {
    const v = s.metrics?.polygon_geojson?.coordinates?.[0]?.[0]
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
      return { lat: v[1], lng: v[0] }
    }
  }
  return null
}

export type RoofAfterResult =
  | { ok: true; path: string }
  | { ok: false; status: 'busy' | 'failed' | 'skipped'; error?: string }

/**
 * Generate (or no-op) the AI "after" preview for one saved measurement.
 * CAS-claims preview_status so two concurrent page loads don't both call
 * the provider. Best-effort: never throws; records 'failed' on error.
 */
export async function generateRoofAfterImage(token: string): Promise<RoofAfterResult> {
  // Gemini is the primary image-edit provider; Hugging Face (FLUX.1-Kontext)
  // then Replicate are the fallbacks. Force one with ROOFING_IMAGE_PROVIDER.
  const provider = resolveEditImageProvider(process.env.ROOFING_IMAGE_PROVIDER)
  if (!provider) return { ok: false, status: 'skipped', error: NO_EDIT_PROVIDER }
  if (!process.env.GOOGLE_MAPS_API_KEY) return { ok: false, status: 'skipped', error: 'GOOGLE_MAPS_API_KEY missing' }

  const { data: row } = await supabase
    .from('roofing_measurements')
    .select('id, address, quote, preview_status, preview_image_path')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return { ok: false, status: 'skipped', error: 'not_found' }
  if (row.preview_status === 'ready' && row.preview_image_path) {
    return { ok: true, path: row.preview_image_path as string }
  }

  // CAS claim — only proceed if nobody else is mid-generation.
  const { data: claimed } = await supabase
    .from('roofing_measurements')
    .update({ preview_status: 'generating' })
    .eq('public_token', token)
    .or('preview_status.is.null,preview_status.eq.idle,preview_status.eq.failed')
    .select('id')
    .maybeSingle()
  if (!claimed) return { ok: false, status: 'busy' }

  try {
    const quote = (row.quote ?? null) as MultiRoofQuote | null
    const center = centerFromQuote(quote)
    const address = (row.address as string | null) ?? undefined
    if (!center && !address) throw new Error('no_location')

    const target = buildStaticMapUrl(
      {
        address: center ? undefined : address,
        center: center ?? undefined,
        zoom: 20,
        size: { width: 640, height: 480 },
      },
      { apiKey: process.env.GOOGLE_MAPS_API_KEY! },
    )
    const satRes = await fetch(target)
    if (!satRes.ok) throw new Error(`satellite fetch ${satRes.status}`)
    const satMime = satRes.headers.get('content-type') ?? 'image/png'
    const satBytes = Buffer.from(await satRes.arrayBuffer())

    const prompt = buildRoofAfterPrompt(primaryMaterial(quote))
    const out = await provider.renderImage({
      system: prompt.system,
      user: prompt.user,
      sourceImage: { base64: satBytes.toString('base64'), mime: satMime },
      aspectRatio: '4:3',
    })

    const ext = out.mime === 'image/jpeg' ? 'jpg' : 'png'
    const path = `roofing/${row.id}/after-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(out.base64, 'base64'), { contentType: out.mime, upsert: false })
    if (upErr) throw new Error(`storage upload: ${upErr.message}`)

    await supabase
      .from('roofing_measurements')
      .update({ preview_image_path: path, preview_status: 'ready' })
      .eq('public_token', token)
    return { ok: true, path }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[roofing/after] generation failed', { token, error })
    await supabase
      .from('roofing_measurements')
      .update({ preview_status: 'failed' })
      .eq('public_token', token)
    return { ok: false, status: 'failed', error }
  }
}
