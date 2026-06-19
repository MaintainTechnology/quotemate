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
}

export type SanityVerdict = { ok: true } | { ok: false; failures: string[] }

/** How far above the expected per-unit labour we tolerate before flagging.
 *  Deliberately loose — this catches gross scope errors, not fine drift. */
const PER_UNIT_TOLERANCE = 1.75

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
    const perUnit = input.totalLabourHours / input.quantity
    const cap = bound.per_unit_labour_hours * PER_UNIT_TOLERANCE
    if (perUnit > cap) {
      failures.push(
        `per-unit labour ${perUnit.toFixed(2)}h > ${cap.toFixed(2)}h (${PER_UNIT_TOLERANCE}× expected ${bound.per_unit_labour_hours}h)`,
      )
    }
  }

  return failures.length ? { ok: false, failures } : { ok: true }
}
