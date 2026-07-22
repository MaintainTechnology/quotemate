// ════════════════════════════════════════════════════════════════════
// Per-material studio renders for the customer 3D showcase.
//
// The thank-you page lets a customer flip the roof material on the two studio
// renders. That cannot be a live AI call: it would cost money on every tap and
// make the customer wait seconds for each one. So each material's pair is
// rendered ONCE, tradie-side, cached by address, and swapped instantly.
//
// Source image is the SYNTH studio render (synth/v4/{address}/{view}) — the
// same pair Tripo reconstructed the model from — not the Google satellite
// aerial roof-after.ts uses. That matters for the prompt: this is a
// ground-level three-quarter view of a whole house, so the brief has to
// protect walls, windows and landscaping, which an aerial brief never mentions.
//
// Cached per ADDRESS, matching capture-cache's convention, so a property
// re-measured by another tenant reuses the renders rather than paying again.
//
// Pure helpers here; the I/O lives in generateShowcaseRenders below.
// ════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { RoofMaterial } from './types'
import { normalizeAddressKey, cachePathFor } from './capture-cache'
import { resolveEditImageProvider } from '@/lib/ig-engine/providers/edit-select'
import { SHOWCASE_MATERIALS } from './showcase'

/** Bump when the prompt or source contract changes, so a stale render can
 *  never be served against a new brief. */
export const SHOWCASE_RENDER_VERSION = 'v1'

export type ShowcaseView = 'front' | 'back'

/** Storage path for one material+view render, in the roof-models bucket. */
export function showcaseRenderPath(
  address: string,
  material: RoofMaterial,
  view: ShowcaseView,
): string {
  return `showcase/${SHOWCASE_RENDER_VERSION}/${normalizeAddressKey(address)}/${material}-${view}`
}

/** Material wording for the brief. Profile is described physically, because
 *  the model knows "standing seam" better than it knows "Klip-Lok". Colour is
 *  deliberately NOT fixed here — colour lives on the 3D model, where it is
 *  free and instant; baking it in would multiply the render matrix. */
const MATERIAL_BRIEF: Record<RoofMaterial, string> = {
  colorbond_corrugated:
    'brand-new COLORBOND corrugated steel roof sheeting, with its characteristic fine wavy corrugations running down the slope',
  colorbond_trimdek:
    'brand-new COLORBOND Trimdek steel roof sheeting, with its characteristic square-fluted trapezoidal ribs running down the slope',
  colorbond_spandek:
    'brand-new COLORBOND Spandek steel roof sheeting, with its characteristic narrow rounded ribs running down the slope',
  colorbond_kliplok:
    'brand-new COLORBOND Klip-Lok concealed-fix steel roof sheeting, with its characteristic wide flat pans and tall standing seams running down the slope',
  concrete_tile:
    'brand-new concrete roof tiles, laid in neat overlapping courses with a subtle repeating profile',
  terracotta_tile:
    'brand-new terracotta roof tiles, laid in neat overlapping courses with the warm fired-clay tone of real terracotta',
  cement_sheet:
    'brand-new flat fibre-cement roof sheeting, laid clean and uniform',
  unknown: 'a brand-new, cleanly installed roof',
}

/**
 * PURE — the brief for re-roofing one studio render.
 *
 * Grounded hard on "change ONLY the roof". The source is a render of a REAL
 * person's house that they are about to see on their own confirmation page;
 * a model that redesigns the windows or moves the garage has produced a
 * picture of somebody else's home.
 */
export function buildShowcaseRenderPrompt(material: RoofMaterial): {
  system: string
  user: string
} {
  const brief = MATERIAL_BRIEF[material] ?? MATERIAL_BRIEF.unknown
  const system =
    'You are an architectural visualiser editing a photorealistic exterior ' +
    'render of a real house. You make ONE change only: replace the roof ' +
    'covering. Every other pixel stays faithful to the source image.'
  const user =
    `Re-render this exact house with its roof replaced by ${brief}. ` +
    'STRICT RULES: keep the identical building shape, roof pitch, ridge and ' +
    'gutter lines, wall cladding, wall colour, windows, doors, garage, ' +
    'verandah and landscaping. Keep the camera angle, framing, zoom and crop ' +
    'exactly as they are, and keep the plain studio backdrop. Do NOT redesign ' +
    'the house, do NOT move or resize anything, do NOT add or remove ' +
    'structures, and do NOT add text, labels, watermarks, logos or people. ' +
    'Photorealistic, with lighting and shadows consistent with the source. ' +
    'It must read as the SAME house photographed after a re-roof.'
  return { system, user }
}

