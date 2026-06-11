// Pure logic for the SMS plan-estimation flow (migration 104): intent
// detection on the inbound text, and the SMS bodies we send back. Pure +
// unit-tested; the side-effectful handler lives in lib/sms/plan-estimation.ts.

/** "plan" as a drawing noun — rejects "plan to…" / "plan on…" (scheduling)
 *  and never matches "planning" (word boundary). */
const PLAN_NOUN = /\b(floor\s*plans?|plans?(?!\s+(?:to|on)\b)|drawings?|blueprints?|schematics?)\b/i

/** Words that put a plan noun in estimation context — without one of these,
 *  "that plan works for me" mid-dialog must not trigger. */
const PLAN_CONTEXT =
  /\b(electrical|electrician|sparky|estimat\w*|quote[ds]?|pric\w*|cost\w*|analy[sz]\w*|count\w*|upload|send|attach|pdf|builder|build|construction|renovat\w*|takeoff|take-?off)\b/i

/**
 * Should this inbound SMS start the plan-estimation flow?
 *
 * True for: "I'd like an electrical estimation", "can you quote my
 * electrical plan?", "got house plans to price", "need a take-off".
 * False for ordinary job requests ("quote for 6 downlights", "blocked
 * drain") and scheduling phrasing ("I plan to add a GPO").
 */
export function wantsPlanEstimation(message: string): boolean {
  const m = (message ?? '').trim()
  if (!m) return false
  if (/\belectrical\s+estimat\w*\b/i.test(m)) return true
  if (/\btake-?offs?\b/i.test(m)) return true
  return PLAN_NOUN.test(m) && PLAN_CONTEXT.test(m)
}

function greet(firstName?: string | null): string {
  const name = firstName?.trim()
  return name ? `Hi ${name}!` : 'Hi!'
}

/** First reply: the tokenised upload link. */
export function buildPlanUploadSms(opts: {
  firstName?: string | null
  businessName: string
  uploadUrl: string
}): string {
  return (
    `${greet(opts.firstName)} ${opts.businessName} here. Upload your electrical plan PDF at ` +
    `${opts.uploadUrl} and we'll read it automatically — every light, power point and data point ` +
    `counted off the drawing. Results land back here a couple of minutes after you upload.`
  )
}

/** Results reply: link to the take-off + the downloadable PDF report. */
export function buildPlanResultsSms(opts: {
  firstName?: string | null
  businessName: string
  resultsUrl: string
  pdfUrl: string
  lineCount: number
  deviceCount: number
  totalIncGst?: number | null
}): string {
  const headline =
    typeof opts.totalIncGst === 'number'
      ? ` Indicative estimate $${opts.totalIncGst.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} inc GST — ${opts.businessName} will confirm the final price.`
      : ''
  return (
    `${greet(opts.firstName)} Your plan take-off is ready: ${opts.lineCount} item types, ` +
    `${opts.deviceCount} devices counted.${headline} View it: ${opts.resultsUrl} · PDF report: ${opts.pdfUrl}`
  )
}

/** Failure reply: the same link stays live so the customer can retry. */
export function buildPlanFailureSms(opts: {
  firstName?: string | null
  uploadUrl: string
}): string {
  return (
    `${greet(opts.firstName)} We couldn't read that plan, sorry — it may be a scan or a very dense sheet. ` +
    `Try a clearer PDF at the same link: ${opts.uploadUrl}`
  )
}
