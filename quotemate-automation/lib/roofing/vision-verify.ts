// ════════════════════════════════════════════════════════════════════
// Roofing — Claude vision verification + material classification.
//
// Two jobs in one model call:
//   1. VERIFY    — does the customer's uploaded photo show the SAME
//                  building that Geoscape's address resolution returned?
//                  (We pass the photo + a Google Maps satellite snapshot
//                  of the resolved address. Claude judges if they match.)
//   2. CLASSIFY  — what's the roof MATERIAL in the photo?
//                  (Colorbond / tile / cement_sheet / unknown — the
//                  material flows straight into the pricing engine.)
//
// PURE-ish: the prompt builder + response parser are pure and unit-
// tested. The Claude call is thin I/O.
// ════════════════════════════════════════════════════════════════════

import type { RoofMaterial } from './types'

const DEFAULT_MODEL = process.env.ROOFING_VISION_MODEL ?? 'claude-sonnet-4-6'

export type VisionVerdict = {
  /** true = same building, false = clear mismatch, null = inconclusive */
  match: boolean | null
  /** Short human-readable reason for the verdict. */
  reason: string
  /** Roof material classified from the customer photo. */
  material: RoofMaterial
  /** How confident Claude is in the material call. */
  materialConfidence: 'high' | 'medium' | 'low'
  /** Any quick red flags Claude noticed (asbestos suspicion, moss, etc.). */
  redFlags: string[]
}

/**
 * PURE — build the QA prompt sent to Claude. Asks for STRICT JSON only,
 * with exactly the four fields the parser expects.
 */
export function buildVisionPrompt(args: {
  address: string
  hasReferenceImage: boolean
}): string {
  const lines: string[] = []
  lines.push(
    `You are a strict QA assistant for an Australian roofing-quote tool.`,
  )
  if (args.hasReferenceImage) {
    lines.push(
      `The FIRST image is the customer's own photo of their property.`,
      `The SECOND image is a Google Maps satellite view of the address they entered: "${args.address}".`,
    )
  } else {
    lines.push(
      `Single image attached: the customer's own photo of their property at "${args.address}".`,
    )
  }
  lines.push(``)
  lines.push(`Answer two questions about the FIRST image:`)
  if (args.hasReferenceImage) {
    lines.push(
      `  1. Does the first image show the SAME building as the satellite view in the second image?`,
      `     Consider rough shape, scale, surroundings, roof colour, number of storeys. Be strict — if you can't tell, answer null.`,
    )
  } else {
    lines.push(
      `  1. Skip the match question (only one image provided) — set match=null.`,
    )
  }
  lines.push(
    `  2. What is the roof MATERIAL in the customer photo?`,
    `     Choose ONE of: "colorbond_trimdek" (corrugated/Trimdek profile metal),`,
    `     "colorbond_kliplok" (Klip-Lok/concealed-fix metal), "concrete_tile" (concrete tile),`,
    `     "terracotta_tile" (terracotta tile), "cement_sheet" (asbestos-suspect`,
    `     fibro / cement sheet), or "unknown" (can't tell from this photo).`,
    `     If it's clearly an older cement-sheet roof or you suspect asbestos, classify it`,
    `     as cement_sheet and add an asbestos red flag.`,
  )
  lines.push(``)
  lines.push(`Respond with STRICT JSON only, no prose, exactly this shape:`)
  lines.push(`{`)
  lines.push(`  "match": <true|false|null>,`)
  lines.push(`  "reason": "<one short sentence>",`)
  lines.push(`  "material": "<colorbond_trimdek|colorbond_kliplok|concrete_tile|terracotta_tile|cement_sheet|unknown>",`)
  lines.push(`  "material_confidence": "<high|medium|low>",`)
  lines.push(`  "red_flags": ["<short tag>", ...]   // empty array if none`)
  lines.push(`}`)
  return lines.join('\n')
}

