// ════════════════════════════════════════════════════════════════════
// Roofing — AI "after re-roof" preview PROMPT (pure, no I/O).
//
// Split out from roof-after.ts so it can be unit-tested without pulling in
// the Supabase / Gemini clients that module instantiates at import time.
// ════════════════════════════════════════════════════════════════════

import type { RoofMaterial } from '@/lib/roofing/types'

/** Natural-language material name for the render brief. */
export const MATERIAL_PHRASE: Record<RoofMaterial, string> = {
  colorbond_corrugated: 'brand-new Colorbond Corrugated steel sheeting in a clean charcoal finish',
  colorbond_trimdek: 'brand-new Colorbond Trimdek steel sheeting in a clean charcoal finish',
  colorbond_spandek: 'brand-new Colorbond Spandek steel sheeting in a clean charcoal finish',
  colorbond_kliplok: 'brand-new Colorbond Klip-Lok standing-seam steel sheeting in a clean charcoal finish',
  concrete_tile: 'brand-new concrete roof tiles in a clean uniform finish',
  terracotta_tile: 'brand-new terracotta roof tiles in a clean uniform finish',
  cement_sheet: 'brand-new flat roof sheeting in a clean uniform finish',
  unknown: 'a brand-new, cleanly installed roof',
}

/**
 * PURE — the system+user brief for the "after re-roof" render. Grounded
 * hard on "change ONLY the roof surface" so Gemini doesn't reinvent the
 * building or its surroundings (it's an aerial of a REAL property).
 */
export function buildRoofAfterPrompt(material: RoofMaterial): { system: string; user: string } {
  const phrase = MATERIAL_PHRASE[material] ?? MATERIAL_PHRASE.unknown
  const system =
    'You are an architectural visualiser editing a real top-down satellite ' +
    'aerial photo of a property. You make ONE change only: replace the ' +
    'existing roof surface of the building(s) with a freshly installed new ' +
    'roof. Everything else stays pixel-faithful to the source.'
  const user =
    `Render this exact aerial with the roof of the building(s) replaced by ${phrase}. ` +
    'STRICT RULES: keep the exact same building footprint, shape, roof lines, ' +
    'ridges, valleys and number of structures; keep the ground, driveway, ' +
    'trees, pool, fences, vehicles, neighbouring buildings and the camera ' +
    'angle / zoom completely unchanged. Do NOT add or remove buildings, do ' +
    'NOT rotate or re-frame, do NOT add text, labels, watermarks or people. ' +
    'Photorealistic, consistent lighting and shadows with the original aerial. ' +
    'The result must read as the SAME property photographed after a re-roof.'
  return { system, user }
}
