// ════════════════════════════════════════════════════════════════════
// Painting — AI "after repaint" preview PROMPT (pure, no I/O).
//
// Mirrors lib/roofing/roof-after-prompt.ts. Takes a real Street View
// photo of the front of a house as the SOURCE image and asks Gemini
// (image-to-image) to repaint ONLY the exterior surfaces in the chosen
// colour — structure, framing and surroundings pixel-faithful.
//
// Split out so it can be unit-tested without the Supabase / Gemini
// clients. PURE.
// ════════════════════════════════════════════════════════════════════

import type { PaintScope } from './types'

/** Sanitise a free-text colour so it reads cleanly in the brief. */
export function normaliseColour(colour: string | null | undefined): string {
  const c = (colour ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
  return c || 'a fresh, clean modern off-white'
}

/** Which exterior surfaces the repaint should touch, in words. */
function surfacePhrase(scopes: PaintScope[]): string {
  const wantsTrim = scopes.includes('trim')
  return wantsTrim
    ? 'the exterior walls/cladding and the trim (fascia, window frames, door)'
    : 'the exterior walls/cladding'
}

/**
 * PURE — the system+user brief for the "after repaint" render. Grounded
 * hard on "repaint ONLY the exterior surfaces" so Gemini doesn't reinvent
 * the building or its surroundings (it's a real photo of a real house).
 */
export function buildRepaintPrompt(args: {
  colour: string
  scopes: PaintScope[]
}): { system: string; user: string } {
  const colour = normaliseColour(args.colour)
  const surfaces = surfacePhrase(args.scopes)
  const system =
    'You are an architectural visualiser editing a real street-level photo ' +
    'of a house. You make ONE kind of change only: repaint the exterior ' +
    'surfaces of the building in a new colour. Everything else stays ' +
    'pixel-faithful to the source photo.'
  const user =
    `Repaint ${surfaces} of this house in ${colour}, as a crisp, freshly ` +
    'applied two-coat finish. ' +
    'STRICT RULES: keep the exact same building shape, rooflines, windows, ' +
    'doors, garden, driveway, fences, trees, vehicles, sky, neighbouring ' +
    'houses and the camera angle / zoom / framing completely unchanged. Do ' +
    'NOT change the roof, do NOT add or remove anything, do NOT re-frame or ' +
    'rotate, do NOT add text, labels, watermarks or people. Photorealistic, ' +
    'with lighting and shadows consistent with the original photo. The result ' +
    'must read as the SAME house photographed after an exterior repaint.'
  return { system, user }
}
