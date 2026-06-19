// Single source of truth for "did the call capture enough to quote?"
//
// Used by /api/intake/structure to decide whether to dispatch the
// estimation engine + photo-request SMS, or to short-circuit and send
// a brief callback-request SMS instead.
//
// Two layers of gating, applied in order:
//
//   1. UNIVERSAL gate (unchanged) — an intake is 'empty' when confidence
//      is LOW AND we don't have a usable caller name OR a usable scope
//      description. job_type='other' is NOT on its own a reason to fail —
//      tenant-custom assemblies (insect zapper, EV charger, induction
//      cooktop, etc.) legitimately fall outside the structured enum, but
//      the dialog has already gathered enough info for the estimator to
//      attempt a quote. If the estimator can't price the custom service,
//      the grounding validator falls back to the $99 inspection — far
//      better than re-asking the customer "what kind of work?" when they
//      just spent six turns describing it.
//
//      MEDIUM and HIGH confidence intakes clear the UNIVERSAL gate
//      — Sonnet/Opus has already certified there's enough name/scope
//      signal. (HIGH additionally clears the per-job gate; MEDIUM does
//      NOT — see the PER-JOB gate note below.)
//
//   2. PER-JOB gate (R28, added 2026-06-18) — even when the universal gate
//      passes, a quote can still be ungroundable if a field that is
//      MANDATORY *for that specific job type* never got captured. The
//      classic case: a "downlights" intake with a name + a scope sentence
//      but no count. Without the count the estimator can't size labour or
//      materials, so the draft is guesswork. Rather than let it through on
//      global confidence alone, we DOWNGRADE the intake to 'empty', which
//      fires the existing recovery/callback path (a focused clarifying SMS)
//      — satisfying the SAFE-DEFAULT rule: never silently assume a missing
//      pricing-critical field; ask for it first.
//
//      The per-job gate ONLY ever downgrades. It never promotes an intake
//      the universal gate already rejected, and it never raises confidence.
//      A job type with no per-job requirements (or one we can't reliably
//      detect from structured data) is left exactly as the universal gate
//      decided it.
//
//      R28 band coverage (2026-06-18): the per-job gate runs for BOTH LOW
//      and MEDIUM intakes. A hard STRUCTURED field (the count for a
//      count-based easy-5 job) can be absent even when the model rates the
//      overall signal MEDIUM, and the estimator still can't size labour or
//      materials without it — so MEDIUM downlights-without-a-count is
//      downgraded to 'empty' too, firing the focused count recovery SMS.
//      HIGH is never downgraded (the model's top-band certification is
//      sacrosanct). The gate only ever checks discrete structured fields
//      we can detect reliably, so it never re-asks a customer who already
//      answered.

export type IntakeQuality = 'usable' | 'empty'

export type IntakeQualityInput = {
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  caller?: { name?: string | null } | null
  scope?: {
    description?: string | null
    // Structured count of fittings/items (# downlights, # GPOs, # fans,
    // # alarms, # outdoor fittings). Pricing-critical for count-based
    // jobs; mirrors IntakeSchema.scope.item_count. Optional so every
    // existing caller (which only passed description) still type-checks.
    item_count?: number | null
  } | null
  job_type: string
}

const MIN_SCOPE_CHARS = 10

// ── Per-job mandatory structured fields ──────────────────────────────
//
// Mirrors the "how many …" entries of ASSUMPTION_RULES[jobType].mustAsk in
// lib/sms/assumptions.ts (and the row-level shared_assemblies
// .clarifying_questions seeded by migration 065). We deliberately do NOT
// import from lib/sms — quality.ts lives in lib/intake and keeping it free
// of any lib/sms dependency avoids ever forming an import cycle. Instead we
// re-state, as a tiny local map, the subset of mustAsk fields that map to a
// concrete *structured* intake field we can reliably check for presence.
//
// Why only 'count'? The other mustAsk items ("which room", "which tap",
// "supply or we supply") answer into scope.description prose or fields the
// structurer often leaves undefined even when the info was given, so
// gating on them would mis-fire. The count, by contrast, is a discrete
// numeric field (scope.item_count) that the intake structurer populates
// whenever a quantity was stated — and a quote literally cannot be sized
// without it. Confirmed against prod: 39/39 downlights, 25/25 GPO,
// 15/15 fan, 8/8 smoke-alarm, 4/4 outdoor-lighting intakes carry
// scope.item_count when capture succeeded.
type RequiredField = 'count'

