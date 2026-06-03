// ════════════════════════════════════════════════════════════════════
// Signage Compliance — Claude vision assessment of one franchisee photo.
//
// Mirrors lib/roofing/vision-verify.ts: a PURE prompt builder + a PURE
// tolerant parser, plus a thin Claude call that NEVER throws on
// operational failure (a vision outage degrades to all-cannot_determine
// so the flow downgrades safely to "needs HQ review" — never a false
// pass/fail).
//
// Only auto_vision rules are ever sent to the model. The other
// applicability classes are handled deterministically by the backstop
// (validate-verdicts.ts) — they are never shown to vision.
// ════════════════════════════════════════════════════════════════════

import type { Confidence, RuleVerdict, ShotSlot, SignageRule, VerdictStatus } from './types'
import { autoRulesForShot, shotLabel } from './shots'

const DEFAULT_MODEL = process.env.SIGNAGE_VISION_MODEL ?? 'claude-sonnet-4-6'

/** PURE — build the per-photo assessment prompt. Demands STRICT JSON with
 *  exactly the shape the parser expects. Instructs the model to return
 *  `cannot_determine` whenever the feature is unclear — never to guess. */
export function buildAssessmentPrompt(args: {
  shotSlot: ShotSlot
  rules: SignageRule[]
}): string {
  const lines: string[] = []
  lines.push(
    `You are a strict brand-compliance assistant for F45 fitness studios.`,
    `Attached is ONE franchisee photo, taken on a phone. It is the "${shotLabel(args.shotSlot)}" shot.`,
    ``,
    `Assess the photo ONLY against the numbered rules below. For each rule decide:`,
    `  - "compliant"        the photo clearly shows the rule is met`,
    `  - "non_compliant"    the photo clearly shows the rule is NOT met`,
    `  - "cannot_determine" you cannot tell from THIS photo (unclear, cropped, ambiguous, wrong angle)`,
    ``,
    `Rules to assess:`,
  )
  args.rules.forEach((r, i) => {
    const hint = r.check_hint ? ` — how to check: ${r.check_hint}` : ''
    // detect_only rules: the AI may flag an obvious violation but can never
    // certify compliance (e.g. exact paint SKU). Tell the model so.
    const tag =
      r.verdict_mode === 'detect_only'
        ? ' [FLAG-ONLY: return non_compliant ONLY if you clearly SEE a violation; otherwise cannot_determine. NEVER return compliant for this rule.]'
        : ''
    lines.push(`  ${i + 1}. [${r.rule_key}] ${r.rule_text}${hint}${tag}`)
  })
  lines.push(
    ``,
    `Hard rules for your judgement:`,
    `  - Judge colour by FAMILY only (e.g. "reads as off-palette / not grey"). Never claim an exact paint code.`,
    `  - Do NOT estimate absolute measurements (inches/cm). If a rule needs a measurement, return cannot_determine.`,
    `  - If the relevant feature is not clearly visible in THIS photo, return cannot_determine. Do not guess.`,
    `  - For any "non_compliant", the evidence MUST state what you actually see in the photo.`,
    ``,
    `Respond with STRICT JSON only, no prose, exactly this shape:`,
    `{`,
    `  "verdicts": [`,
    `    { "rule_key": "<one of the keys above>",`,
    `      "status": "<compliant|non_compliant|cannot_determine>",`,
    `      "confidence": "<high|medium|low>",`,
    `      "evidence": "<one short sentence about what you see>",`,
    `      "red_flags": ["<short tag>", ...] }`,
    `  ]`,
    `}`,
  )
  return lines.join('\n')
}

/** PURE — parse Claude's response into RuleVerdict[]. Tolerant of markdown
 *  fences + surrounding prose. Every coercion collapses to the SAFE value
 *  (unknown status → cannot_determine, unknown confidence → low). Verdicts
 *  for keys not in `allowedKeys` are dropped (the model may not invent
 *  rules). Any unreadable answer yields []. */
