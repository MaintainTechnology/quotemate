// ════════════════════════════════════════════════════════════════════
// Painting — AI "after repaint" preview (mirrors lib/roofing/roof-after.ts).
//
// Takes the SAME Google Street View photo we show on the /p results page
// as the SOURCE image and asks the image-EDIT provider (Hugging Face
// FLUX.1-Kontext by default — see ig-engine/providers/edit-select.ts) to
// repaint the exterior — building, framing and surroundings unchanged. The
// result is cached on painting_measurements.preview_image_path (intake-photos
// bucket, migration 169) and served via the token-gated
// /api/painting/q/[token]/after-image proxy.
//
// CAS-claims preview_status so two concurrent page loads don't both call
// the provider. Best-effort: never throws; records 'failed' on error and the
// proxy falls back to the plain Street View photo.
//
// Deps are injectable (client / fetchSource / render) so the flow is
// unit-testable without Supabase or a live provider — house DI pattern
// (lib/painting/release.ts).
// ════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NO_EDIT_PROVIDER, resolveEditImageProvider } from '@/lib/ig-engine/providers/edit-select'
import { buildRepaintPrompt } from './repaint-prompt'
import {
  buildStreetViewMetadataUrl,
  buildStreetViewUrl,
  parseStreetViewMetadata,
} from './streetview'
import type { PaintScope } from './types'

const BUCKET = 'intake-photos'

// Lazy so importing this module (e.g. under vitest) never requires env.
let defaultClient: SupabaseClient | null = null
function serviceClient(): SupabaseClient {
  defaultClient ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return defaultClient
}

type ImageBytes = { base64: string; mime: string }

type SourceRow = {
  address: string | null
  postcode: string | null
  state: string | null
}

export type PaintAfterDeps = {
  client?: SupabaseClient
  /** Fetch the Street View "before" photo for the row. */
  fetchSource?: (row: SourceRow) => Promise<ImageBytes>
  /** Image-to-image render (defaults to the selected provider — HF first). */
  render?: (req: {
    system: string
    user: string
    sourceImage: ImageBytes
    aspectRatio: '4:3'
  }) => Promise<ImageBytes>
  /** Chosen repaint colour (customer/tradie picker). Blank/absent ⇒ the
   *  prompt's default "fresh, clean modern off-white". */
  colour?: string | null
}

export type PaintAfterResult =
  | { ok: true; path: string }
  | { ok: false; status: 'busy' | 'failed' | 'skipped'; error?: string }

/** Compose the geocodable location string for a saved row. */
export function composePaintLocation(row: SourceRow): string {
  const locality = [row.postcode, row.state].filter(Boolean).join(' ')
  return [row.address, locality, 'Australia'].filter(Boolean).join(', ')
}

/** Default source fetch: metadata pre-check (free), then the photo. */
async function fetchStreetViewSource(row: SourceRow): Promise<ImageBytes> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!
  const location = composePaintLocation(row)
  const metaRes = await fetch(buildStreetViewMetadataUrl({ location }, { apiKey }))
  const meta = parseStreetViewMetadata(await metaRes.json().catch(() => null))
  if (!meta.ok) throw new Error(`no_streetview:${meta.status}`)
  const imgRes = await fetch(buildStreetViewUrl({ location }, { apiKey }))
  if (!imgRes.ok) throw new Error(`streetview fetch ${imgRes.status}`)
  const mime = imgRes.headers.get('content-type') ?? 'image/jpeg'
  const bytes = Buffer.from(await imgRes.arrayBuffer())
  return { base64: bytes.toString('base64'), mime }
}

/**
 * Generate (or no-op) the AI "after repaint" preview for one saved
 * painting measurement, keyed by its customer public_token.
 */
export async function generatePaintAfterImage(
  token: string,
  deps?: PaintAfterDeps,
): Promise<PaintAfterResult> {
  // Gemini is the primary image-edit provider; Hugging Face (FLUX.1-Kontext)
  // then Replicate are the fallbacks. Force one with PAINTING_IMAGE_PROVIDER.
  const provider = deps?.render ? null : resolveEditImageProvider(process.env.PAINTING_IMAGE_PROVIDER)
  if (!deps?.render && !provider) {
    return { ok: false, status: 'skipped', error: NO_EDIT_PROVIDER }
  }
  if (!deps?.fetchSource && !process.env.GOOGLE_MAPS_API_KEY) {
    return { ok: false, status: 'skipped', error: 'GOOGLE_MAPS_API_KEY missing' }
  }
  const supabase = deps?.client ?? serviceClient()
  const fetchSource = deps?.fetchSource ?? fetchStreetViewSource
  const render = deps?.render ?? ((req) => provider!.renderImage(req))

  const { data: row } = await supabase
    .from('painting_measurements')
    .select('id, address, postcode, state, scopes, preview_status, preview_image_path')
    .eq('public_token', token)
    .maybeSingle()
  if (!row) return { ok: false, status: 'skipped', error: 'not_found' }
  if (row.preview_status === 'ready' && row.preview_image_path) {
    return { ok: true, path: row.preview_image_path as string }
  }
  // The repaint prompt recolours the EXTERIOR (repaint-prompt.ts). Product
  // decision 2026-07-11: interior-only jobs get the preview too — it is a
  // colour VISUALISATION of the property, not a claim about quoted scope.
  const scopes = (Array.isArray(row.scopes) ? row.scopes : []) as PaintScope[]

  // CAS claim — only proceed if nobody else is mid-generation.
  const { data: claimed } = await supabase
    .from('painting_measurements')
    .update({ preview_status: 'generating' })
    .eq('public_token', token)
    .or('preview_status.is.null,preview_status.eq.idle,preview_status.eq.failed')
    .select('id')
    .maybeSingle()
  if (!claimed) return { ok: false, status: 'busy' }

  try {
    const source = await fetchSource({
      address: (row.address as string | null) ?? null,
      postcode: (row.postcode as string | null) ?? null,
      state: (row.state as string | null) ?? null,
    })
    const prompt = buildRepaintPrompt({ colour: deps?.colour ?? '', scopes })
    const out = await render({
      system: prompt.system,
      user: prompt.user,
      sourceImage: source,
      aspectRatio: '4:3',
    })

    const ext = out.mime === 'image/jpeg' ? 'jpg' : 'png'
    const path = `painting/${row.id}/after-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, Buffer.from(out.base64, 'base64'), { contentType: out.mime, upsert: false })
    if (upErr) throw new Error(`storage upload: ${upErr.message}`)

    await supabase
      .from('painting_measurements')
      .update({ preview_image_path: path, preview_status: 'ready' })
      .eq('public_token', token)
    return { ok: true, path }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('[painting/after] generation failed', { token, error })
    await supabase
      .from('painting_measurements')
      .update({ preview_status: 'failed' })
      .eq('public_token', token)
    return { ok: false, status: 'failed', error }
  }
}
