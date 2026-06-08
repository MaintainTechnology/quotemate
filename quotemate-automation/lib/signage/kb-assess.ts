// ════════════════════════════════════════════════════════════════════
// Signage Compliance — Step 2: brand file-store cross-check.
//
// After Step 1 (Claude vision vs DB rules + grounding backstop), Step 2
// forms an INDEPENDENT second opinion grounded in the brand's own
// standards documents:
//
//   1. retrievePassages — query the brand's Gemini File Search store(s)
//      (mt-filestore-kb /v1/search) for the standards relevant to a shot.
//   2. one Claude VISION call re-looks at the actual photo WITH those
//      passages + the in-scope rules in hand → structured per-rule verdicts
//      + any new brand-standard findings.
//
// The /v1/search API is text-only, so retrieval (text) and judgement
// (vision) are split — this lets Step 2 catch a FALSE PASS that a text-only
// echo of Step 1 never could.
//
// Design rules (mirror the rest of the pipeline):
//   • PURE builders + parser are exported + unit-tested directly.
//   • Every network call is best-effort and NEVER throws; a KB/vision
//     outage degrades to "no second opinion" (the merge then runs
//     Step-1-only, flagged kb_degraded), never a false pass/fail.
//   • `fetchImpl` + `vision` are injected so tests never hit the network.
// ════════════════════════════════════════════════════════════════════

import { kbSearch, type KbConfig, type KbFetch, type KbGroundingPassage } from '../admin-loader/mt-filestore-kb'
import { kbStoresForBrand, type KbStoreRef } from './kb-supplement'
import { autoRulesForShot } from './shots'
import type {
  AdvisoryFinding,
  BrandConfig,
  Confidence,
  KbRuleVerdict,
  ShotSlot,
  SignageRule,
  VerdictStatus,
} from './types'

const DEFAULT_MODEL = process.env.SIGNAGE_VISION_MODEL ?? 'claude-sonnet-4-6'

// ── Retrieval query (PURE) ──────────────────────────────────────────

/** PURE — the text query sent to the brand store(s) to pull the standards
 *  relevant to one shot. Asks for quoted standards + citations; the
 *  judgement happens later in the vision call. */
export function buildRetrievalQuery(args: {
  brand: Pick<BrandConfig, 'name' | 'location_noun'>
  shotLabel: string
  rules: readonly Pick<SignageRule, 'rule_key' | 'rule_text'>[]
}): string {
  const topics = args.rules.length
    ? args.rules.map((r) => `- ${r.rule_text}`).join('\n')
    : '- signage, logo, colour family, layout, lighting and branding requirements'
  return [
    `What do the ${args.brand.name} brand standards require for the "${args.shotLabel}" of a ${args.brand.name} ${args.brand.location_noun}?`,
    `Cover specifically:`,
    topics,
    ``,
    `Quote the exact standard/requirement and cite its page or section. If a topic is not covered, omit it.`,
  ].join('\n')
}

// ── Vision judgement prompt (PURE) ──────────────────────────────────

/** PURE — the prompt for the Step-2 vision call. The model sees the photo
 *  + the retrieved brand-standard passages and judges each in-scope rule,
 *  and may raise NEW findings that clearly violate a quoted standard. */
export function buildKbVisionPrompt(args: {
  brand: Pick<BrandConfig, 'name' | 'vision_persona' | 'location_noun'>
  shotLabel: string
  passages: string
  rules: readonly SignageRule[]
}): string {
  const lines: string[] = []
  lines.push(
    `You are a strict brand-compliance reviewer for ${args.brand.vision_persona}.`,
    `Attached is ONE phone photo — the "${args.shotLabel}" shot of a ${args.brand.name} ${args.brand.location_noun}.`,
    ``,
    `Below are the relevant ${args.brand.name} brand-standard passages retrieved from the official documents. Judge the photo ONLY against these passages — do not invent standards.`,
    `--- BRAND STANDARDS ---`,
    args.passages.trim() || '(no passages were retrieved)',
    `--- END STANDARDS ---`,
    ``,
    `For each numbered rule decide, using the photo AND the passages above:`,
    `  - "compliant"        the photo clearly meets the standard`,
    `  - "non_compliant"    the photo clearly breaks the standard (cite which)`,
    `  - "cannot_determine" you cannot tell from THIS photo / the passages don't cover it`,
    ``,
    `Rules to judge:`,
  )
  args.rules.forEach((r, i) => {
    lines.push(`  ${i + 1}. [${r.rule_key}] ${r.rule_text}`)
  })
  lines.push(
    ``,
    `You may ALSO report NEW issues: anything in the photo that clearly violates one of the brand-standard passages above but is NOT covered by a numbered rule. Only report a new finding when a quoted standard backs it.`,
    ``,
    `Hard rules:`,
    `  - Judge colour by FAMILY only (e.g. "reads as off-palette"). Never claim an exact paint code.`,
    `  - Do NOT estimate absolute measurements. If a rule needs one, return cannot_determine.`,
    `  - If the feature isn't clearly visible, return cannot_determine. Do not guess.`,
    `  - Every non_compliant and every new finding MUST cite the standard (page/section) it breaks.`,
    ``,
    `Respond with STRICT JSON only, exactly this shape:`,
    `{`,
    `  "verdicts": [`,
    `    { "rule_key": "<one of the keys above>", "status": "<compliant|non_compliant|cannot_determine>",`,
    `      "confidence": "<high|medium|low>", "evidence": "<one short sentence>", "citation": "<page/section or null>" }`,
    `  ],`,
    `  "new_findings": [`,
    `    { "description": "<short sentence>", "citation": "<page/section>" }`,
    `  ]`,
    `}`,
  )
  return lines.join('\n')
}

