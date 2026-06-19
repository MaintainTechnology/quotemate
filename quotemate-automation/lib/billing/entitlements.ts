// Plan entitlements + the billing-enforcement gate. Pure logic (no I/O) so
// it's unit-testable and cheap to import in the hot quote-drafting path.
//
// Enforcement is OFF by default and only takes effect when
// BILLING_ENFORCEMENT_ENABLED=true. It is ALSO bypassed for any tenant with
// billing_exempt=true (the grandfathered pilots / founding tradies). This
// lets the gate ship live without cutting off the existing free tenants —
// flip the env flag once the founding cohort is exempted.
//
// Design (from the pricing council): VOICE is the metered, plan-gated
// channel (off on Starter, hard-capped by minutes); QUOTES are fair-use —
// never hard-blocked on count, only flagged — so a busy tradie is never cut
// off mid-job. The only hard block on the quote path is "no active sub".

export type PlanKey = 'starter' | 'pro' | 'crew'

export type PlanLimits = { voice: boolean; voiceMinutes: number; quotes: number }

// MONTHLY allowances. Annual subscribers reset on the same monthly cadence —
// the voice-minute pools are per month regardless of billing interval.
export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  starter: { voice: false, voiceMinutes: 0, quotes: 40 },
  pro: { voice: true, voiceMinutes: 300, quotes: 150 },
  crew: { voice: true, voiceMinutes: 1000, quotes: 400 },
}

// Statuses that keep the receptionist working. `past_due` is included so a
// failed renewal (Stripe mid-dunning + retrying) doesn't instantly cut a
// paying tradie off; canceled / unpaid / incomplete do NOT.
const ACTIVE_STATUSES = new Set(['trialing', 'active', 'past_due'])

export type TenantBilling = {
  subscription_status: string | null
  subscription_plan: string | null
  billing_exempt?: boolean | null
}

export type Usage = { quotesUsed: number; voiceMinutesUsed: number }

export function isEnforcementEnabled(): boolean {
  return process.env.BILLING_ENFORCEMENT_ENABLED === 'true'
}

export function hasActiveSubscription(t: TenantBilling): boolean {
  return !!t.subscription_status && ACTIVE_STATUSES.has(t.subscription_status)
}

export function planLimits(plan: string | null | undefined): PlanLimits | null {
  if (plan === 'starter' || plan === 'pro' || plan === 'crew') return PLAN_LIMITS[plan]
  return null
}

export type GateResult = { allowed: boolean; reason: string; overFairUse?: boolean }

/** May a quote be drafted/sent for this tenant right now? Quotes are
 *  fair-use: never hard-blocked on count — only flagged. The hard block is
 *  "no active subscription". */
export function checkQuoteEntitlement(t: TenantBilling, usage: Usage): GateResult {
  if (!isEnforcementEnabled() || t.billing_exempt) {
    return { allowed: true, reason: 'enforcement_off_or_exempt' }
  }
  if (!hasActiveSubscription(t)) {
    return { allowed: false, reason: 'no_active_subscription' }
  }
  const limits = planLimits(t.subscription_plan)
  const overFairUse = !!limits && usage.quotesUsed >= limits.quotes
  return { allowed: true, reason: overFairUse ? 'over_fair_use' : 'ok', overFairUse }
}

/** May this tenant's VOICE receptionist auto-quote a call? Voice is the
 *  metered, plan-gated channel: off on Starter, hard-capped by minutes. */
export function checkVoiceEntitlement(t: TenantBilling, usage: Usage): GateResult {
  if (!isEnforcementEnabled() || t.billing_exempt) {
    return { allowed: true, reason: 'enforcement_off_or_exempt' }
  }
  if (!hasActiveSubscription(t)) {
    return { allowed: false, reason: 'no_active_subscription' }
  }
  const limits = planLimits(t.subscription_plan)
  if (!limits || !limits.voice) {
    return { allowed: false, reason: 'voice_not_on_plan' }
  }
  if (usage.voiceMinutesUsed >= limits.voiceMinutes) {
    return { allowed: false, reason: 'voice_minutes_exhausted' }
  }
  return { allowed: true, reason: 'ok' }
}