// ── generation (tradie-side, cached) ────────────────────────────────

const BUCKET = 'roof-models'

let _client: SupabaseClient | null = null
function db(): SupabaseClient {
  _client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  return _client
}

async function exists(path: string): Promise<boolean> {
  const { data } = await db().storage.from(BUCKET).createSignedUrl(path, 60)
  return !!data?.signedUrl
}

async function downloadSynth(address: string, view: ShowcaseView) {
  const { data, error } = await db().storage.from(BUCKET).download(cachePathFor(address, view, 'synth'))
  if (error || !data) return null
  return {
    base64: Buffer.from(await data.arrayBuffer()).toString('base64'),
    mime: data.type || 'image/jpeg',
  }
}

export type ShowcaseRenderResult = {
  /** material -> view -> true when a render exists after this run. */
  generated: number
  skipped: number
  failed: number
}

/**
 * Ensure a studio render exists for every selectable material, both views.
 *
 * TRADIE-SIDE ONLY. Never call this from a customer route: it makes up to
 * 14 paid image-edit calls. It is idempotent — an existing render is skipped,
 * so re-running after a partial failure only fills the gaps.
 *
 * Best-effort throughout: one material failing must not abandon the rest, and
 * the customer page degrades to the original synth pair for anything missing.
 * The quoted material is done FIRST so the most likely selection is ready
 * even if the run is cut short.
 */
export async function generateShowcaseRenders(opts: {
  address: string
  /** Render this one first — it is the material the customer was quoted. */
  quotedMaterial?: RoofMaterial | null
  /** Cap the run; the caller may want only the quoted material warmed. */
  materials?: readonly RoofMaterial[]
}): Promise<ShowcaseRenderResult> {
  const out: ShowcaseRenderResult = { generated: 0, skipped: 0, failed: 0 }

  const provider = resolveEditImageProvider(process.env.ROOFING_IMAGE_PROVIDER)
  if (!provider) return out

  const wanted = opts.materials ?? SHOWCASE_MATERIALS
  const ordered =
    opts.quotedMaterial && wanted.includes(opts.quotedMaterial)
      ? [opts.quotedMaterial, ...wanted.filter((m) => m !== opts.quotedMaterial)]
      : [...wanted]

  // Source images are fetched once and reused across all materials — they are
  // the same two pictures every time.
  const sources: Partial<Record<ShowcaseView, { base64: string; mime: string }>> = {}
  for (const view of ['front', 'back'] as const) {
    const s = await downloadSynth(opts.address, view)
    if (s) sources[view] = s
  }
  if (!sources.front && !sources.back) return out

  for (const material of ordered) {
    for (const view of ['front', 'back'] as const) {
      const source = sources[view]
      if (!source) continue
      const path = showcaseRenderPath(opts.address, material, view)
      if (await exists(path)) {
        out.skipped++
        continue
      }
      try {
        const prompt = buildShowcaseRenderPrompt(material)
        const img = await provider.renderImage({
          system: prompt.system,
          user: prompt.user,
          sourceImage: source,
          aspectRatio: '4:3',
        })
        const { error } = await db()
          .storage.from(BUCKET)
          .upload(path, Buffer.from(img.base64, 'base64'), {
            contentType: img.mime,
            upsert: true,
          })
        if (error) throw new Error(error.message)
        out.generated++
      } catch {
        // Swallowed on purpose: the remaining materials still get their turn,
        // and a missing render simply falls back to the original synth pair.
        out.failed++
      }
    }
  }

  return out
}
