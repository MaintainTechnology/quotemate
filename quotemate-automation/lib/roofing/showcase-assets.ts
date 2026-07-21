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

export type ShowcaseAssets = {
  modelUrl: string | null
  /** The two synthesised studio renders Tripo reconstructed from. */
  images: { front: string | null; back: string | null }
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
  const [modelUrl, front, back] = await Promise.all([
    input.glbPath ? sign(input.glbPath) : Promise.resolve(null),
    input.address ? sign(cachePathFor(input.address, 'front', 'synth')) : Promise.resolve(null),
    input.address ? sign(cachePathFor(input.address, 'back', 'synth')) : Promise.resolve(null),
  ])
  return { modelUrl, images: { front, back } }
}
