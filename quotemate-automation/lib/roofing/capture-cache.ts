// ════════════════════════════════════════════════════════════════════
// Roofing 3D model — address-keyed cache of Gemini-enhanced captures.
//
// The same property produces the same orbit views, so the polished
// (nano-banana-enhanced) screenshots are stored once per address and view
// and reused on any later generation — by any tenant. That reuse is the
// point: enhancement is the Gemini-token-expensive step, and a repeat
// generation for an address that has already been polished costs zero
// Gemini calls.
//
// Storage: roof-models bucket, `{kind}/v2/{addressKey}/{view}` (no
// extension — the object's content-type carries the mime). The version
// segment invalidates the whole cache when the enhancement contract
// changes (v2 = neighbour-removal prompts); old objects are orphaned,
// never deleted. Everything here is BEST-EFFORT: a cache miss, read
// error, or write error must never fail the generation; callers fall
// back to enhancing fresh.
// ════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ImageBytes } from '@/lib/ig-engine/providers/base'

const BUCKET = 'roof-models'

/** Capture order shown to the tradie. Tripo consumes only the first four —
 *  'top' is enhanced + cached for completeness but has no Tripo view slot. */
export const CAPTURE_VIEWS = ['front', 'left', 'right', 'back', 'top'] as const
export type CaptureView = (typeof CAPTURE_VIEWS)[number]

// Lazy so the pure helpers stay importable in vitest without Supabase env.
let _supabase: SupabaseClient | null = null
function supabaseClient() {
  _supabase ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return _supabase
}

// ── pure helpers (unit-tested) ──────────────────────────────────────

/**
 * PURE — collapse an address to a stable storage key: lowercase, strip
 * punctuation/diacritics, whitespace → single hyphens. "670 LONDON RD,
 * CHANDLER QLD 4155" and "670 london rd chandler qld 4155" share a key.
 */
export function normalizeAddressKey(address: string): string {
  return address
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 120)
}

/** What's cached per address+view: the polished capture, the Gemini
 *  roof-anatomy annotation drawn over it (display-only, never fed to Tripo),
 *  or the synthesised studio render of the whole house ('front'/'back' only,
 *  the two images Tripo actually reconstructs from). */
export type CacheKind = 'enhanced' | 'anatomy' | 'synth'

// Cache schema version — bump when the enhancement contract changes so stale
// images are never reused (v2: neighbour-removal / subject-property isolation;
// v3: Nano Banana Pro polish + gutter lines in the anatomy overlay; v4: the
// synthesis pass — the polished captures are now also synthesis input).
const CACHE_VERSION = 'v4'

/** PURE — storage object path for one view's cached image. */
export function cachePathFor(address: string, view: CaptureView, kind: CacheKind = 'enhanced'): string {
  return `${kind}/${CACHE_VERSION}/${normalizeAddressKey(address)}/${view}`
}

// ── storage I/O (best-effort) ───────────────────────────────────────

/** The cached image for this address+view+kind, or null on any miss/error. */
export async function getCachedEnhanced(
  address: string,
  view: CaptureView,
  kind: CacheKind = 'enhanced',
): Promise<ImageBytes | null> {
  try {
    const { data, error } = await supabaseClient()
      .storage.from(BUCKET)
      .download(cachePathFor(address, view, kind))
    if (error || !data) return null
    const base64 = Buffer.from(await data.arrayBuffer()).toString('base64')
    return { base64, mime: data.type || 'image/jpeg' }
  } catch {
    return null
  }
}

/** Store an image for reuse. Never throws. */
export async function putCachedEnhanced(
  address: string,
  view: CaptureView,
  image: ImageBytes,
  kind: CacheKind = 'enhanced',
): Promise<void> {
  try {
    await supabaseClient()
      .storage.from(BUCKET)
      .upload(cachePathFor(address, view, kind), Buffer.from(image.base64, 'base64'), {
        contentType: image.mime,
        upsert: true,
      })
  } catch {
    /* best-effort — a failed cache write just means a re-render next time */
  }
}
