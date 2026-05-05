// Single source of truth for "did the call capture enough to quote?"
//
// Used by /api/intake/structure to decide whether to dispatch the
// estimation engine + photo-request SMS, or to short-circuit and send
// a brief callback-request SMS instead.
//
// Rule: an intake is 'empty' when confidence is LOW AND any of the three
// critical fields are missing — caller name, scope description, or job_type.
// Anything LOW-confidence with all three populated still proceeds (estimation
// will mark inspection_required appropriately).
//
// MEDIUM and HIGH confidence intakes always proceed — Sonnet/Opus has
// already certified there's enough signal to draft against.

export type IntakeQuality = 'usable' | 'empty'

export type IntakeQualityInput = {
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
  caller?: { name?: string | null } | null
  scope?: { description?: string | null } | null
  job_type: string
}

const MIN_SCOPE_CHARS = 10
const MIN_NAME_CHARS = 2

export function evaluateIntakeQuality(intake: IntakeQualityInput): IntakeQuality {
  if (intake.confidence !== 'LOW') return 'usable'

  const name = (intake.caller?.name ?? '').trim()
  const scope = (intake.scope?.description ?? '').trim()

  const hasUsableName =
    name.length >= MIN_NAME_CHARS && name.toLowerCase() !== 'unknown'
  const hasUsableScope = scope.length >= MIN_SCOPE_CHARS
  const hasKnownJobType = intake.job_type !== 'other'

  // LOW confidence + ANY critical field missing → empty
  if (!hasUsableName || !hasUsableScope || !hasKnownJobType) return 'empty'
  return 'usable'
}