const PER_JOB_REQUIRED_FIELDS: Record<string, RequiredField[]> = {
  // Electrical "easy-5" — all count-based.
  downlights: ['count'],
  power_points: ['count'],
  ceiling_fans: ['count'],
  smoke_alarms: ['count'],
  outdoor_lighting: ['count'],
}

// Is a count discernible from the captured intake?
//
// True when EITHER the structured scope.item_count is a positive number,
// OR the scope description contains a digit (the structurer sometimes
// leaves item_count undefined while the count is plainly present in the
// customer's own words, e.g. "5 downlights in the kitchen"). We treat the
// in-prose number as sufficient so we don't re-ask a customer who already
// told us — the estimator reads scope.description too.
function hasCountSignal(scope: IntakeQualityInput['scope']): boolean {
  const count = scope?.item_count
  if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
    return true
  }
  const description = (scope?.description ?? '').trim()
  return /\d/.test(description)
}

// Returns the per-job mandatory fields that are MISSING for this intake.
// Exported for observability/logging by callers; the gate itself only
// needs to know whether the list is non-empty.
export function missingRequiredFields(intake: IntakeQualityInput): RequiredField[] {
  const required = PER_JOB_REQUIRED_FIELDS[intake.job_type] ?? []
  const missing: RequiredField[] = []
  for (const field of required) {
    if (field === 'count' && !hasCountSignal(intake.scope)) {
      missing.push('count')
    }
  }
  return missing
}

export function evaluateIntakeQuality(intake: IntakeQualityInput): IntakeQuality {
  // ── HIGH is sacrosanct ──────────────────────────────────────────────
  // The model certified maximal signal; R28 never overrides HIGH. Returns
  // 'usable' without running either gate. (Per-job downgrades for HIGH
  // would contradict the "never raise/override high-confidence
  // certification" contract.)
  if (intake.confidence === 'HIGH') return 'usable'

  // ── Layer 1: universal gate ─────────────────────────────────────────
  // Only LOW intakes run the universal name/scope check — MEDIUM means the
  // model already certified there's enough name/scope signal, so re-checking
  // those for MEDIUM would contradict the model's certification. MEDIUM
  // still runs the per-job STRUCTURED-field gate below (R28, 2026-06-18):
  // a mandatory discrete field like the count can be absent even when the
  // model rates overall signal MEDIUM, and a quote literally cannot be
  // sized without it. Downgrading MEDIUM→empty for that one hard gap is
  // safe because the recovery SMS now asks the exact missing question
  // (templates.ts buildIntakeRecoverySms 'count' branch).
  if (intake.confidence === 'LOW') {
    const scope = (intake.scope?.description ?? '').trim()
    const hasUsableScope = scope.length >= MIN_SCOPE_CHARS

    // R18 — only PRICE-CRITICAL gaps may drop a quotable lead. A missing
    // customer NAME is non-pricing (we already have their phone number; the
    // name is collected at booking), so it no longer forces 'empty'. Only a
    // missing/too-thin SCOPE — the job description the estimator actually needs
    // to size a quote — fails the universal gate. (The dialog still politely
    // asks for the name once in-conversation; this gate just stops *dropping*
    // an otherwise-quotable lead for the lack of it.) The per-job count gate
    // below still blocks on the one structured price-critical field.
    // job_type='other' alone is not a fail (2026-05-19 "bug zapper" incident).
    if (!hasUsableScope) return 'empty'
  }

  // ── Layer 2: per-job gate (R28) ────────────────────────────────────
  // Runs for LOW *and* MEDIUM. A mandatory STRUCTURED field for THIS job
  // type (today: the count for the count-based easy-5) may still be missing
  // even though the universal gate / MEDIUM certification passed. If so,
  // downgrade to 'empty' so the route's recovery path fires a focused
  // clarifying SMS ("How many downlights…") instead of drafting a quote off
  // a silently-assumed count. PER_JOB_REQUIRED_FIELDS only lists discrete,
  // reliably-detectable structured fields — never soft/subjective prose
  // gaps — so this can't mis-fire and re-ask a customer who already
  // answered. Never raises confidence; only downgrades; never touches HIGH.
  if (missingRequiredFields(intake).length > 0) return 'empty'

  return 'usable'
}
