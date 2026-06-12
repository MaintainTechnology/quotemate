// ════════════════════════════════════════════════════════════════════
// Solar — Claude vision pre-step for the AI panels concept.
//
// Looks at the PANEL-MARKED aerial (the same frame as the Proposed
// Panel Layout figure, with every panel drawn as an orange rectangle)
// and writes concrete, pixel-grounded editing instructions: which roof
// section the rectangles sit on, how the rows run, how the rectangles
// align to ridges/edges. Those words ride along with the image edit so
// the generator follows the plan it can SEE.
//
// Best-effort: a missing ANTHROPIC_API_KEY, a timeout, or a description
// that fails the count sanity-check all return null — the caller then
// falls back to the deterministic layout-facts text. Never throws.
// House pattern: dynamic import of @ai-sdk/anthropic (lib/sms/intent.ts).
// ════════════════════════════════════════════════════════════════════

export type MarkedPlanImage = { base64: string; mime: string }

const VISION_TIMEOUT_MS = 20_000
const VISION_MODEL = 'claude-sonnet-4-6'

/**
 * Describe the orange panel rectangles in the marked aerial as editing
 * instructions. Returns null when unavailable or implausible — callers
 * fall back to deterministic text. Never throws.
 */
export async function describePanelPlanWithClaude(args: {
  marked: MarkedPlanImage
  expectedCount: number
}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const expected = Math.max(1, Math.round(args.expectedCount))

  try {
    const { anthropic } = await import('@ai-sdk/anthropic')
    const { generateText } = await import('ai')

    const { text } = await generateText({
      model: anthropic(VISION_MODEL),
      abortSignal: AbortSignal.timeout(VISION_TIMEOUT_MS),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'This aerial photo shows a real roof overlaid with orange ' +
                `rectangles. Each rectangle marks the position of ONE solar ` +
                `panel; there are exactly ${expected} rectangles. You are ` +
                'writing instructions for an image-editing AI that will ' +
                'replace each rectangle with a photorealistic panel while ' +
                'reproducing the rest of the photo exactly.\n\n' +
                'Write two labelled sections:\n' +
                'SCENE: one or two sentences anchoring the photo itself — ' +
                'roof colour and shape, and the notable surroundings visible ' +
                'in frame (trees, pool, driveway, sheds, lawn).\n' +
                'PLACEMENT: cluster by cluster. For each group of rectangles ' +
                'give (1) which roof section it sits on (left/right/upper/' +
                'lower part of the frame, which side of the ridge); (2) the ' +
                'arrangement — rows × columns, the direction the rows run, ' +
                'how they align to ridge lines and roof edges; (3) where the ' +
                'cluster sits RELATIVE to the largest cluster (e.g. "near the ' +
                'ridge, upper-right of the main array"); (4) the rectangle ' +
                'size relative to the roof. Be specific about THIS photo. ' +
                `End with: "Total: exactly ${expected} panels." ` +
                'Maximum 160 words. No preamble.',
            },
            {
              type: 'image',
              image: `data:${args.marked.mime};base64,${args.marked.base64}`,
            },
          ],
        },
      ],
    })

    const notes = text?.trim()
    if (!notes || notes.length < 40) return null
    // Sanity: the description must carry the exact expected count —
    // a count drift here would steer the edit wrong.
    if (!notes.includes(String(expected))) return null
    return notes
  } catch (e) {
    console.warn(
      '[solar/panels-after] vision pre-step skipped (non-fatal)',
      e instanceof Error ? e.message : e,
    )
    return null
  }
}
