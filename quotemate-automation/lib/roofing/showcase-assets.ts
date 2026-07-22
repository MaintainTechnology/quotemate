// Signed URLs for the customer-facing 3D showcase.
//
// Split out of the route so the route stays a thin, readable guard and this
// I/O can be swapped or stubbed. Everything here is best-effort: a missing or
// unsignable object yields null, and the section degrades (poster without a
// model, or model without reference images) rather than erroring the page.
//
// Both assets already exist — this module only SIGNS them. It never generates,
// never calls Tripo or an image provider, and never writes. That is what makes
// the customer showcase free to open.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cachePathFor } from './capture-cache'
import { SHOWCASE_MATERIALS } from './showcase'
import { showcaseRenderPath } from './showcase-render'
import type { RoofMaterial } from './types'

const BUCKET = 'roof-models'
/** One hour, matching the tradie route's expiry. Long enough to load a 20 MB
 *  GLB on a phone; short enough that a leaked URL dies quickly. */
const SIGN_TTL_S = 3600

let _client: SupabaseClient | null = null
function db(): SupabaseClient {
  _client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return _client
}

async function sign(path: string): Promise<string | null> {
  try {
    const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_S)
    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    return null
  }
}

export type ShowcaseViews = { front: string | null; back: string | null }

export type ShowcaseAssets = {
  modelUrl: string | null
  /** The two synthesised studio renders Tripo reconstructed from. */
  images: ShowcaseViews
  /** Pre-generated per-material renders, where they exist. A material with no
   *  entry falls back to `images` in the UI — the selector never blanks out. */
  materialImages: Partial<Record<RoofMaterial, ShowcaseViews>>
}

/**
 * Sign the GLB and the two studio renders.
 *
 * The renders are cached per ADDRESS (synth/v4/{address-key}/{view}), not per
 * measurement — see capture-cache.ts — so a property re-measured by another
 * tenant reuses the same pair.
 */
export async function signedShowcaseAssets(input: {
  glbPath: string | null
  address: string | null
}): Promise<ShowcaseAssets> {
  const { address } = input

  // One flat batch — signing is a cheap independent call per object, so the
  // whole matrix goes out at once rather than serially per material.
  const [modelUrl, front, back, ...materialUrls] = await Promise.all([
    input.glbPath ? sign(input.glbPath) : Promise.resolve(null),
    address ? sign(cachePathFor(address, 'front', 'synth')) : Promise.resolve(null),
    address ? sign(cachePathFor(address, 'back', 'synth')) : Promise.resolve(null),
    ...SHOWCASE_MATERIALS.flatMap((m) =>
      (['front', 'back'] as const).map((v) =>
        address ? sign(showcaseRenderPath(address, m, v)) : Promise.resolve(null),
      ),
    ),
  ])

  // Only materials with at least one view are published — an entry of two
  // nulls would make the UI swap to nothing.
  const materialImages: Partial<Record<RoofMaterial, ShowcaseViews>> = {}
  SHOWCASE_MATERIALS.forEach((m, i) => {
    const f = materialUrls[i * 2] ?? null
    const b = materialUrls[i * 2 + 1] ?? null
    if (f || b) materialImages[m] = { front: f, back: b }
  })

  return { modelUrl, images: { front, back }, materialImages }
}
