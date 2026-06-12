// ════════════════════════════════════════════════════════════════════
// Commercial painting — Gemini repaint-preview PROMPT (pure, no I/O).
//
// Adapts the residential repaint pattern (lib/painting/repaint-prompt)
// for commercial buildings: the source is a real site photo; the render
// repaints ONLY the painted surfaces and keeps structure, signage,
// glazing and fixtures pixel-faithful. Refinement is conversational —
// one instruction per pass, same discipline as residential.
// ════════════════════════════════════════════════════════════════════

const MAX_COLOUR_CHARS = 60
const MAX_INSTRUCTION_CHARS = 300

export function normaliseColour(colour: string | null | undefined): string {
  const c = (colour ?? '').trim().slice(0, MAX_COLOUR_CHARS)
  return c || 'a fresh, clean modern off-white scheme'
}

export function normaliseInstruction(instruction: string | null | undefined): string {
  const i = (instruction ?? '').trim().slice(0, MAX_INSTRUCTION_CHARS)
  return i || 'no change'
}

/** PURE — initial repaint render brief. */
export function buildCommercialRepaintPrompt(args: {
  colour?: string | null
}): { system: string; user: string } {
  const scheme = normaliseColour(args.colour)
  const system =
    'You are an architectural visualiser editing a real photograph of a ' +
    'commercial building. You make ONE change only: repaint the painted ' +
    'surfaces. Everything else stays pixel-faithful to the source photo.'
  const user =
    `Render this exact photo with the painted surfaces refreshed in ${scheme}. ` +
    'STRICT RULES: repaint ONLY surfaces that are clearly painted today ' +
    '(rendered walls, painted cladding, fascias, painted columns, doors and ' +
    'frames). Keep the building structure, rooflines, signage, glazing, ' +
    'shopfronts, paving, vehicles, people, sky and the camera angle ' +
    'completely unchanged. Do NOT add or remove elements, do NOT repaint ' +
    'brick-face, stone, glass or metal trims that are unpainted, do NOT add ' +
    'text, labels or watermarks. Photorealistic, with lighting and shadows ' +
    'consistent with the original. The result must read as the SAME ' +
    'building photographed after a professional repaint.'
  return { system, user }
}

/** PURE — conversational refinement of a previously generated preview. */
export function buildCommercialRefinePrompt(instruction: string | null | undefined): {
  system: string
  user: string
} {
  const change = normaliseInstruction(instruction)
  const system =
    'You are an architectural visualiser making a precise EDIT to a ' +
    'previously generated repaint preview of a commercial building. Apply ' +
    'ONLY the single change asked; everything else stays pixel-faithful.'
  const user =
    `Apply exactly this change: ${change}. ` +
    'STRICT RULES: keep the building structure, signage, glazing, paving ' +
    'and camera angle unchanged; do not introduce new elements; no text, ' +
    'labels or watermarks. Photorealistic and consistent with the source.'
  return { system, user }
}
