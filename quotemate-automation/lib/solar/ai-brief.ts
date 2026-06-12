// ════════════════════════════════════════════════════════════════════
// Solar — AI roof-intelligence brief (Felt tab spec 2026-06-13 §4.6).
//
// Anthropic (Sonnet via the Vercel AI SDK) writes a short, customer-
// readable narrative about the roof: why the layout sits where it does,
// which plane works hardest, and how the sun behaves seasonally.
//
// GROUNDING RULES (the hard part — mirrors lib/estimate/validate.ts
// philosophy):
//   • The prompt receives ONLY a frozen facts payload — roof geometry,
//     sun scores, panel counts, sunshine hours. NO prices, NO tariffs,
//     NO rebate figures ever enter the prompt.
//   • Every numeric token in the output must literally appear in the
//     input facts (after unit normalisation). A fabricated number ⇒
//     the whole brief is DISCARDED and the section falls back to the
//     deterministic sun-score copy. Prose is allowed; invented numbers
//     are not.
//   • Display-only — the brief never feeds sizing or pricing.
//
// Persisted on solar_estimates.ai_brief with the model id + an input
// hash so a re-draft regenerates only when the facts changed.
// ════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveSolarSunScores } from './sun-score'
import type { SolarEstimate } from './types'

export const SOLAR_BRIEF_MODEL = 'claude-sonnet-4-6'

// ── Schema ────────────────────────────────────────────────────────────

export const SolarAiBriefSchema = z.object({
  /** One-line headline, sentence case, ≤ 120 chars. */
  headline: z.string().min(8).max(160),
  /** Why the panels sit where they do. */
  layout_rationale: z.string().min(20).max(600),
  /** The hardest-working plane, in plain words. */
  best_plane_note: z.string().min(10).max(400),
  /** Seasonal sun behaviour for this roof. */
  seasonal_note: z.string().min(10).max(400),
  /** Honest caveats (shading, imagery age, etc). 0–4 items. */
  caveats: z.array(z.string().min(5).max(240)).max(4),
})

export type SolarAiBrief = z.infer<typeof SolarAiBriefSchema>

/** The persisted ai_brief jsonb shape. */
export type SolarAiBriefRecord = SolarAiBrief & {
  model: string
  input_hash: string
  generated_at: string
}

// ── Facts payload (PURE) ─────────────────────────────────────────────

export type SolarBriefFacts = {
  state: string
  postcode: string
  panel_count: number | null
  system_kw: number | null
  max_sunshine_hours_per_year: number | null
  imagery_date: string | null
  imagery_quality: string | null
  planes: Array<{
    orientation: string
    pitch_degrees: number
    area_m2: number
    panels_count: number | null
    sun_label: string | null
    sun_relative_pct: number | null
  }>
  shade_free_hours: number | null
}

/**
 * PURE — freeze the facts the model may talk about. Deliberately NO
 * prices, tariffs or rebate figures. Returns null when the roof has no
 * geometry to ground a narrative on (manual path).
 */
export function buildSolarBriefFacts(estimate: SolarEstimate): SolarBriefFacts | null {
  if (estimate.coverage_source !== 'google') return null
  if (estimate.roof.planes.length === 0) return null
  const scores = deriveSolarSunScores(estimate.roof)
  const headlineTier = estimate.sizing.tiers[estimate.sizing.tiers.length - 1] ?? null
  return {
    state: estimate.context.state,
    postcode: estimate.context.postcode,
    panel_count: headlineTier?.panels_count ?? null,
    system_kw: headlineTier?.system_kw_dc ?? null,
    max_sunshine_hours_per_year: estimate.roof.max_sunshine_hours_per_year ?? null,
    imagery_date: estimate.roof.imagery_date,
    imagery_quality: estimate.roof.imagery_quality,
    planes: estimate.roof.planes.map((p, i) => ({
      orientation: p.orientation,
      pitch_degrees: round1(p.pitch_degrees),
      area_m2: round1(p.area_m2),
      panels_count: p.panels_count ?? null,
      sun_label: scores.planes[i]?.label ?? null,
      sun_relative_pct: scores.planes[i]?.relative_pct ?? null,
    })),
    shade_free_hours: estimate.context.sun?.shade?.shade_free_hours ?? null,
  }
}

/** PURE — deterministic hash of the facts payload (regeneration key). */
export function briefInputHash(facts: SolarBriefFacts): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16)
}

// ── Grounding validator (PURE) ────────────────────────────────────────

const NUMBER_TOKEN_RE = /\d+(?:[.,]\d+)?/g

