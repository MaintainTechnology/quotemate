// R9 — deterministic sanity-bounds layer.
//
// Per-line grounding proves each price traces to a DB row; it CANNOT see that a
// quote's *total* or *labour hours* are grossly wrong (the 6-downlight job that
// billed 17.5 h is the canonical case — each labour line grounds to the hourly
// rate, but the quantity × hours is absurd). This layer is the backstop: a
// quote whose totals fall outside the per-(trade, job_type) band routes to the
// $99 inspection — it is NOT auto-corrected, because an out-of-band total is a
// signal the scope was misread, not a number to silently nudge.
//
// Pure + I/O-free so it is trivially unit-tested. Bounds are injected (loaded
// from the job_type_bounds table by the caller), so a job_type with no bound
// row simply isn't bounded (opt-in per job-type — bounds are added as they are
// tradie-confirmed).

export type JobTypeBound = {
  trade: string
  job_type: string
  /** absolute cap on total labour hours for the job (gross-error catch). */
  max_labour_hours: number | null
  /** plausible total ex-GST floor / ceiling for the job. */
  min_total_ex_gst: number | null
  max_total_ex_gst: number | null
  /** expected labour hours per unit (for quantity-scaled jobs like downlights). */
  per_unit_labour_hours: number | null
}

export type SanityInput = {
  jobType: string
  trade: string
  /** item count for quantity-scaled jobs (downlights, GPOs, fans); else null. */
  quantity?: number | null
  totalLabourHours: number
  totalExGst: number
  /**
   * The tenant's configured minimum charge (`pricing_book.min_labour_hours`).
   * A FLOOR, not extra work: `applyMinLabourFloor` (lib/estimate/min-labour.ts:81)
   * tops labour up to it and never beyond. Absent/blank → 0.
   */
  minLabourHours?: number | null
  /**
   * One-off labour a price_recipe added — e.g. a single cable run shared by
   * every unit on the job. Does NOT scale with quantity, so it is added to the
   * cap rather than divided into it. Absent/blank → 0.
   */
  recipeLabourHours?: number | null
}

export type SanityVerdict = { ok: true } | { ok: false; failures: string[] }

/** How far above the expected per-unit labour we tolerate before flagging.
 *  Deliberately loose — this catches gross scope errors, not fine drift. */
const PER_UNIT_TOLERANCE = 1.75

/** Minimal line shape the one-off sum needs. Mirrors merge-recipes' DraftLineItem
 *  without importing it, so this module stays dependency-free. */
export type LabourLineLike = {
  source?: string
  unit?: string
  quantity?: number | string
  recipe_origin?: boolean
  recipe_swap?: boolean
}

/**
 * Sum the ONE-OFF labour hours a price_recipe added to a tier — the fixed cost
 * that does not scale with item count (one cable run shared by every unit).
 *
 * Two exclusions, both load-bearing:
 *
 * 1. `recipe_swap` lines are skipped. A SWAP band REPLACES the base assembly's
 *    lines (merge-recipes.ts strips every prior `source==='labour'` line), so
 *    its labour is the job's whole labour, not an addition. Counting it made
 *    `recipeLabourHours === totalLabourHours`, so `cap >= total` always held
 *    and R9's per-unit branch went inert.
 * 2. Non-recipe lines are skipped — Opus's own labour must stay inside the
 *    scaled allowance.
 *
 * Pure and exported so this is directly testable; `run.ts` reads the markers off
 * the post-dedup, post-revert DRAFT rather than off TierMergeOutcome, which is
 * neither.
 */
export function recipeLabourFromLines(lineItems: readonly LabourLineLike[] | null | undefined): number {
  if (!Array.isArray(lineItems)) return 0
  let hours = 0
  for (const l of lineItems) {
    if (l?.recipe_origin !== true) continue
    if (l?.recipe_swap === true) continue
    if (l?.source !== 'labour' && l?.unit !== 'hr') continue
    const q = Number(l?.quantity)
    if (Number.isFinite(q) && q > 0) hours += q
  }
  return hours
}

export function boundForJob(
  bounds: ReadonlyArray<JobTypeBound>,
  trade: string,
  jobType: string,
): JobTypeBound | undefined {
  return bounds.find((b) => b.trade === trade && b.job_type === jobType)
}

/**
 * R9 — check a built quote against its job-type band. Returns ok:true when no
 * bound is defined (opt-in) or all bounds hold; ok:false + reasons otherwise.
 * The caller routes a failing quote to inspection.
 */