/** PURE — parse Claude's response into a VisionVerdict. Tolerant of
 *  markdown fences + surrounding prose. Any unreadable answer collapses
 *  to an inconclusive verdict so the upstream flow never blocks on a
 *  parsing quirk. */
export function parseVisionResponse(text: string | null | undefined): VisionVerdict {
  const inconclusive: VisionVerdict = {
    match: null,
    reason: '(no readable verdict)',
    material: 'unknown',
    materialConfidence: 'low',
    redFlags: [],
  }
  const t = (text ?? '').trim()
  if (!t) return inconclusive

  const m = t.match(/\{[\s\S]*\}/)
  if (!m) return inconclusive

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(m[0]) as Record<string, unknown>
  } catch {
    return inconclusive
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return inconclusive

  return {
    match: coerceBoolOrNull(obj.match),
    reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 240) : '(no reason given)',
    material: coerceMaterial(obj.material),
    materialConfidence: coerceConfidence(obj.material_confidence),
    redFlags: coerceStringArray(obj.red_flags),
  }
}

// ── Pure helpers ────────────────────────────────────────────────────

function coerceBoolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v
  if (v === null) return null
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === 'yes' || s === 'match') return true
    if (s === 'false' || s === 'no' || s === 'mismatch') return false
  }
  return null
}

const VALID_MATERIALS: ReadonlySet<RoofMaterial> = new Set([
  'colorbond_trimdek',
  'colorbond_kliplok',
  'concrete_tile',
  'terracotta_tile',
  'cement_sheet',
  'unknown',
])

function coerceMaterial(v: unknown): RoofMaterial {
  if (typeof v !== 'string') return 'unknown'
  const s = v.trim().toLowerCase() as RoofMaterial
  return VALID_MATERIALS.has(s) ? s : 'unknown'
}

function coerceConfidence(v: unknown): 'high' | 'medium' | 'low' {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'low'
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((s) => s.trim().slice(0, 80))
    .slice(0, 6) // cap to keep the UI tidy
}

// ── The actual Claude call ──────────────────────────────────────────

export type VerifyArgs = {
  customerPhoto: { base64: string; mime: string }
  /** Optional Google Maps Static image of the resolved address. When
   *  omitted the match question is skipped (Claude only classifies). */
  referenceImage?: { base64: string; mime: string }
  address: string
  /** Override the Claude model. Defaults to claude-sonnet-4-6. */
  model?: string
}

/**
 * Best-effort Claude vision verification. Returns a VisionVerdict.
 * NEVER throws on operational failure — falls back to the inconclusive
 * verdict so the upstream flow stays robust.
 */
export async function verifyAndClassify(args: VerifyArgs): Promise<VisionVerdict> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      match: null,
      reason: 'ANTHROPIC_API_KEY not set — skipping vision check.',
      material: 'unknown',
      materialConfidence: 'low',
      redFlags: [],
    }
  }
  try {
    // Dynamic import — keeps the test imports light (matches the
    // pattern used in lib/ig-engine/judge.ts).
    const { anthropic } = await import('@ai-sdk/anthropic')
    const { generateText } = await import('ai')

    const prompt = buildVisionPrompt({
      address: args.address,
      hasReferenceImage: !!args.referenceImage,
    })

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; image: string; mediaType: string }
    > = [{ type: 'text', text: prompt }]
    content.push({
      type: 'image',
      image: args.customerPhoto.base64,
      mediaType: args.customerPhoto.mime,
    })
    if (args.referenceImage) {
      content.push({
        type: 'image',
        image: args.referenceImage.base64,
        mediaType: args.referenceImage.mime,
      })
    }

    const { text } = await generateText({
      model: anthropic(args.model ?? DEFAULT_MODEL),
      temperature: 0,
      messages: [{ role: 'user' as const, content }],
    })
    return parseVisionResponse(text)
  } catch (e) {
    return {
      match: null,
      reason: `Vision check failed: ${e instanceof Error ? e.message : String(e)}`,
      material: 'unknown',
      materialConfidence: 'low',
      redFlags: [],
    }
  }
}