// ── Parser (PURE) ───────────────────────────────────────────────────

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

function cleanCitation(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'none') return null
  return t.slice(0, 160)
}

export type ParsedKbAssessment = {
  verdicts: KbRuleVerdict[]
  advisory: Array<{ description: string; citation: string | null }>
}

/** PURE — parse the Step-2 vision response. Tolerant of markdown fences +
 *  surrounding prose. Verdicts for keys not in `allowedKeys` are dropped
 *  (the model may not invent rules). Unreadable input → empty result. */
export function parseKbAssessment(
  text: string | null | undefined,
  allowedKeys: Iterable<string>,
): ParsedKbAssessment {
  const allow = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys)
  const t = (text ?? '').trim()
  const empty: ParsedKbAssessment = { verdicts: [], advisory: [] }
  if (!t) return empty
  const m = t.match(/\{[\s\S]*\}/)
  if (!m) return empty
  let obj: unknown
  try {
    obj = JSON.parse(m[0])
  } catch {
    return empty
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return empty
  const o = obj as Record<string, unknown>

  const verdicts: KbRuleVerdict[] = []
  const seen = new Set<string>()
  if (Array.isArray(o.verdicts)) {
    for (const raw of o.verdicts) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const key = typeof r.rule_key === 'string' ? r.rule_key.trim() : ''
      if (!key || !allow.has(key) || seen.has(key)) continue
      seen.add(key)
      verdicts.push({
        rule_key: key,
        status: coerceStatus(r.status),
        confidence: coerceConfidence(r.confidence),
        evidence: typeof r.evidence === 'string' ? r.evidence.slice(0, 240) : '',
        citation: cleanCitation(r.citation),
      })
    }
  }

  const advisory: Array<{ description: string; citation: string | null }> = []
  if (Array.isArray(o.new_findings)) {
    for (const raw of o.new_findings) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const description = typeof r.description === 'string' ? r.description.trim().slice(0, 240) : ''
      if (!description) continue
      advisory.push({ description, citation: cleanCitation(r.citation) })
    }
  }

  return { verdicts, advisory }
}

// ── Thin, never-throw I/O ───────────────────────────────────────────

export type KbVisionFn = (args: {
  model: string
  prompt: string
  photo: { base64: string; mime: string }
}) => Promise<string>

/** Default Step-2 vision call (Claude). Throws on missing key / API error;
 *  callers wrap it so the stage degrades safely. */
async function defaultKbVision(args: {
  model: string
  prompt: string
  photo: { base64: string; mime: string }
}): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set')
  const { anthropic } = await import('@ai-sdk/anthropic')
  const { generateText } = await import('ai')
  const { text } = await generateText({
    model: anthropic(args.model),
    temperature: 0,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: args.prompt },
          { type: 'image' as const, image: args.photo.base64, mediaType: args.photo.mime },
        ],
      },
    ],
  })
  return text
}

/** Concatenate a store's answer + cited passages into a passage block, and
 *  return a flat citation string for fallback. NEVER throws — a store error
 *  yields an empty contribution. */
export async function retrievePassages(
  config: KbConfig,
  args: { stores: readonly KbStoreRef[]; query: string; model?: string; fetchImpl?: KbFetch },
): Promise<{ passages: string; cited: KbGroundingPassage[] }> {
  const chunks: string[] = []
  const cited: KbGroundingPassage[] = []
  for (const store of args.stores) {
    try {
      const res = await kbSearch(
        config,
        { store, query: args.query, ...(args.model ? { model: args.model } : {}) },
        args.fetchImpl,
      )
      if (res.answer?.trim()) chunks.push(res.answer.trim())
      for (const p of res.passages ?? []) {
        cited.push(p)
        if (p.text?.trim()) {
          const where = p.documentTitle ? ` (${p.documentTitle}${p.page ? ` p.${p.page}` : ''})` : ''
          chunks.push(`• ${p.text.trim()}${where}`)
        }
      }
    } catch {
      // skip this store's contribution
    }
  }
  return { passages: chunks.join('\n').slice(0, 6000), cited }
}

