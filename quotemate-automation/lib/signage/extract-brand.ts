// ════════════════════════════════════════════════════════════════════
// Signage / Brand Compliance — self-serve ingestion.
//
// Turns ANY brand's standards document (text) into a ready-to-seed brand:
// a guided shot list + a rule registry already tagged with verdict_mode.
// This productises the two one-off workflows used to onboard F45, so a new
// brand (McDonald's, Subway, Gelatissimo) is onboarded by dropping in their
// standards doc — no developer in the loop.
//
// PURE prompt builder + tolerant parser; thin Claude call that NEVER throws.
// ════════════════════════════════════════════════════════════════════

import type { Confidence, ShotDef, VerdictMode } from './types'

const DEFAULT_MODEL = process.env.SIGNAGE_EXTRACT_MODEL ?? 'claude-opus-4-8'

export type ExtractedRule = {
  rule_key: string
  rule_text: string
  rule_group: string
  modality: 'must' | 'should' | 'optional' | 'process'
  verdict_mode: VerdictMode
  /** A shot slot id from the proposed shot list, or 'na'. */
  shot: string
  check_hint: string
  confidence: Confidence
  source_citation: string | null
}

export type BrandExtraction = {
  shots: ShotDef[]
  rules: ExtractedRule[]
}

const VERDICT_GUIDANCE = `verdict_mode tells the AI how it may act on a rule from a single phone photo:
- "pass_fail": a photo can CONFIRM and DENY it (presence/absence, layout/position, RELATIVE proportion/ratio, ordinal/stacking order, coverage, on-photo text/OCR, colour-family when the rule is about the right family being present).
- "detect_only": the AI may FLAG an obvious violation but never CERTIFY compliance (exact named colour/paint SKU, "is it LED-backlit", anything where an obvious wrong is visible but a clean photo is not proof).
- "needs_reference": needs an absolute measurement only checkable with a tape/known object in frame (e.g. "28 inches from the floor", "100 inches wide").
- "review": not photo-checkable — needs external data (HQ approval on file, a receipt/invoice, a landlord letter) OR is legal/process/awareness/subjective.`

/** PURE — build the extraction prompt for one brand's standards document. */
export function buildBrandExtractionPrompt(args: {
  brandName: string
  locationNoun: string
  docText: string
}): string {
  return [
    `You are onboarding the brand "${args.brandName}" onto a photo-based compliance-audit platform.`,
    `A "${args.locationNoun}" is one of this brand's locations. Below is their brand-standards document.`,
    ``,
    `Do TWO things:`,
    `1. Propose the guided PHOTO SHOTS a ${args.locationNoun} should submit for a compliance audit — 3 to 7 shots. Each: a snake_case "slot" id, a short "label", and a one-line "instruction" telling the person what to capture.`,
    `2. Extract EVERY discrete, checkable compliance rule from the document. For each rule provide:`,
    `   - rule_key: a stable kebab-case id`,
    `   - rule_text: the normalised rule`,
    `   - rule_group: a short category (e.g. "storefront", "signage", "cleanliness", "uniform")`,
    `   - modality: "must" | "should" | "optional" | "process"`,
    `   - shot: the slot id (from your shot list) this rule is best judged from, or "na"`,
    `   - verdict_mode: one of pass_fail | detect_only | needs_reference | review`,
    `   - check_hint: concretely what the AI looks for (for detect_only, what VIOLATION to flag)`,
    `   - confidence: high | medium | low`,
    `   - source_citation: a page/section reference if visible, else null`,
    ``,
    VERDICT_GUIDANCE,
    `Be generous toward pass_fail/detect_only where a photo genuinely supports it, but never mark pass_fail if a compliant photo cannot PROVE compliance (use detect_only). Never invent rules not in the document.`,
    ``,
    `Respond with STRICT JSON only, exactly this shape:`,
    `{`,
    `  "shots": [ { "slot": "...", "label": "...", "instruction": "..." } ],`,
    `  "rules": [ { "rule_key": "...", "rule_text": "...", "rule_group": "...", "modality": "must",`,
    `              "shot": "...", "verdict_mode": "pass_fail", "check_hint": "...", "confidence": "high",`,
    `              "source_citation": null } ]`,
    `}`,
    ``,
    `=== BRAND STANDARDS DOCUMENT (${args.brandName}) ===`,
    args.docText,
  ].join('\n')
}

const MODES: ReadonlySet<VerdictMode> = new Set(['pass_fail', 'detect_only', 'needs_reference', 'review'])
const MODALITIES = new Set(['must', 'should', 'optional', 'process'])

function coerceMode(v: unknown): VerdictMode {
  return typeof v === 'string' && MODES.has(v as VerdictMode) ? (v as VerdictMode) : 'review'
}
function coerceConf(v: unknown): Confidence {
  return v === 'high' || v === 'medium' || v === 'low' ? v : 'low'
}

/** PURE — tolerant parse of the model's extraction response. Drops malformed
 *  rows; never throws. */
export function parseBrandExtraction(text: string | null | undefined): BrandExtraction {
  const empty: BrandExtraction = { shots: [], rules: [] }
  const t = (text ?? '').trim()
  if (!t) return empty
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) return empty
  let obj: unknown
  try {
    obj = JSON.parse(m[0])
  } catch {
    return empty
  }
  if (!obj || typeof obj !== 'object') return empty
  const o = obj as Record<string, unknown>

  const shots: ShotDef[] = Array.isArray(o.shots)
    ? (o.shots as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .map((s) => ({ slot: String(s.slot ?? ''), label: String(s.label ?? s.slot ?? ''), instruction: String(s.instruction ?? '') }))
        .filter((s) => s.slot !== '')
    : []

  const validSlots = new Set(shots.map((s) => s.slot))
  const seen = new Set<string>()
  const rules: ExtractedRule[] = Array.isArray(o.rules)
    ? (o.rules as unknown[])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        .map((r) => {
          const shot = String(r.shot ?? 'na')
          const modality = String(r.modality ?? 'must')
          return {
            rule_key: String(r.rule_key ?? '').trim(),
            rule_text: String(r.rule_text ?? '').trim(),
            rule_group: String(r.rule_group ?? 'other'),
            modality: (MODALITIES.has(modality) ? modality : 'must') as ExtractedRule['modality'],
            verdict_mode: coerceMode(r.verdict_mode),
            shot: validSlots.has(shot) ? shot : 'na',
            check_hint: String(r.check_hint ?? ''),
            confidence: coerceConf(r.confidence),
            source_citation: r.source_citation == null ? null : String(r.source_citation),
          }
        })
        .filter((r) => {
          if (!r.rule_key || !r.rule_text || seen.has(r.rule_key)) return false
          seen.add(r.rule_key)
          return true
        })
    : []

  return { shots, rules }
}

/** Best-effort Claude extraction. NEVER throws — returns an empty extraction
 *  on any failure so the operator pipeline can report and stop cleanly. */
export async function extractBrand(args: {
  brandName: string
  locationNoun: string
  docText: string
  model?: string
}): Promise<BrandExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) return { shots: [], rules: [] }
  try {
    const { anthropic } = await import('@ai-sdk/anthropic')
    const { generateText } = await import('ai')
    const prompt = buildBrandExtractionPrompt(args)
    const { text } = await generateText({
      model: anthropic(args.model ?? DEFAULT_MODEL),
      temperature: 0,
      messages: [{ role: 'user' as const, content: prompt }],
    })
    return parseBrandExtraction(text)
  } catch {
    return { shots: [], rules: [] }
  }
}
