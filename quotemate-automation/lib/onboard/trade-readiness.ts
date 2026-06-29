// Trade-readiness gate — answers "is this trade fully wired enough to
// onboard a tradie into it?" so the /onboard wizard and admin onboarding
// only ever offer trades the whole quote pipeline supports.
//
// A trade is "onboardable" only when ALL of the following exist:
//   1. pricing defaults        — defaultsForTrade()/onboarding schema enum
//   2. shared_assemblies rows  — there is a catalogue to quote from (DB)
//   3. estimator prompt        — a bundled template OR a trade_prompts row (DB)
//   4. intake support          — the intake structurer handles the trade
//   5. licence schema          — a per-state licence body label exists
//
// electrical + plumbing satisfy all five (the live pilot trades). Newer
// product surfaces (roofing / solar / commercial painting) run on their
// own bespoke flows and are NOT wired into this self-serve pipeline, so
// they fail here and are reported with exactly what's missing — which is
// what scripts/check-trade-readiness.mjs prints before an onboarding batch.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ONBOARDING_TRADES,
  hasOnboardingPricingDefaults,
  hasLicenceSchema,
} from './schema'
import { hasBundledEstimatorTemplate } from '@/lib/estimate/prompt'

/** Every trade we evaluate readiness for (live + candidate product surfaces). */
export const CANDIDATE_TRADES = [
  'electrical',
  'plumbing',
  'painting',
  'roofing',
  'solar',
  'commercial_painting',
] as const

// Trades whose money path is a DETERMINISTIC engine (per-m² rate card,
// footprint geometry, …) rather than the strict-grounding Opus estimator.
// For these BOTH the "estimator prompt" AND the "shared_assemblies catalogue"
// readiness checks are satisfied by the bundled deterministic pricer — there is
// no system prompt to find and no assembly catalogue to quote from (a painter
// prices from pricing_book.overlays.painting_rate_card, not shared_assemblies),
// so a missing trade_prompts row OR an empty catalogue must NOT gate the trade
// out. Residential painting (lib/painting/pricing.ts) is the first such trade.
const DETERMINISTIC_TRADES = new Set<string>(['painting'])

/** True when this trade prices via a deterministic engine, not the LLM estimator. */
export function isDeterministicTrade(trade: string): boolean {
  return DETERMINISTIC_TRADES.has(trade)
}

export interface TradeReadinessChecks {
  pricingDefaults: boolean
  sharedAssemblies: boolean
  estimatorPrompt: boolean
  intakeRules: boolean
  licenceSchema: boolean
}

export interface TradeReadiness {
  trade: string
  ready: boolean
  /** Human-readable list of what's missing (empty when ready). */
  missing: string[]
  checks: TradeReadinessChecks
}

type DbClient = Pick<SupabaseClient, 'from'>

async function hasSharedAssemblies(supabase: DbClient, trade: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('shared_assemblies')
    .select('id', { count: 'exact', head: true })
    .eq('trade', trade)
  if (error) return false
  return (count ?? 0) > 0
}

async function hasTradePromptRow(supabase: DbClient, trade: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('trade_prompts')
      .select('estimator_system_prompt, trades!inner(name)')
      .eq('trades.name', trade)
      .maybeSingle()
    if (error || !data) return false
    const tpl = (data as { estimator_system_prompt?: string | null }).estimator_system_prompt
    return !!(tpl && tpl.trim() !== '')
  } catch {
    return false
  }
}

/** Evaluate a single trade against all readiness criteria. */
export async function checkTradeReadiness(
  supabase: DbClient,
  trade: string,
): Promise<TradeReadiness> {
  const pricingDefaults = hasOnboardingPricingDefaults(trade)
  // Deterministic trades (painting) quote from a rate card, not a
  // shared_assemblies catalogue, so an empty catalogue must NOT gate them out —
  // mirrors the estimatorPrompt exemption directly below.
  const sharedAssemblies =
    isDeterministicTrade(trade) || (await hasSharedAssemblies(supabase, trade))
  const estimatorPrompt =
    hasBundledEstimatorTemplate(trade) ||
    isDeterministicTrade(trade) ||
    (await hasTradePromptRow(supabase, trade))
  const intakeRules = (ONBOARDING_TRADES as readonly string[]).includes(trade)
  const licenceSchema = hasLicenceSchema(trade)

  const checks: TradeReadinessChecks = {
    pricingDefaults,
    sharedAssemblies,
    estimatorPrompt,
    intakeRules,
    licenceSchema,
  }

  const missing: string[] = []
  if (!pricingDefaults) missing.push('onboarding pricing defaults (defaultsForTrade + schema enum)')
  if (!sharedAssemblies) missing.push('shared_assemblies catalogue rows')
  if (!estimatorPrompt) missing.push('estimator prompt (bundled template or trade_prompts row)')
  if (!intakeRules) missing.push('intake structuring support')
  if (!licenceSchema) missing.push('licence schema (LICENCE_BODIES)')

  return { trade, ready: missing.length === 0, missing, checks }
}

/** Evaluate every candidate trade (defaults to CANDIDATE_TRADES). */
export async function checkAllTradesReadiness(
  supabase: DbClient,
  trades: readonly string[] = CANDIDATE_TRADES,
): Promise<TradeReadiness[]> {
  return Promise.all(trades.map((t) => checkTradeReadiness(supabase, t)))
}

/** The slugs of trades that are ready to onboard into, right now. */
export async function getOnboardableTrades(supabase: DbClient): Promise<string[]> {
  const all = await checkAllTradesReadiness(supabase)
  return all.filter((t) => t.ready).map((t) => t.trade)
}