/** PURE — every numeric token in a brief's prose. "1,200" → 1200. */
export function extractNumericTokens(text: string): number[] {
  const out: number[] = []
  for (const m of text.match(NUMBER_TOKEN_RE) ?? []) {
    const n = Number.parseFloat(m.replace(/,/g, ''))
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/** PURE — the set of numbers the model was given (plus benign forms). */
export function factsNumericSet(facts: SolarBriefFacts): Set<number> {
  const set = new Set<number>()
  const add = (n: number | null) => {
    if (n === null || !Number.isFinite(n)) return
    set.add(n)
    set.add(Math.round(n))
    set.add(round1(n))
  }
  add(facts.panel_count)
  add(facts.system_kw)
  add(facts.max_sunshine_hours_per_year)
  add(facts.shade_free_hours)
  for (const p of facts.planes) {
    add(p.pitch_degrees)
    add(p.area_m2)
    add(p.panels_count)
    add(p.sun_relative_pct)
  }
  // Dates in prose ("2024 imagery") + the postcode are grounded facts.
  if (facts.imagery_date) {
    const year = Number.parseInt(facts.imagery_date.slice(0, 4), 10)
    if (Number.isFinite(year)) set.add(year)
  }
  const pc = Number.parseInt(facts.postcode, 10)
  if (Number.isFinite(pc)) set.add(pc)
  return set
}

/**
 * PURE — the hard gate: every numeric token in the brief must exist in
 * the facts set. Returns the violations (empty = grounded).
 */
export function validateBriefGrounding(
  brief: SolarAiBrief,
  facts: SolarBriefFacts,
): number[] {
  const allowed = factsNumericSet(facts)
  const prose = [
    brief.headline,
    brief.layout_rationale,
    brief.best_plane_note,
    brief.seasonal_note,
    ...brief.caveats,
  ].join('\n')
  return extractNumericTokens(prose).filter((n) => !allowed.has(n))
}

// ── Prompt ────────────────────────────────────────────────────────────

/** PURE — the full prompt. Exported for tests/inspection. */
export function buildBriefPrompt(facts: SolarBriefFacts): string {
  return [
    'You are writing a short roof analysis for an Australian homeowner who just received a solar estimate.',
    'Write in Australian English, sentence case, plain language, no marketing fluff, no exclamation marks.',
    '',
    'HARD RULES:',
    '- Use ONLY the facts below. Do not invent any number, percentage, or measurement.',
    '- Every number you mention must appear verbatim in the facts. If unsure, write prose without numbers.',
    '- Never mention prices, rebates, or dollar figures of any kind.',
    '- Compass logic is southern-hemisphere: north-facing roofs collect the most sun.',
    '',
    'FACTS (JSON):',
    JSON.stringify(facts, null, 2),
    '',
    'Respond with ONLY a JSON object (no markdown fences) of this exact shape:',
    '{"headline": string, "layout_rationale": string, "best_plane_note": string, "seasonal_note": string, "caveats": string[]}',
  ].join('\n')
}

// ── Generation (best-effort, injectable for tests) ───────────────────

export type SolarAiBriefOpts = {
  /** Injectable text generator (tests). Default: Anthropic via AI SDK. */
  generate?: (prompt: string) => Promise<string>
  /** Model id recorded on the persisted brief. */
  modelId?: string
  /** Bypass the env gate (tests). */
  forceEnabled?: boolean
}

/** PURE — strip optional markdown fences and parse the model's JSON. */
export function parseBriefResponse(text: string): SolarAiBrief | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    const parsed = SolarAiBriefSchema.safeParse(JSON.parse(cleaned))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function defaultGenerate(prompt: string, modelId: string): Promise<string> {
  const { anthropic } = await import('@ai-sdk/anthropic')
  const { generateText } = await import('ai')
  const { text } = await generateText({
    model: anthropic(modelId),
    prompt,
    maxOutputTokens: 1200,
  })
  return text
}

/**
 * Generate + validate + persist the roof-intelligence brief for one
 * estimate. Best-effort; never throws. Skips when: gate off, manual
 * roof, or the existing brief already matches the current facts hash.
 * A grounding violation DISCARDS the brief (the page falls back to the
 * deterministic sun-score copy).
 */
export async function applySolarAiBrief(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  args: { publicToken: string },
  opts: SolarAiBriefOpts = {},
): Promise<SolarAiBriefRecord | null> {
  try {
    if (!opts.forceEnabled && !process.env.ANTHROPIC_API_KEY) return null

    const { data: row } = await supabase
      .from('solar_estimates')
      .select('id, estimate, ai_brief')
      .eq('public_token', args.publicToken)
      .maybeSingle()
    if (!row?.id || !row.estimate) return null

    const estimate = row.estimate as SolarEstimate
    const facts = buildSolarBriefFacts(estimate)
    if (!facts) return null

    const hash = briefInputHash(facts)
    const existing = row.ai_brief as SolarAiBriefRecord | null
    if (existing?.input_hash === hash) return existing

    const modelId = opts.modelId ?? SOLAR_BRIEF_MODEL
    const generate = opts.generate ?? ((p: string) => defaultGenerate(p, modelId))
    const text = await generate(buildBriefPrompt(facts))

    const brief = parseBriefResponse(text)
    if (!brief) return null

    const violations = validateBriefGrounding(brief, facts)
    if (violations.length > 0) {
      console.warn(
        '[solar/ai-brief] discarded — ungrounded numbers:',
        violations.slice(0, 5).join(', '),
      )
      return null
    }

    const record: SolarAiBriefRecord = {
      ...brief,
      model: modelId,
      input_hash: hash,
      generated_at: new Date().toISOString(),
    }
    await supabase.from('solar_estimates').update({ ai_brief: record }).eq('id', row.id)
    return record
  } catch (e) {
    console.error(
      '[solar/ai-brief] generation failed:',
      e instanceof Error ? e.message : String(e),
    )
    return null
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
