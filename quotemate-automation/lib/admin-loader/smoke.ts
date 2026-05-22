// Smoke-test harness for the admin bulk loader (spec §8 step 7, §9 rule 7).
//
// For each NEW service the harness builds the minimal quote the estimator
// would draft for it — the service-fee line (sundries portion, marked up)
// plus a labour line that meets the trade's min-hours allowance — and runs
// it through validateQuoteGrounding: the SAME validator that decides
// inspection-fallback on every live quote. A NEW service whose sample
// quote will not ground gets smoke_status='failed' and is held in staging,
// never committed (commit_import_batch gates on smoke_status). It also
// asserts the mandated clarifying questions are well-formed (§9 rule 5).
//
// Honest scope (recorded so it is not mistaken for more than it is): this
// is the DETERMINISTIC groundability gate. The spec also describes "N
// sequential LLM draft calls" for a human-eyeball pass — that is NOT done
// here. An LLM call gating an atomic commit is non-deterministic: a model
// hiccup would flakily block a valid batch. validate.ts is, by its own
// design, "the only deterministic, machine-checkable layer", so the commit
// gate uses exactly that. The LLM-eyeball draft remains a future add.
//
// Pure: every DB-derived input is passed in via SmokeContext, so this is
// unit-testable without a database (mirrors batch.ts).

import {
  buildCandidatePrices,
  validateQuoteGrounding,
  type PricingBookForValidation,
  type RawCandidateRow,
} from '../estimate/validate'

/** The pricing seed used to build the validator's book + labour line. */
export type SmokePricingDefaults = {
  hourly_rate: number
  apprentice_rate: number
  senior_rate?: number | null
  call_out_minimum: number
  default_markup_pct: number
  min_labour_hours: number
}

/** Per-trade smoke context — candidates are trade-scoped, mirroring the
 *  real estimator's `intake.trade` scoping. */
export type SmokeTradeContext = {
  defaults: SmokePricingDefaults
  /** Assembly rows usable as grounding candidates for this trade — the live
   *  shared_assemblies PLUS this batch's NEW assembly staged rows. */
  candidateAssemblies: RawCandidateRow[]
  /** Live shared_materials usable as grounding candidates for this trade. */
  candidateMaterials: RawCandidateRow[]
}

export type SmokeContext = {
  byTrade: Map<string, SmokeTradeContext>
}

export type SmokeResult = { status: 'passed' | 'failed'; reason: string | null }

/**
 * Smoke-test ONE staged service-assembly payload (a NEW shared_assemblies
 * row). Returns 'passed' when a representative quote for the service
 * grounds, 'failed' (with a reason) otherwise.
 */
export function smokeTestServiceRow(
  payload: Record<string, unknown>,
  ctx: SmokeContext,
): SmokeResult {
  const trade = String(payload.trade ?? '')
  const name = String(payload.name ?? '')

  const tc = ctx.byTrade.get(trade)
  if (!tc) {
    return {
      status: 'failed',
      reason: `no pricing defaults for trade "${trade}" — a quote for it cannot ground`,
    }
  }

  // Mandated clarifying questions (§9 rule 5) — zero is valid; any present
  // entry must be a non-empty string.
  const cq = payload.clarifying_questions
  if (cq != null && !Array.isArray(cq)) {
    return { status: 'failed', reason: 'clarifying_questions is not a list' }
  }
  if (Array.isArray(cq)) {
    for (const q of cq) {
      if (typeof q !== 'string' || q.trim().length === 0) {
        return {
          status: 'failed',
          reason: 'a clarifying question is blank or not text',
        }
      }
    }
  }

  const price = Number(payload.default_unit_price_ex_gst)
  const labourHours = Number(payload.default_labour_hours)
  if (!Number.isFinite(price) || price <= 0) {
    return { status: 'failed', reason: 'service fee must be a positive number' }
  }
  if (!Number.isFinite(labourHours) || labourHours < 0) {
    return { status: 'failed', reason: 'labour hours must be zero or more' }
  }

  const { defaults } = tc
  const pricingBook: PricingBookForValidation = {
    hourly_rate: defaults.hourly_rate,
    apprentice_rate: defaults.apprentice_rate,
    senior_rate: defaults.senior_rate ?? null,
    call_out_minimum: defaults.call_out_minimum,
    default_markup_pct: defaults.default_markup_pct,
    min_labour_hours: defaults.min_labour_hours,
  }

  const candidates = buildCandidatePrices(
    tc.candidateMaterials,
    tc.candidateAssemblies,
    pricingBook,
  )

  // The minimal quote the estimator drafts for this service: the
  // service-fee line (marked up at the trade default) plus a labour line
  // that meets the trade's min-hours allowance.
  const markedUp = +(
    price *
    (1 + defaults.default_markup_pct / 100)
  ).toFixed(2)
  const billedHours = Math.max(labourHours, defaults.min_labour_hours)
  const draft = {
    good: {
      line_items: [
        {
          description: name,
          unit: 'each',
          unit_price_ex_gst: markedUp,
          quantity: 1,
          source: 'assembly',
        },
        {
          description: 'Labour',
          unit: 'hr',
          unit_price_ex_gst: defaults.hourly_rate,
          quantity: billedHours,
        },
      ],
    },
  }

  const result = validateQuoteGrounding(draft, pricingBook, candidates)
  if (result.valid) return { status: 'passed', reason: null }

  const f = result.failures[0]
  return {
    status: 'failed',
    reason: `sample quote would not ground — ${f.description}: ${f.expected}`,
  }
}
