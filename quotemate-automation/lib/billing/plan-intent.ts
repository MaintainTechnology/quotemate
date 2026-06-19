// Plan-selection hand-off across signup. When a signed-OUT visitor clicks a
// plan CTA on /pricing, we stash their choice in localStorage and send them
// to /signup. After they verify email + onboard and land in the dashboard,
// the Billing tab reads this intent and auto-starts that plan's Checkout —
// surviving the email round-trip (same browser) that a query string can't.
//
// Client-only (localStorage). All accessors are guarded so they're inert
// during SSR and never throw.

const KEY = 'qm_plan_intent'
const MAX_AGE_MS = 2 * 60 * 60 * 1000 // 2h — stale intents are ignored.

export type PlanIntent = {
  plan: 'starter' | 'pro' | 'crew'
  interval: 'month' | 'year'
}

function isPlan(v: unknown): v is PlanIntent['plan'] {
  return v === 'starter' || v === 'pro' || v === 'crew'
}
function isInterval(v: unknown): v is PlanIntent['interval'] {
  return v === 'month' || v === 'year'
}

export function writePlanIntent(plan: string, interval: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ plan, interval, ts: Date.now() }))
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function readPlanIntent(): PlanIntent | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { plan?: unknown; interval?: unknown; ts?: unknown }
    if (typeof o.ts === 'number' && Date.now() - o.ts > MAX_AGE_MS) {
      clearPlanIntent()
      return null
    }
    if (!isPlan(o.plan) || !isInterval(o.interval)) return null
    return { plan: o.plan, interval: o.interval }
  } catch {
    return null
  }
}

export function clearPlanIntent(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* non-fatal */
  }
}

export function hasPlanIntent(): boolean {
  return readPlanIntent() !== null
}