export function parseAssessmentResponse(
  text: string | null | undefined,
  allowedKeys: Iterable<string>,
): RuleVerdict[] {
  const allow = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys)
  const t = (text ?? '').trim()
  if (!t) return []
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) return []
  let obj: unknown
  try {
    obj = JSON.parse(m[0])
  } catch {
    return []
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  const arr = (obj as Record<string, unknown>).verdicts
  if (!Array.isArray(arr)) return []

  const out: RuleVerdict[] = []
  const seen = new Set<string>()
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const o = raw as Record<string, unknown>
    const key = typeof o.rule_key === 'string' ? o.rule_key.trim() : ''
    if (!key || !allow.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({
      rule_key: key,
      status: coerceStatus(o.status),
      confidence: coerceConfidence(o.confidence),
      evidence: typeof o.evidence === 'string' ? o.evidence.slice(0, 240) : '',
      red_flags: coerceStringArray(o.red_flags),
    })
  }
  return out
}

// ── Pure helpers ────────────────────────────────────────────────────

function coerceStatus(v: unknown): VerdictStatus {
  if (v === 'compliant' || v === 'non_compliant' || v === 'cannot_determine') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'pass' || s === 'compliant' || s === 'yes') return 'compliant'
    if (s === 'fail' || s === 'non_compliant' || s === 'no') return 'non_compliant'
  }
  return 'cannot_determine'
}

function coerceConfidence(v: unknown): Confidence {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return 'low'
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    .map((s) => s.trim().slice(0, 80))
    .slice(0, 6)
}

/** All-cannot_determine fallback for a rule set — the safe degraded
 *  result when there's no API key or the call fails. */
function allCannotDetermine(rules: SignageRule[], reason: string): RuleVerdict[] {
  return rules.map((r) => ({
    rule_key: r.rule_key,
    status: 'cannot_determine' as const,
    confidence: 'low' as const,
    evidence: reason,
    red_flags: [],
  }))
}

// ── The actual Claude call ──────────────────────────────────────────

export type AssessArgs = {
  photo: { base64: string; mime: string }
  shotSlot: ShotSlot
  /** The studio's applicable rule set. Only the auto_vision rules whose
   *  required_shots include this slot are actually sent to the model. */
  rules: SignageRule[]
  model?: string
}

/**
 * Best-effort Claude vision assessment of one photo. Returns one
 * RuleVerdict per auto_vision rule relevant to this shot. NEVER throws —
 * any operational failure returns all-cannot_determine so the backstop
 * routes those rules to human review.
 */
export async function assessPhoto(args: AssessArgs): Promise<RuleVerdict[]> {
  const relevant = autoRulesForShot(args.rules, args.shotSlot)
  if (relevant.length === 0) return []

  if (!process.env.ANTHROPIC_API_KEY) {
    return allCannotDetermine(relevant, 'ANTHROPIC_API_KEY not set — routed to human review.')
  }

  try {
    const { anthropic } = await import('@ai-sdk/anthropic')
    const { generateText } = await import('ai')

    const prompt = buildAssessmentPrompt({ shotSlot: args.shotSlot, rules: relevant })
    const { text } = await generateText({
      model: anthropic(args.model ?? DEFAULT_MODEL),
      temperature: 0,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: prompt },
            { type: 'image' as const, image: args.photo.base64, mediaType: args.photo.mime },
          ],
        },
      ],
    })

    const parsed = parseAssessmentResponse(
      text,
      relevant.map((r) => r.rule_key),
    )
    // Any rule the model didn't return a verdict for is filled in as
    // cannot_determine so the assessment always covers the full shot.
    const got = new Set(parsed.map((v) => v.rule_key))
    const missing = relevant
      .filter((r) => !got.has(r.rule_key))
      .map((r) => ({
        rule_key: r.rule_key,
        status: 'cannot_determine' as const,
        confidence: 'low' as const,
        evidence: 'No verdict returned for this rule.',
        red_flags: [],
      }))
    return [...parsed, ...missing]
  } catch (e) {
    return allCannotDetermine(
      relevant,
      `Vision check failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}