export function checkSanityBounds(
  input: SanityInput,
  bound: JobTypeBound | undefined,
): SanityVerdict {
  if (!bound) return { ok: true }
  const failures: string[] = []

  if (bound.max_labour_hours != null && input.totalLabourHours > bound.max_labour_hours) {
    failures.push(`labour ${input.totalLabourHours}h > max ${bound.max_labour_hours}h`)
  }
  if (bound.min_total_ex_gst != null && input.totalExGst < bound.min_total_ex_gst) {
    failures.push(`total $${input.totalExGst} < min $${bound.min_total_ex_gst}`)
  }
  if (bound.max_total_ex_gst != null && input.totalExGst > bound.max_total_ex_gst) {
    failures.push(`total $${input.totalExGst} > max $${bound.max_total_ex_gst}`)
  }
  if (
    bound.per_unit_labour_hours != null &&
    input.quantity != null &&
    input.quantity > 0
  ) {
    // Labour on a real job is AFFINE — `fixed + per_unit × n` — so compare the
    // total against an affine cap rather than dividing the total by n. Dividing
    // pushed every fixed cost (the tenant's minimum charge, a recipe's one-off
    // cable run) into the per-unit figure, which made the cap tightest exactly
    // where fixed costs dominate: at quantity 1. That routed legitimate
    // single-item quotes to the $99 inspection on any tenant with a 2h floor.
    //
    // Math.max, NOT a sum: the minimum charge and the scaled allowance are
    // alternative explanations for the same hours, not additive ones. Summing
    // them would give a 6-downlight job with a 2h floor a 12.5h cap instead of
    // 10.5h and drift the guard toward inert.
    const minCharge = Math.max(0, Number(input.minLabourHours) || 0)
    const oneOff = Math.max(0, Number(input.recipeLabourHours) || 0)
    const scaled = bound.per_unit_labour_hours * input.quantity * PER_UNIT_TOLERANCE
    const cap = Math.max(minCharge, scaled) + oneOff
    if (input.totalLabourHours > cap) {
      // Message keeps the per-unit figure because that is the number a human
      // reads, while naming every term so an operator can see WHICH allowance
      // was too small.
      const perUnit = input.totalLabourHours / input.quantity
      failures.push(
        `per-unit labour ${perUnit.toFixed(2)}h — total ${input.totalLabourHours.toFixed(2)}h > cap ${cap.toFixed(2)}h ` +
          `(${PER_UNIT_TOLERANCE}× expected ${bound.per_unit_labour_hours}h × ${input.quantity}` +
          `${minCharge ? `, min charge ${minCharge}h` : ''}${oneOff ? `, recipe ${oneOff}h` : ''})`,
      )
    }
  }

  return failures.length ? { ok: false, failures } : { ok: true }
}

// ── Phase 5b — the monotonic tier assertion ─────────────────────────────
//
// Good ≤ Better ≤ Best. Obvious, and nothing checked it.
//
// It matters MORE after Phase 4 than before. Until R3/R4 all three tiers were
// scored from one catalogue by one rule, so the ordering fell out for free.
// Now three independent things can each place a product in one tier without
// consulting the others:
//   · R3 the customer's pick anchors ITS tier — they can choose the dearest
//        product on offer and have it land in Better
//   · R2 a tradie's ladder pin is per (category, tier) and nothing stops them
//        pinning a $300 product to Good
//   · R4 the shared fallback indexes by price, but only within one category
// A quote reading "Good $250 / Better $200" is obviously broken to a customer
// and invisible to every check that exists today.
//
// SHADOW ONLY, deliberately. This reports; it does not null a tier and does
// not route to inspection. Two reasons. An inverted ladder is a presentation
// fault, not a fabricated price, so the $99 inspection is a wildly
// disproportionate answer — and this phase has already produced one bug where
// a correct quote was billed as an inspection. Second, nobody yet knows how
// often a legitimate tradie pin inverts the ladder; collect the signal on real
// quotes first, then decide whether to enforce. The caller surfaces failures
// as risk_flags, which is what a tradie actually reads.
//
// Pure and I/O-free, like the rest of this module.

/** Subtotals for the tiers a draft actually carries. Absent/null = tier not
 *  offered, which is normal: fault_finding has no best, and a review-gated or
 *  Opus-fallback picked quote may hold only one. */
export type TierSubtotals = {
  good?: number | null
  better?: number | null
  best?: number | null
}

/**
 * Assert the offered tiers ascend in price. Compares only the tiers PRESENT,
 * in good → better → best order, so a quote offering Good + Best is checked as
 * that pair rather than skipped for want of a middle.
 *
 * Equal subtotals PASS. Two tiers at one price is a duplicate, which
 * `collapseDuplicateTiers` already owns; reporting it here too would hand an
 * operator two findings for one fault.
 *
 * Non-finite or missing subtotals are SKIPPED, not read as zero. Treating a
 * missing total as 0 would invent an inversion that is not there and put a
 * false flag on a quote that is fine.
 */
export function checkTierMonotonicity(tiers: TierSubtotals): SanityVerdict {
  const ORDER = ['good', 'better', 'best'] as const
  const present = ORDER
    // ⚠ null/undefined/'' are filtered BEFORE Number(). Number(null) is 0 and
    // 0 IS finite, so a Number.isFinite check alone reads an absent tier as
    // free and reports better:$0 < good:$100 — a false inversion on a quote
    // that is perfectly fine. Caught by the test named for it.
    .filter((key) => tiers[key] !== null && tiers[key] !== undefined && tiers[key] !== ('' as never))
    .map((key) => ({ key, value: Number(tiers[key]) }))
    .filter((t) => Number.isFinite(t.value))

  const failures: string[] = []
  for (let i = 1; i < present.length; i++) {
    const prev = present[i - 1]
    const cur = present[i]
    if (cur.value < prev.value) {
      failures.push(
        `tier order: ${cur.key} $${cur.value.toFixed(2)} < ${prev.key} $${prev.value.toFixed(2)} ` +
          `— the ladder is inverted, so a dearer option is being shown as the cheaper one`,
      )
    }
  }
  return failures.length ? { ok: false, failures } : { ok: true }
}