function passageCitation(cited: readonly KbGroundingPassage[]): string | null {
  const p = cited.find((x) => x.documentTitle || typeof x.page === 'number')
  if (!p) return null
  return [p.documentTitle, typeof p.page === 'number' ? `p.${p.page}` : null].filter(Boolean).join(' ') || null
}

export type AssessShotResult = {
  verdicts: KbRuleVerdict[]
  advisory: AdvisoryFinding[]
  ok: boolean
}

/** Step 2 for ONE shot: retrieve passages, then one vision call. NEVER
 *  throws — any failure returns ok:false with empty results. */
export async function assessShotAgainstStores(
  config: KbConfig,
  args: {
    brand: Pick<BrandConfig, 'name' | 'vision_persona' | 'location_noun' | 'slug'> & {
      kb_store_ids?: readonly string[] | null
    }
    slot: ShotSlot
    shotLabel: string
    photo: { base64: string; mime: string }
    rules: readonly SignageRule[]
    stores?: readonly KbStoreRef[]
    model?: string
    fetchImpl?: KbFetch
    vision?: KbVisionFn
  },
): Promise<AssessShotResult> {
  const stores = args.stores ?? kbStoresForBrand(args.brand)
  if (stores.length === 0 || args.rules.length === 0) {
    return { verdicts: [], advisory: [], ok: true } // nothing to do is not a failure
  }
  const vision = args.vision ?? defaultKbVision
  try {
    const query = buildRetrievalQuery({ brand: args.brand, shotLabel: args.shotLabel, rules: args.rules })
    const { passages, cited } = await retrievePassages(config, {
      stores,
      query,
      ...(args.model ? { model: args.model } : {}),
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
    })
    const prompt = buildKbVisionPrompt({
      brand: args.brand,
      shotLabel: args.shotLabel,
      passages,
      rules: args.rules,
    })
    const text = await vision({ model: args.model ?? DEFAULT_MODEL, prompt, photo: args.photo })
    const parsed = parseKbAssessment(text, args.rules.map((r) => r.rule_key))
    const fallbackCite = passageCitation(cited)
    const verdicts = parsed.verdicts.map((v) => ({ ...v, citation: v.citation ?? fallbackCite }))
    const advisory: AdvisoryFinding[] = parsed.advisory.map((a) => ({
      shot: args.slot,
      description: a.description,
      citation: a.citation ?? fallbackCite,
      store: stores[0],
    }))
    return { verdicts, advisory, ok: true }
  } catch {
    return { verdicts: [], advisory: [], ok: false }
  }
}

export type KbStageResult = {
  kbVerdicts: KbRuleVerdict[]
  advisory: AdvisoryFinding[]
  stores: KbStoreRef[]
  /** True when Step 2 was meant to run but a shot failed (outage/keys). */
  degraded: boolean
}

export type KbStageShot = {
  slot: ShotSlot
  label: string
  photo: { base64: string; mime: string }
}

/** Orchestrate Step 2 across all submitted shots. NEVER throws. Returns an
 *  empty result (degraded:false) when the brand has no stores. */
export async function runKbStage(
  config: KbConfig,
  args: {
    brand: Pick<BrandConfig, 'name' | 'vision_persona' | 'location_noun' | 'slug'> & {
      kb_store_ids?: readonly string[] | null
    }
    shots: readonly KbStageShot[]
    scopedRules: readonly SignageRule[]
    model?: string
    fetchImpl?: KbFetch
    vision?: KbVisionFn
  },
): Promise<KbStageResult> {
  const stores = kbStoresForBrand(args.brand)
  if (stores.length === 0) {
    return { kbVerdicts: [], advisory: [], stores: [], degraded: false }
  }

  const kbVerdicts: KbRuleVerdict[] = []
  const advisory: AdvisoryFinding[] = []
  let degraded = false
  for (const shot of args.shots) {
    const rulesForShot = autoRulesForShot([...args.scopedRules], shot.slot)
    if (rulesForShot.length === 0) continue
    const res = await assessShotAgainstStores(config, {
      brand: args.brand,
      slot: shot.slot,
      shotLabel: shot.label,
      photo: shot.photo,
      rules: rulesForShot,
      stores,
      ...(args.model ? { model: args.model } : {}),
      ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
      ...(args.vision ? { vision: args.vision } : {}),
    })
    if (!res.ok) degraded = true
    kbVerdicts.push(...res.verdicts)
    advisory.push(...res.advisory)
  }

  return { kbVerdicts, advisory, stores, degraded }
}
